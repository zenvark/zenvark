import type { CircuitState, HealthCheckType } from './constants.ts';

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

export type BlockedRequestEvent = {
  breakerId: string;
};

export type StateChangeEvent = {
  breakerId: string;
  state: CircuitState;
};

/**
 * Telemetry integration receiving circuit breaker lifecycle events,
 * independent of any telemetry library. All methods are optional;
 * implement only the ones you need. `@zenvark/otel` implements it for
 * OpenTelemetry.
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
   * Called when a request is blocked by an open circuit
   */
  onBlockedRequest?(event: BlockedRequestEvent): void;

  /**
   * Called on a circuit state transition, on the leader only
   */
  onStateChange?(event: StateChangeEvent): void;
};

export type TelemetryOptions = {
  /**
   * Set to `false` to disable telemetry for this breaker, including
   * globally registered integrations. Defaults to `true`.
   */
  isEnabled?: boolean;

  /**
   * Integrations for this breaker. When provided, they replace the
   * globally registered integrations for this breaker.
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
 * Register telemetry integrations for every circuit breaker in the process.
 * Breakers resolve integrations per event, so breakers created before the
 * registration use them too.
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
 * Dispatches one breaker's events to its resolved integrations
 */
export class BreakerTelemetry {
  private readonly breakerId: string;
  private readonly options?: TelemetryOptions;
  private readonly onError: (message: string, cause: unknown) => void;

  constructor(params: {
    breakerId: string;
    options?: TelemetryOptions;
    onError: (message: string, cause: unknown) => void;
  }) {
    this.breakerId = params.breakerId;
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

  executeCall<T>(work: () => Promise<T>): Promise<T> {
    return this.runGuarded(
      'executeCall',
      (integration, execute) =>
        integration.executeCall?.({ breakerId: this.breakerId, execute }),
      work,
    );
  }

  executeHealthCheck(
    type: HealthCheckType,
    signal: AbortSignal,
    work: () => Promise<void>,
  ): Promise<void> {
    return this.runGuarded(
      'executeHealthCheck',
      (integration, execute) =>
        integration.executeHealthCheck?.({
          breakerId: this.breakerId,
          type,
          signal,
          execute,
        }),
      work,
    );
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

  blockedRequest(): void {
    for (const integration of this.getIntegrations()) {
      this.notify('onBlockedRequest', () =>
        integration.onBlockedRequest?.({ breakerId: this.breakerId }),
      );
    }
  }

  stateChange(state: CircuitState): void {
    for (const integration of this.getIntegrations()) {
      this.notify('onStateChange', () =>
        integration.onStateChange?.({ breakerId: this.breakerId, state }),
      );
    }
  }

  // A failing event hook must not affect the breaker or other integrations
  private notify(hook: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.onError(`Telemetry integration ${hook} threw`, err);
    }
  }
}
