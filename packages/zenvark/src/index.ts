export {
  type AcquireOptions,
  AdaptiveSemaphore,
  type AdaptiveSemaphoreOptions,
  type AimdOptions,
  type FallbackGate,
  Lease,
  type WithLeaseOptions,
} from './adaptive-semaphore.ts';
export type { BackoffStrategy } from './backoffs/backoff-strategy.ts';
export { ConstantBackoff } from './backoffs/constant-backoff.ts';
export { ExponentialBackoff } from './backoffs/exponential-backoff.ts';
export type {
  BreakerMetricsRecorder,
  RecordBlockedRequestParams,
  RecordCallParams,
  RecordHealthCheckParams,
  RecordStateChangeParams,
} from './breaker-metrics-recorder.ts';
export type { BreakerStrategy } from './breakers/breaker-strategy.ts';
export { ConsecutiveBreaker } from './breakers/consecutive-breaker.ts';
export { CountBreaker } from './breakers/count-breaker.ts';
export { SamplingBreaker } from './breakers/sampling-breaker.ts';
export {
  type BreakerSemaphoreOptions,
  CircuitBreaker,
  type CircuitBreakerOptions,
  type ExecuteLeaseOptions,
  type ExecuteOptions,
} from './circuit-breaker.ts';
export {
  AcquireResult,
  CallResult,
  CircuitRole,
  CircuitState,
  HealthCheckType,
  LeaseOutcome,
  LimitChangeDirection,
} from './constants.ts';
export { AcquireTimeoutError } from './errors/acquire-timeout-error.ts';
export { CircuitOpenError } from './errors/circuit-open-error.ts';
export { SemaphoreDisposedError } from './errors/semaphore-disposed-error.ts';
export { SemaphoreUnavailableError } from './errors/semaphore-unavailable-error.ts';
export type {
  RecordAcquireParams,
  RecordLimitChangeParams,
  RecordReleaseParams,
  RecordThrottleParams,
  SemaphoreMetricsRecorder,
} from './semaphore-metrics-recorder.ts';
export type { SemaphoreClassConfig, SemaphoreState } from './types.ts';
