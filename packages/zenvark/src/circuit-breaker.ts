import type { Redis } from 'ioredis';
import type { BackoffStrategy } from './backoffs/backoff-strategy.ts';
import type { BreakerMetricsRecorder } from './breaker-metrics-recorder.ts';
import type { BreakerStrategy } from './breakers/breaker-strategy.ts';
import {
  CallResult,
  CircuitRole,
  CircuitState,
  HealthCheckType,
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

export type CircuitBreakerOptions = {
  id: string;
  redis: Redis;
  breaker: BreakerStrategy;
  health: HealthConfig;
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
  private readonly onError?: OnErrorCallback;
  private readonly onRoleChange?: OnRoleChangeCallback;
  private readonly onStateChange?: OnStateChangeCallback;
  private readonly metrics?: BreakerMetricsRecorder;

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
          if (this.state === CircuitState.OPEN) {
            void this.runRecoveryHealthChecks();
          } else if (this.health.idleProbeIntervalMs) {
            void this.rescheduleIdleHealthChecks();
          }
        } else {
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

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      this.metrics?.recordBlockedRequest({ breakerId: this.id });

      throw new CircuitOpenError(this.id);
    }

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
