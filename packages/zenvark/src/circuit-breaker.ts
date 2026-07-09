import type { Redis } from 'ioredis';
import type { AdaptiveSemaphore, Lease } from './adaptive-semaphore.ts';
import type { BackoffStrategy } from './backoffs/backoff-strategy.ts';
import type { BreakerMetricsRecorder } from './breaker-metrics-recorder.ts';
import type { BreakerStrategy } from './breakers/breaker-strategy.ts';
import {
  CallResult,
  CircuitRole,
  CircuitState,
  HealthCheckType,
  LeaseOutcome,
} from './constants.ts';
import { CircuitOpenError } from './errors/circuit-open-error.ts';
import { LeaderElector } from './leader-elector.ts';
import { CallResultStore } from './stores/call-result-store.ts';
import { CircuitStateStore } from './stores/circuit-state-store.ts';
import type { CallResultEvent } from './types.ts';
import { AbstractLifecycleManager } from './utils/abstract-lifecycle-manager.ts';
import { HealthCheckManager } from './utils/health-check-manager.ts';

type HealthConfig = {
  backoff: BackoffStrategy;
  check: (type: HealthCheckType, signal: AbortSignal) => Promise<void>;
  idleProbeIntervalMs?: number;
};

type OnErrorCallback = (err: Error) => void;
type OnRoleChangeCallback = (role: CircuitRole) => void;
type OnStateChangeCallback = (state: CircuitState) => void;

export type BreakerSemaphoreOptions = {
  /**
   * The semaphore gating calls to the protected resource. Its lifecycle
   * stays with the caller: the breaker never disposes it, so it can be
   * shared with other consumers.
   */
  instance: AdaptiveSemaphore;

  /**
   * Default maximum time to wait for a lease, in milliseconds. Falls back
   * to the semaphore's own acquire default (10000) when omitted.
   */
  timeoutMs?: number;

  /**
   * Default priority class to acquire under.
   */
  class?: string;

  /**
   * Maps an error thrown by the protected call to the outcome the lease
   * is released with: THROTTLED (feeds the semaphore's limit adaptation),
   * FAILURE (neutral, the default when omitted), or SUCCESS (the error is
   * not a capacity signal). This only drives the semaphore; breaker
   * accounting is unaffected — any thrown error is still recorded as a
   * breaker failure.
   */
  outcomeOnError?: (err: unknown) => LeaseOutcome;
};

export type ExecuteLeaseOptions = {
  timeoutMs?: number;
  class?: string;
  outcomeOnError?: (err: unknown) => LeaseOutcome;
  signal?: AbortSignal;
};

export type ExecuteOptions = {
  /**
   * Per-call overrides of the semaphore lease defaults configured on the
   * breaker. Requires the `semaphore` constructor option.
   */
  lease?: ExecuteLeaseOptions;
};

export type CircuitBreakerOptions = {
  id: string;
  redis: Redis;
  breaker: BreakerStrategy;
  health: HealthConfig;
  /**
   * Optional adaptive semaphore gating every `execute` call. The breaker
   * checks the circuit before acquiring a lease (so blocked requests are
   * counted and never queue), releases the lease with the classified
   * outcome afterwards, and aborts waiting acquires when the circuit opens.
   */
  semaphore?: BreakerSemaphoreOptions;
  onError?: OnErrorCallback;
  onRoleChange?: OnRoleChangeCallback;
  onStateChange?: OnStateChangeCallback;
  metrics?: BreakerMetricsRecorder;
};

export class CircuitBreaker extends AbstractLifecycleManager {
  private readonly id: string;
  private readonly redis: Redis;
  private readonly breaker: BreakerStrategy;
  private readonly health: HealthConfig;
  private readonly semaphore?: BreakerSemaphoreOptions;
  private readonly onError?: OnErrorCallback;
  private readonly onRoleChange?: OnRoleChangeCallback;
  private readonly onStateChange?: OnStateChangeCallback;
  private readonly metrics?: BreakerMetricsRecorder;
  private readonly pendingLeaseAcquires = new Set<AbortController>();

  private readonly circuitStateStore: CircuitStateStore;
  private readonly callResultStore: CallResultStore;
  private readonly elector: LeaderElector;
  private readonly healthCheckManager: HealthCheckManager;

  constructor(options: CircuitBreakerOptions) {
    super();
    this.id = options.id;
    this.redis = options.redis.duplicate({ lazyConnect: true });
    this.breaker = options.breaker;
    this.health = options.health;
    this.semaphore = options.semaphore;
    this.onError = options.onError;
    this.onRoleChange = options.onRoleChange;
    this.onStateChange = options.onStateChange;
    this.metrics = options.metrics;

    this.metrics?.initialize?.(this.id);

    this.circuitStateStore = new CircuitStateStore({
      redis: this.redis,
      redisStreamKey: `zenvark:${this.id}:state`,
      onStreamReadError: (err: unknown) => {
        this.handleError('CircuitStateStore stream read error', err);
      },
      onStreamWriteError: (err: unknown) => {
        this.handleError('CircuitStateStore stream write error', err);
      },
      onStateChange: (state) => {
        if (this.elector.isLeader) {
          this.metrics?.recordStateChange?.({ breakerId: this.id, state });
        }
        if (state === CircuitState.OPEN) {
          this.abortPendingLeaseAcquires();
        }
        this.onStateChange?.(state);
      },
    });

    this.callResultStore = new CallResultStore({
      redis: this.redis,
      redisStreamKey: `zenvark:${this.id}:call-result`,
      maxLen: 1000,
      onStreamReadError: (err: unknown) => {
        this.handleError('CallResultStore stream read error', err);
      },
      onStreamWriteError: (err: unknown) => {
        this.handleError('CallResultStore stream write error', err);
      },
      onEventsAdded: (events) => {
        void this.handleEventsAdded(events);
      },
    });

    this.elector = new LeaderElector({
      redis: this.redis,
      key: `zenvark:${this.id}:leader`,
      onAcquireError: (err: unknown) => {
        this.handleError('LeaderElector acquire error', err);
      },
      onRoleChange: (role) => {
        if (role === CircuitRole.LEADER) {
          this.metrics?.recordStateChange?.({
            breakerId: this.id,
            state: this.state,
          });

          if (this.state === CircuitState.OPEN) {
            void this.runRecoveryHealthChecks();
          } else if (this.health.idleProbeIntervalMs) {
            void this.rescheduleIdleHealthChecks();
          }
        } else {
          this.metrics?.clearState?.(this.id);
          void this.stopHealthChecks();
        }

        this.onRoleChange?.(role);
      },
    });

    this.healthCheckManager = new HealthCheckManager({
      runCheck: async (type, signal) => {
        const startedAt = performance.now();

        try {
          await this.health.check(type, signal);

          if (this.metrics) {
            const durationMs = performance.now() - startedAt;
            this.metrics.recordHealthCheck({
              breakerId: this.id,
              type,
              result: CallResult.SUCCESS,
              durationMs,
            });
          }

          void this.onHealthCheckSuccess(type);
        } catch (err) {
          if (signal.aborted) {
            return;
          }

          if (this.metrics) {
            const durationMs = performance.now() - startedAt;
            this.metrics.recordHealthCheck({
              breakerId: this.id,
              type,
              result: CallResult.FAILURE,
              durationMs,
            });
          }

          this.handleError(`Failed to perform ${type} health check`, err);

          void this.onHealthCheckFailure(type);
        }
      },
    });
  }

  protected override async startInternal(): Promise<void> {
    await this.redis.connect();

    await Promise.all([
      this.callResultStore.start(),
      this.circuitStateStore.start(),
    ]);

    await this.elector.start();
  }

  protected override async stopInternal(): Promise<void> {
    await Promise.all([
      this.callResultStore.stop(),
      this.circuitStateStore.stop(),
      this.elector.stop(),
      this.stopHealthChecks(),
    ]);

    await this.redis.quit();
  }

  get role(): CircuitRole {
    return this.elector.isLeader ? CircuitRole.LEADER : CircuitRole.FOLLOWER;
  }

  get state(): CircuitState {
    return this.circuitStateStore.getState();
  }

  private async onHealthCheckSuccess(type: HealthCheckType) {
    if (!this.elector.isLeader) {
      return;
    }

    if (type === HealthCheckType.RECOVERY) {
      await this.circuitStateStore.setState(CircuitState.CLOSED);
      await this.rescheduleIdleHealthChecks();
    }
  }

  private async onHealthCheckFailure(type: HealthCheckType) {
    if (!this.elector.isLeader) {
      return;
    }

    if (type === HealthCheckType.IDLE) {
      await this.circuitStateStore.setState(CircuitState.OPEN);
      await this.runRecoveryHealthChecks();
    }
  }

  private async stopHealthChecks(): Promise<void> {
    await this.healthCheckManager.stop();
  }

  private async runRecoveryHealthChecks(): Promise<void> {
    if (!this.elector.isLeader) {
      return;
    }

    await this.healthCheckManager.restart({
      type: HealthCheckType.RECOVERY,
      getDelayMs: (attempt) => this.health.backoff.getDelayMs(attempt),
    });
  }

  private async rescheduleIdleHealthChecks(): Promise<void> {
    if (!this.health.idleProbeIntervalMs || !this.elector.isLeader) {
      return;
    }

    const lastEventTimestamp = this.callResultStore
      .getEvents()
      .at(-1)?.timestamp;
    const initialExecutionStartMs = lastEventTimestamp
      ? lastEventTimestamp + this.health.idleProbeIntervalMs
      : 0;

    await this.healthCheckManager.restart({
      type: HealthCheckType.IDLE,
      getDelayMs: (attempt) => {
        if (attempt === 1) {
          return Math.max(0, initialExecutionStartMs - Date.now());
        }
        return this.health.idleProbeIntervalMs ?? Infinity;
      },
    });
  }

  private handleEventsAdded = async (events: CallResultEvent[]) => {
    if (!this.elector.isLeader || this.state === CircuitState.OPEN) {
      return;
    }

    // Filter out events that occurred before the last state change
    // This prevents historical failures from causing repeated circuit opens after successful recovery
    const lastStateChangeTimestamp =
      this.circuitStateStore.getLastStateChangeTimestamp();
    const recentEvents = events.filter(
      (event) => event.timestamp >= lastStateChangeTimestamp,
    );

    if (this.shouldOpenCircuit(recentEvents)) {
      await this.circuitStateStore.setState(CircuitState.OPEN);
      await this.runRecoveryHealthChecks();
    } else if (this.health.idleProbeIntervalMs) {
      await this.rescheduleIdleHealthChecks();
    }
  };

  private async recordCallResult(
    callResult: CallResult,
    callStartedAtMs: number,
  ) {
    const durationMs = performance.now() - callStartedAtMs;

    this.metrics?.recordCall({
      breakerId: this.id,
      result: callResult,
      durationMs,
    });

    await this.callResultStore.storeCallResult(callResult);
  }

  async execute<T>(fn: () => Promise<T>, options?: ExecuteOptions): Promise<T> {
    this.throwIfCircuitOpen();

    if (!this.semaphore) {
      if (options?.lease) {
        throw new Error(
          `Semaphore lease options require a semaphore to be configured on breaker "${this.id}"`,
        );
      }
      return await this.runCall(fn);
    }

    const outcomeOnError =
      options?.lease?.outcomeOnError ?? this.semaphore.outcomeOnError;
    const lease = await this.acquireLease(this.semaphore, options?.lease);

    // The circuit may have opened while we were waiting for the lease
    try {
      this.throwIfCircuitOpen();
    } catch (err) {
      await lease.release(LeaseOutcome.FAILURE);
      throw err;
    }

    try {
      const result = await this.runCall(fn);
      await lease.release(LeaseOutcome.SUCCESS);
      return result;
    } catch (err) {
      await lease.release(this.resolveErrorOutcome(outcomeOnError, err));
      throw err;
    }
  }

  private async acquireLease(
    semaphore: BreakerSemaphoreOptions,
    overrides: ExecuteLeaseOptions | undefined,
  ): Promise<Lease> {
    const controller = new AbortController();
    this.pendingLeaseAcquires.add(controller);
    try {
      return await semaphore.instance.acquire({
        timeoutMs: overrides?.timeoutMs ?? semaphore.timeoutMs,
        class: overrides?.class ?? semaphore.class,
        signal: overrides?.signal
          ? AbortSignal.any([overrides.signal, controller.signal])
          : controller.signal,
      });
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        // The wait was aborted because the circuit opened
        this.metrics?.recordBlockedRequest({ breakerId: this.id });
      }
      throw err;
    } finally {
      this.pendingLeaseAcquires.delete(controller);
    }
  }

  private abortPendingLeaseAcquires(): void {
    for (const controller of this.pendingLeaseAcquires) {
      controller.abort(new CircuitOpenError(this.id));
    }
    this.pendingLeaseAcquires.clear();
  }

  private throwIfCircuitOpen(): void {
    if (this.state === CircuitState.OPEN) {
      this.metrics?.recordBlockedRequest({ breakerId: this.id });

      throw new CircuitOpenError(this.id);
    }
  }

  private async runCall<T>(fn: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();

    try {
      const result = await fn();

      void this.recordCallResult(CallResult.SUCCESS, startedAt);

      return result;
    } catch (err) {
      void this.recordCallResult(CallResult.FAILURE, startedAt);

      throw err;
    }
  }

  private resolveErrorOutcome(
    classifier: ((err: unknown) => LeaseOutcome) | undefined,
    err: unknown,
  ): LeaseOutcome {
    if (!classifier) {
      return LeaseOutcome.FAILURE;
    }
    try {
      return classifier(err);
    } catch (classifierErr) {
      this.handleError(
        `Semaphore error classifier of breaker "${this.id}" threw; treating the outcome as FAILURE`,
        classifierErr,
      );
      return LeaseOutcome.FAILURE;
    }
  }

  private shouldOpenCircuit(events: CallResultEvent[]): boolean {
    if (events.length === 0) {
      return false;
    }

    return this.breaker.shouldOpenCircuit(events);
  }

  private handleError(message: string, cause: unknown): void {
    const err = new Error(message, { cause });

    if (!this.onError) {
      console.error('[zenvark] Unhandled error:', err);
      return;
    }
    this.onError(err);
  }
}
