import type {
  AcquireResult,
  CallResult,
  CircuitRole,
  CircuitState,
  HealthCheckType,
  LeaseOutcome,
  LimitChangeDirection,
} from './constants.ts';

export type ExecuteCallParams<T> = {
  breakerId: string;
  /**
   * Runs the protected call, or the next integration's wrapper around it.
   * Its rejection is the call's failure.
   */
  execute: () => Promise<T>;
};

export type ExecuteHealthCheckParams = {
  breakerId: string;
  type: HealthCheckType;
  /**
   * Aborted when the check is cancelled (the breaker stopped or lost
   * leadership); a rejection after that is not a health check failure.
   */
  signal: AbortSignal;
  /**
   * Runs the health check, or the next integration's wrapper around it.
   * Its rejection is the check's failure.
   */
  execute: () => Promise<void>;
};

export type BreakerInitEvent = {
  breakerId: string;
};

export type CallEndEvent = {
  breakerId: string;
  result: CallResult;
  durationMs: number;
};

export type HealthCheckEndEvent = {
  breakerId: string;
  type: HealthCheckType;
  result: CallResult;
  durationMs: number;
};

export type BlockedRequestEvent = {
  breakerId: string;
};

export type StateChangeEvent = {
  breakerId: string;
  state: CircuitState;
};

export type RoleChangeEvent = {
  breakerId: string;
  role: CircuitRole;
  /**
   * The circuit state when the role changed
   */
  state: CircuitState;
};

export type SemaphoreInitEvent = {
  semaphoreId: string;
};

export type AcquireEvent = {
  semaphoreId: string;
  class?: string;
  result: AcquireResult;
  waitMs: number;
};

export type ReleaseEvent = {
  semaphoreId: string;
  class?: string;
  outcome: LeaseOutcome;
  heldMs: number;
};

export type LimitChangeEvent = {
  semaphoreId: string;
  limit: number;
  direction: LimitChangeDirection;
};

export type ThrottleEvent = {
  semaphoreId: string;
};

/**
 * Telemetry integration receiving circuit breaker and semaphore lifecycle
 * events, independent of any telemetry library. All methods are optional;
 * implement only the ones you need. `@zenvark/otel` and `@zenvark/prom`
 * implement it for OpenTelemetry and Prometheus.
 */
export type Telemetry = {
  /**
   * Wrap a protected call. Call `execute` synchronously (before any
   * `await`) inside the integration's context, such as an active span, so
   * work done by the call nests under it.
   *
   * The breaker settles with the call's own outcome as soon as it is
   * known, without waiting for the returned promise. The call runs exactly
   * once even if `execute` is not called or called twice, and a rejection
   * other than the call's own error is reported through `onError`.
   */
  executeCall?<T>(params: ExecuteCallParams<T>): Promise<T>;

  /**
   * Wrap a health check attempt, with the same guarantees as `executeCall`
   */
  executeHealthCheck?(params: ExecuteHealthCheckParams): Promise<void>;

  /**
   * Called when a circuit breaker is created. Integrations registered
   * later do not receive it for breakers that already exist.
   */
  onBreakerInit?(event: BreakerInitEvent): void;

  /**
   * Called when a protected call completes, with its result and duration
   */
  onCallEnd?(event: CallEndEvent): void;

  /**
   * Called when a health check attempt completes. Not called for cancelled
   * checks.
   */
  onHealthCheckEnd?(event: HealthCheckEndEvent): void;

  /**
   * Called when a request is blocked by an open circuit
   */
  onBlockedRequest?(event: BlockedRequestEvent): void;

  /**
   * Called on a circuit state transition, on the leader only
   */
  onStateChange?(event: StateChangeEvent): void;

  /**
   * Called when this instance becomes the leader or stops being it
   */
  onRoleChange?(event: RoleChangeEvent): void;

  /**
   * Called when a semaphore is created. Integrations registered later do
   * not receive it for semaphores that already exist.
   */
  onSemaphoreInit?(event: SemaphoreInitEvent): void;

  /**
   * Called when an acquire attempt is granted or times out, with the time
   * spent waiting
   */
  onAcquire?(event: AcquireEvent): void;

  /**
   * Called when a lease is released, with its outcome and hold duration
   */
  onRelease?(event: ReleaseEvent): void;

  /**
   * Called when this process's view of the fleet-wide limit changes
   */
  onLimitChange?(event: LimitChangeEvent): void;

  /**
   * Called when a lease is released as `THROTTLED`
   */
  onThrottle?(event: ThrottleEvent): void;
};

type EventHook = {
  [K in keyof Telemetry]-?: K extends `on${string}` ? K : never;
}[keyof Telemetry];

type EventOf<K extends EventHook> = Parameters<NonNullable<Telemetry[K]>>[0];

export type TelemetryOptions = {
  /**
   * Set to `false` to disable telemetry for this instance, including
   * globally registered integrations. Defaults to `true`.
   */
  isEnabled?: boolean;

  /**
   * Integrations for this instance. When provided, they replace the
   * globally registered integrations for it.
   */
  integrations?: Telemetry | Telemetry[];
};

// Kept on globalThis so that every copy of zenvark loaded in the process
// (for example an ESM and a CJS one) sees the same registrations
const REGISTRY_KEY = Symbol.for('zenvark.telemetry');

type TelemetryGlobal = typeof globalThis & {
  [REGISTRY_KEY]?: Telemetry[];
};

/**
 * Register telemetry integrations for every circuit breaker and semaphore
 * in the process. Integrations are resolved per event, so instances created
 * before the registration use them too.
 */
export function registerZenvarkTelemetry(...integrations: Telemetry[]): void {
  const global = globalThis as TelemetryGlobal;
  global[REGISTRY_KEY] = [...(global[REGISTRY_KEY] ?? []), ...integrations];
}

/**
 * Remove all globally registered integrations. Not exported from the
 * package; for tests only.
 */
export function clearRegisteredTelemetry(): void {
  delete (globalThis as TelemetryGlobal)[REGISTRY_KEY];
}

/**
 * Dispatches one breaker's or semaphore's events to its resolved
 * integrations
 */
export class TelemetryDispatcher {
  private readonly options?: TelemetryOptions;
  private readonly onError: (message: string, cause: unknown) => void;

  constructor(params: {
    options?: TelemetryOptions;
    onError: (message: string, cause: unknown) => void;
  }) {
    this.options = params.options;
    this.onError = params.onError;
  }

  private getIntegrations(): Telemetry[] {
    if (this.options?.isEnabled === false) {
      return [];
    }
    const local = this.options?.integrations;
    if (local !== undefined) {
      return Array.isArray(local) ? local : [local];
    }
    return (globalThis as TelemetryGlobal)[REGISTRY_KEY] ?? [];
  }

  executeCall<T>(
    params: Omit<ExecuteCallParams<T>, 'execute'>,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.runGuarded(
      'executeCall',
      (integration, execute) =>
        integration.executeCall?.({ ...params, execute }),
      work,
    );
  }

  executeHealthCheck(
    params: Omit<ExecuteHealthCheckParams, 'execute'>,
    work: () => Promise<void>,
  ): Promise<void> {
    return this.runGuarded(
      'executeHealthCheck',
      (integration, execute) =>
        integration.executeHealthCheck?.({ ...params, execute }),
      work,
    );
  }

  /**
   * Send an event to every integration implementing its hook. A failing
   * hook must not affect the caller or other integrations, so its error is
   * reported through `onError`.
   */
  emit<K extends EventHook>(hook: K, event: EventOf<K>): void {
    for (const integration of this.getIntegrations()) {
      try {
        (integration[hook] as ((event: EventOf<K>) => void) | undefined)?.call(
          integration,
          event,
        );
      } catch (err) {
        this.onError(`Telemetry integration ${hook} threw`, err);
      }
    }
  }

  /**
   * Runs `work` through the integrations' wrappers, so it starts inside
   * their context, but settles with the outcome of `work` itself: an
   * integration cannot change the result, delay it, or run `work` twice.
   * Its own failures are reported through `onError`.
   */
  private runGuarded<T>(
    method: string,
    wrap: (
      integration: Telemetry,
      execute: () => Promise<T>,
    ) => Promise<T> | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    let started: Promise<T> | undefined;
    const run = (): Promise<T> => {
      if (!started) {
        try {
          started = work();
        } catch (err) {
          started = Promise.reject(err);
        }
      }
      return started;
    };

    // The first integration is the outermost wrapper
    let next = run;
    for (const integration of this.getIntegrations().toReversed()) {
      const inner = next;
      next = () => wrap(integration, inner) ?? inner();
    }

    let chain: Promise<T>;
    try {
      chain = next();
    } catch (err) {
      chain = Promise.reject(err);
    }
    // Integrations start the work synchronously; if none did, start it now
    const result = run();

    void Promise.allSettled([result, chain]).then(([own, wrapped]) => {
      // Rethrowing the work's own error is expected; anything else is a
      // failure of an integration
      if (
        wrapped.status === 'rejected' &&
        (own.status === 'fulfilled' || wrapped.reason !== own.reason)
      ) {
        this.onError(`Telemetry integration ${method} failed`, wrapped.reason);
      }
    });

    return result;
  }
}
