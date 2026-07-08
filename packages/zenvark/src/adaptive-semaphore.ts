import type { Redis } from 'ioredis';
import { Semaphore } from 'redis-semaphore';
import {
  AcquireResult,
  LeaseOutcome,
  LimitChangeDirection,
} from './constants.ts';
import { AcquireTimeoutError } from './errors/acquire-timeout-error.ts';
import { SemaphoreDisposedError } from './errors/semaphore-disposed-error.ts';
import { SemaphoreUnavailableError } from './errors/semaphore-unavailable-error.ts';
import type { SemaphoreMetricsRecorder } from './semaphore-metrics-recorder.ts';
import type { SemaphoreClassConfig, SemaphoreState } from './types.ts';
import { delay } from './utils/delay.ts';

const DEFAULT_MIN_LIMIT = 1;
const DEFAULT_LEASE_TTL_MS = 30_000;
const DEFAULT_DECREASE_FACTOR = 0.5;
const DEFAULT_INCREASE_STEP = 1;
const DEFAULT_WINDOW_MS = 5_000;
const DEFAULT_COOLDOWN_MS = 10_000;
const LIMIT_CACHE_TTL_MS = 1_000;
const RETRY_INTERVAL_MIN_MS = 100;
const RETRY_INTERVAL_MAX_MS = 500;

export type AimdOptions = {
  /**
   * Multiplier applied to the limit on a throttle (default: 0.5).
   */
  decreaseFactor?: number;

  /**
   * Additive step applied when a window saw demand at the cap and no
   * throttles (default: 1).
   */
  increaseStep?: number;

  /**
   * Increase evaluation window in milliseconds: at most one increase
   * per window, fleet-wide (default: 5000).
   */
  windowMs?: number;

  /**
   * Decrease cooldown in milliseconds: at most one decrease per cooldown,
   * fleet-wide, so one burst of correlated throttles counts once
   * (default: 10000).
   */
  cooldownMs?: number;
};

export type FallbackGate = {
  /**
   * Fixed per-process concurrency cap applied while Redis is unreachable.
   */
  localLimit: number;
};

export type AdaptiveSemaphoreOptions = {
  /**
   * Names one independently limited resource. All Redis keys live under
   * `zenvark:${id}:*`.
   */
  id: string;

  /**
   * An ioredis instance, used as-is; the semaphore only issues
   * request/response commands, so it is safe to share.
   */
  redis: Redis;

  /**
   * Starting fleet-wide capacity, seeded into Redis on first use.
   */
  initialLimit: number;

  /**
   * Hard ceiling for additive increases.
   */
  maxLimit: number;

  /**
   * Floor for multiplicative decreases (default: 1).
   */
  minLimit?: number;

  /**
   * Lease TTL in milliseconds (default: 30000). Held leases auto-renew;
   * a crashed holder's slot returns within one TTL.
   */
  leaseTtlMs?: number;

  /**
   * AIMD adaptation constants.
   */
  aimd?: AimdOptions;

  /**
   * Named priority classes with optional reserved capacity shares.
   */
  classes?: Record<string, SemaphoreClassConfig>;

  /**
   * Behavior when Redis is unreachable: fail closed ('throw', the default)
   * or fall back to a fixed per-process concurrency cap.
   */
  onUnavailable?: 'throw' | FallbackGate;

  /**
   * Metrics hook; use PrometheusSemaphoreMetrics from @zenvark/prom.
   */
  metrics?: SemaphoreMetricsRecorder;

  /**
   * All internal errors surface here, wrapped with context and `cause`.
   * Defaults to console.error.
   */
  onError?: (err: Error) => void;

  /**
   * Called when this process's cached view of the fleet-wide limit changes.
   */
  onLimitChange?: (limit: number) => void;
};

export type AcquireOptions = {
  /**
   * Maximum time to wait for a slot in milliseconds. On expiry, the acquire
   * rejects with AcquireTimeoutError.
   */
  timeoutMs: number;

  /**
   * Priority class to acquire under. Must be a configured `classes` key.
   */
  class?: string;

  /**
   * Optional cancellation for the wait.
   */
  signal?: AbortSignal;
};

export type WithLeaseOptions = AcquireOptions & {
  /**
   * Decides whether a thrown error counts as THROTTLED (true) or
   * FAILURE (false). Omit to treat every error as FAILURE.
   */
  classifyError?: (err: unknown) => boolean;
};

export class Lease {
  private released = false;
  private readonly releaseFn: (outcome: LeaseOutcome) => Promise<void>;

  constructor(releaseFn: (outcome: LeaseOutcome) => Promise<void>) {
    this.releaseFn = releaseFn;
  }

  /**
   * Release the lease with a caller-reported outcome. Idempotent: only the
   * first call has an effect.
   */
  async release(outcome: LeaseOutcome): Promise<void> {
    if (this.released) {
      return;
    }
    this.released = true;
    await this.releaseFn(outcome);
  }
}

export class AdaptiveSemaphore {
  private readonly id: string;
  private readonly redis: Redis;
  private readonly initialLimit: number;
  private readonly minLimit: number;
  private readonly maxLimit: number;
  private readonly leaseTtlMs: number;
  private readonly decreaseFactor: number;
  private readonly increaseStep: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly classes: Record<string, SemaphoreClassConfig>;
  private readonly onUnavailable: 'throw' | FallbackGate;
  private readonly metrics?: SemaphoreMetricsRecorder;
  private readonly onError?: (err: Error) => void;
  private readonly onLimitChange?: (limit: number) => void;

  private readonly gateKey: string;
  private readonly limitKey: string;
  private readonly demandKey: string;
  private readonly throttledKey: string;
  private readonly cooldownKey: string;
  private readonly increaseKey: string;

  private cachedLimit: number | null = null;
  private cachedLimitAt = 0;
  private seedPromise: Promise<unknown> | null = null;
  private inflightTotal = 0;
  private readonly inflightPerClass = new Map<string, number>();
  private fallbackInflight = 0;
  private readonly pendingAcquires = new Set<AbortController>();
  private disposed = false;

  constructor(options: AdaptiveSemaphoreOptions) {
    this.validateOptions(options);

    this.id = options.id;
    this.redis = options.redis;
    this.initialLimit = options.initialLimit;
    this.minLimit = options.minLimit ?? DEFAULT_MIN_LIMIT;
    this.maxLimit = options.maxLimit;
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.decreaseFactor =
      options.aimd?.decreaseFactor ?? DEFAULT_DECREASE_FACTOR;
    this.increaseStep = options.aimd?.increaseStep ?? DEFAULT_INCREASE_STEP;
    this.windowMs = options.aimd?.windowMs ?? DEFAULT_WINDOW_MS;
    this.cooldownMs = options.aimd?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.classes = options.classes ?? {};
    this.onUnavailable = options.onUnavailable ?? 'throw';
    this.metrics = options.metrics;
    this.onError = options.onError;
    this.onLimitChange = options.onLimitChange;

    // redis-semaphore prefixes the gate key with 'semaphore:'
    this.gateKey = `zenvark:${this.id}`;
    this.limitKey = `zenvark:${this.id}:limit`;
    this.demandKey = `zenvark:${this.id}:demand`;
    this.throttledKey = `zenvark:${this.id}:throttled`;
    this.cooldownKey = `zenvark:${this.id}:cooldown`;
    this.increaseKey = `zenvark:${this.id}:increase`;

    this.metrics?.initialize?.(this.id);
  }

  /**
   * Acquire a lease, waiting up to `timeoutMs` for a slot. Waiting is
   * jittered polling, not FIFO.
   */
  async acquire(options: AcquireOptions): Promise<Lease> {
    if (this.disposed) {
      throw new SemaphoreDisposedError(this.id);
    }
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
      throw new Error('timeoutMs must be a non-negative number');
    }
    if (options.class !== undefined && !(options.class in this.classes)) {
      throw new Error(
        `Unknown semaphore class "${options.class}" for semaphore "${this.id}"`,
      );
    }

    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    this.pendingAcquires.add(controller);
    try {
      return await this.acquireWithRedis(options, signal);
    } finally {
      this.pendingAcquires.delete(controller);
    }
  }

  /**
   * Acquire a lease, run the callback, and release with the right outcome:
   * SUCCESS when it resolves, THROTTLED when it throws and `classifyError`
   * returns true, FAILURE otherwise. The callback's error is rethrown.
   */
  async withLease<T>(
    options: WithLeaseOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquire(options);
    try {
      const result = await fn();
      await lease.release(LeaseOutcome.SUCCESS);
      return result;
    } catch (err) {
      const throttled = this.classifyError(options.classifyError, err);
      await lease.release(
        throttled ? LeaseOutcome.THROTTLED : LeaseOutcome.FAILURE,
      );
      throw err;
    }
  }

  /**
   * This process's view of the semaphore: the cached fleet-wide limit and
   * the leases held by this process. Sum the inflight counts across
   * processes (e.g. in PromQL) for fleet totals.
   */
  getState(): SemaphoreState {
    return {
      limit: this.cachedLimit ?? this.initialLimit,
      inflight: this.inflightTotal,
      inflightByClass: Object.fromEntries(this.inflightPerClass),
    };
  }

  /**
   * Abort all pending acquires and reject any future ones. Held leases are
   * unaffected: release them normally, or let them lapse by TTL. Idempotent.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const controller of this.pendingAcquires) {
      controller.abort(new SemaphoreDisposedError(this.id));
    }
    this.pendingAcquires.clear();
  }

  private async acquireWithRedis(
    options: AcquireOptions,
    signal: AbortSignal,
  ): Promise<Lease> {
    const startedAt = performance.now();
    const deadline = Date.now() + options.timeoutMs;
    // After a denied acquire the cached limit is suspect (another node may
    // have raised it), so re-read it on the next attempt.
    let refreshLimit = false;

    while (true) {
      signal.throwIfAborted();
      let acquiredGate: Semaphore | null = null;
      try {
        const limit = await this.getLimit(refreshLimit);
        const gate = new Semaphore(
          this.redis,
          this.gateKey,
          this.capForClass(options.class, limit),
          {
            lockTimeout: this.leaseTtlMs,
            acquireAttemptsLimit: 1,
            retryInterval: this.retryIntervalFor(deadline),
            onLockLost: (err) =>
              this.handleError(
                `Lease on semaphore "${this.id}" was lost before release`,
                err,
              ),
          },
        );
        if (await gate.tryAcquire(signal)) {
          acquiredGate = gate;
        }
      } catch (err) {
        if (signal.aborted) {
          throw signal.reason ?? err;
        }
        return await this.acquireWithFallback(
          options,
          signal,
          startedAt,
          deadline,
          err,
        );
      }

      if (acquiredGate) {
        this.recordAcquired(options.class, startedAt);
        return this.createRedisLease(acquiredGate, options.class);
      }

      refreshLimit = true;
      await this.markDemand();
      if (Date.now() >= deadline) {
        this.recordTimedOut(options.class, startedAt);
        throw new AcquireTimeoutError({
          semaphoreId: this.id,
          timeoutMs: options.timeoutMs,
          class: options.class,
        });
      }
    }
  }

  private async acquireWithFallback(
    options: AcquireOptions,
    signal: AbortSignal,
    startedAt: number,
    deadline: number,
    cause: unknown,
  ): Promise<Lease> {
    this.handleError(`Redis is unavailable for semaphore "${this.id}"`, cause);
    if (this.onUnavailable === 'throw') {
      throw new SemaphoreUnavailableError(this.id, cause);
    }

    const { localLimit } = this.onUnavailable;
    while (true) {
      signal.throwIfAborted();
      if (this.fallbackInflight < localLimit) {
        this.fallbackInflight += 1;
        this.recordAcquired(options.class, startedAt);
        return this.createFallbackLease(options.class);
      }
      if (Date.now() >= deadline) {
        this.recordTimedOut(options.class, startedAt);
        throw new AcquireTimeoutError({
          semaphoreId: this.id,
          timeoutMs: options.timeoutMs,
          class: options.class,
        });
      }
      await delay(this.retryIntervalFor(deadline), signal);
    }
  }

  private createRedisLease(gate: Semaphore, className?: string): Lease {
    this.trackAcquired(className);
    const heldSince = performance.now();
    return new Lease(async (outcome) => {
      this.trackReleased(className);
      try {
        await gate.release();
      } catch (err) {
        this.handleError(
          `Failed to release a lease on semaphore "${this.id}"; the slot will return by TTL`,
          err,
        );
      }
      this.metrics?.recordRelease({
        id: this.id,
        class: className,
        outcome,
        heldMs: performance.now() - heldSince,
      });
      try {
        if (outcome === LeaseOutcome.THROTTLED) {
          await this.adaptDown();
        } else if (outcome === LeaseOutcome.SUCCESS) {
          await this.maybeAdaptUp();
        }
      } catch (err) {
        this.handleError(
          `Failed to adapt the limit of semaphore "${this.id}"`,
          err,
        );
      }
    });
  }

  private createFallbackLease(className?: string): Lease {
    this.trackAcquired(className);
    const heldSince = performance.now();
    return new Lease(async (outcome) => {
      this.trackReleased(className);
      this.fallbackInflight -= 1;
      this.metrics?.recordRelease({
        id: this.id,
        class: className,
        outcome,
        heldMs: performance.now() - heldSince,
      });
    });
  }

  /**
   * Multiplicative decrease. The throttled marker suppresses increases for
   * one window; the cooldown claim ensures a burst of correlated throttles
   * shrinks the limit once, fleet-wide.
   */
  private async adaptDown(): Promise<void> {
    this.metrics?.recordThrottle?.({ id: this.id });
    await this.redis.set(this.throttledKey, '1', 'PX', this.windowMs);
    const claimed = await this.redis.set(
      this.cooldownKey,
      '1',
      'PX',
      this.cooldownMs,
      'NX',
    );
    if (claimed === null) {
      return;
    }
    const current = await this.readLimitFromRedis();
    const next = Math.max(
      this.minLimit,
      Math.floor(current * this.decreaseFactor),
    );
    if (next !== current) {
      await this.redis.set(this.limitKey, String(next));
    }
    this.updateCachedLimit(next);
  }

  /**
   * Additive increase: only when the window saw demand at the cap (a denied
   * acquire) and no throttle. The increase claim ensures one step per
   * window, fleet-wide.
   */
  private async maybeAdaptUp(): Promise<void> {
    const [demand, throttled] = await this.redis.mget(
      this.demandKey,
      this.throttledKey,
    );
    if (demand === null || throttled !== null) {
      return;
    }
    const claimed = await this.redis.set(
      this.increaseKey,
      '1',
      'PX',
      this.windowMs,
      'NX',
    );
    if (claimed === null) {
      return;
    }
    let next = await this.redis.incrby(this.limitKey, this.increaseStep);
    if (next > this.maxLimit) {
      next = this.maxLimit;
      await this.redis.set(this.limitKey, String(next));
    }
    this.updateCachedLimit(next);
  }

  private async markDemand(): Promise<void> {
    try {
      await this.redis.set(this.demandKey, '1', 'PX', this.windowMs);
    } catch (err) {
      this.handleError(`Failed to mark demand for semaphore "${this.id}"`, err);
    }
  }

  private async getLimit(forceRefresh: boolean): Promise<number> {
    if (
      !forceRefresh &&
      this.cachedLimit !== null &&
      Date.now() - this.cachedLimitAt < LIMIT_CACHE_TTL_MS
    ) {
      return this.cachedLimit;
    }
    const limit = await this.readLimitFromRedis();
    this.updateCachedLimit(limit);
    return limit;
  }

  private async readLimitFromRedis(): Promise<number> {
    await this.ensureSeeded();
    const raw = await this.redis.get(this.limitKey);
    return raw === null ? this.initialLimit : Number.parseInt(raw, 10);
  }

  private ensureSeeded(): Promise<unknown> {
    if (!this.seedPromise) {
      this.seedPromise = this.redis
        .set(this.limitKey, String(this.initialLimit), 'NX')
        .catch((err) => {
          // Allow a later acquire to retry seeding after a Redis outage
          this.seedPromise = null;
          throw err;
        });
    }
    return this.seedPromise;
  }

  private updateCachedLimit(limit: number): void {
    this.cachedLimitAt = Date.now();
    if (limit === this.cachedLimit) {
      return;
    }
    let direction: LimitChangeDirection = LimitChangeDirection.INIT;
    if (this.cachedLimit !== null) {
      direction =
        limit > this.cachedLimit
          ? LimitChangeDirection.INCREASE
          : LimitChangeDirection.DECREASE;
    }
    this.cachedLimit = limit;
    this.metrics?.recordLimitChange?.({ id: this.id, limit, direction });
    this.onLimitChange?.(limit);
  }

  /**
   * A class is capped at the limit minus the other classes' reserved
   * slices, floored at 1 so no class is ever fully locked out.
   */
  private capForClass(className: string | undefined, limit: number): number {
    let reservedByOthers = 0;
    for (const [name, config] of Object.entries(this.classes)) {
      if (name !== className && config.reservedShare !== undefined) {
        reservedByOthers += Math.ceil(config.reservedShare * limit);
      }
    }
    return Math.max(1, limit - reservedByOthers);
  }

  private retryIntervalFor(deadline: number): number {
    const jitter =
      RETRY_INTERVAL_MIN_MS +
      Math.random() * (RETRY_INTERVAL_MAX_MS - RETRY_INTERVAL_MIN_MS);
    const remaining = deadline - Date.now();
    return Math.max(1, Math.round(Math.min(jitter, remaining)));
  }

  private trackAcquired(className?: string): void {
    this.inflightTotal += 1;
    if (className !== undefined) {
      this.inflightPerClass.set(
        className,
        (this.inflightPerClass.get(className) ?? 0) + 1,
      );
    }
  }

  private trackReleased(className?: string): void {
    this.inflightTotal -= 1;
    if (className !== undefined) {
      this.inflightPerClass.set(
        className,
        (this.inflightPerClass.get(className) ?? 1) - 1,
      );
    }
  }

  private recordAcquired(
    className: string | undefined,
    startedAt: number,
  ): void {
    this.metrics?.recordAcquire({
      id: this.id,
      class: className,
      result: AcquireResult.ACQUIRED,
      waitMs: performance.now() - startedAt,
    });
  }

  private recordTimedOut(
    className: string | undefined,
    startedAt: number,
  ): void {
    this.metrics?.recordAcquire({
      id: this.id,
      class: className,
      result: AcquireResult.TIMEOUT,
      waitMs: performance.now() - startedAt,
    });
  }

  private classifyError(
    classifier: ((err: unknown) => boolean) | undefined,
    err: unknown,
  ): boolean {
    if (!classifier) {
      return false;
    }
    try {
      return classifier(err);
    } catch (classifierErr) {
      this.handleError(
        `Error classifier of semaphore "${this.id}" threw; treating the outcome as FAILURE`,
        classifierErr,
      );
      return false;
    }
  }

  private handleError(message: string, cause: unknown): void {
    const wrapped = new Error(message, { cause });
    if (!this.onError) {
      console.error('[zenvark] Unhandled semaphore error:', wrapped);
      return;
    }
    this.onError(wrapped);
  }

  private validateOptions(options: AdaptiveSemaphoreOptions): void {
    if (!options.id) {
      throw new Error('id is required');
    }
    if (!Number.isInteger(options.initialLimit) || options.initialLimit < 1) {
      throw new Error('initialLimit must be an integer >= 1');
    }
    const minLimit = options.minLimit ?? DEFAULT_MIN_LIMIT;
    if (!Number.isInteger(minLimit) || minLimit < 1) {
      throw new Error('minLimit must be an integer >= 1');
    }
    if (!Number.isInteger(options.maxLimit) || options.maxLimit < 1) {
      throw new Error('maxLimit must be an integer >= 1');
    }
    if (
      options.initialLimit < minLimit ||
      options.initialLimit > options.maxLimit
    ) {
      throw new Error('initialLimit must be within [minLimit, maxLimit]');
    }
    const decreaseFactor =
      options.aimd?.decreaseFactor ?? DEFAULT_DECREASE_FACTOR;
    if (!(decreaseFactor > 0 && decreaseFactor < 1)) {
      throw new Error('aimd.decreaseFactor must be within (0, 1)');
    }
    const increaseStep = options.aimd?.increaseStep ?? DEFAULT_INCREASE_STEP;
    if (!Number.isInteger(increaseStep) || increaseStep < 1) {
      throw new Error('aimd.increaseStep must be an integer >= 1');
    }
    const windowMs = options.aimd?.windowMs ?? DEFAULT_WINDOW_MS;
    const cooldownMs = options.aimd?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    if (windowMs <= 0 || cooldownMs <= 0) {
      throw new Error('aimd.windowMs and aimd.cooldownMs must be positive');
    }
    let totalReserved = 0;
    for (const [name, config] of Object.entries(options.classes ?? {})) {
      if (config.reservedShare === undefined) {
        continue;
      }
      if (!(config.reservedShare > 0 && config.reservedShare < 1)) {
        throw new Error(`classes.${name}.reservedShare must be within (0, 1)`);
      }
      totalReserved += config.reservedShare;
    }
    if (totalReserved >= 1) {
      throw new Error('the sum of reservedShare across classes must be < 1');
    }
    if (
      options.onUnavailable !== undefined &&
      options.onUnavailable !== 'throw' &&
      (!Number.isInteger(options.onUnavailable.localLimit) ||
        options.onUnavailable.localLimit < 1)
    ) {
      throw new Error('onUnavailable.localLimit must be an integer >= 1');
    }
  }
}
