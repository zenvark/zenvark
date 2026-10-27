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
   * Wrap a protected call. Must invoke `execute` exactly once and settle
   * with its result or rethrow its error. Running `execute` inside the
   * integration's context (such as an active span) lets work done by the
   * call nest under it.
   */
  executeCall?<T>(params: ExecuteCallParams<T>): Promise<T>;

  /**
   * Wrap a health check attempt. Must invoke `execute` exactly once and
   * settle with its result or rethrow its error.
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

  executeCall<T>(execute: () => Promise<T>): Promise<T> {
    let next = execute;
    // The first integration is the outermost wrapper
    for (const integration of this.getIntegrations().toReversed()) {
      const inner = next;
      next = () =>
        integration.executeCall?.({
          breakerId: this.breakerId,
          execute: inner,
        }) ?? inner();
    }
    return next();
  }

  executeHealthCheck(
    type: HealthCheckType,
    signal: AbortSignal,
    execute: () => Promise<void>,
  ): Promise<void> {
    let next = execute;
    for (const integration of this.getIntegrations().toReversed()) {
      const inner = next;
      next = () =>
        integration.executeHealthCheck?.({
          breakerId: this.breakerId,
          type,
          signal,
          execute: inner,
        }) ?? inner();
    }
    return next();
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
