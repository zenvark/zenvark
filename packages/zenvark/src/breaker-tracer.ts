import type {
  RecordBlockedRequestParams,
  RecordStateChangeParams,
} from './breaker-metrics-recorder.ts';
import type { HealthCheckType } from './constants.ts';

export type TraceCallParams<T> = {
  breakerId: string;
  /**
   * Runs the protected call. Its rejection is the call's failure.
   */
  execute: () => Promise<T>;
};

export type TraceHealthCheckParams = {
  breakerId: string;
  type: HealthCheckType;
  /**
   * Aborted when the check is cancelled (the breaker stopped or lost
   * leadership); a rejection after that is not a health check failure.
   */
  signal: AbortSignal;
  /**
   * Runs the health check. Its rejection is the check's failure.
   */
  execute: () => Promise<void>;
};

/**
 * Tracing interface for circuit breaker events, independent of any tracing
 * library. Implement this interface to integrate with your tracing system,
 * or use `@zenvark/otel` for OpenTelemetry.
 */
export type BreakerTracer = {
  /**
   * Wrap a protected call. Must invoke `execute` exactly once and settle
   * with its result or rethrow its error. Running `execute` inside the
   * call's span context lets spans created by the call nest under it.
   */
  traceCall<T>(params: TraceCallParams<T>): Promise<T>;

  /**
   * Wrap a health check attempt. Must invoke `execute` exactly once and
   * settle with its result or rethrow its error.
   */
  traceHealthCheck(params: TraceHealthCheckParams): Promise<void>;

  /**
   * Record a request blocked by an open circuit
   */
  recordBlockedRequest?(params: RecordBlockedRequestParams): void;

  /**
   * Record a circuit state transition. Called on the leader only.
   */
  recordStateChange?(params: RecordStateChangeParams): void;
};
