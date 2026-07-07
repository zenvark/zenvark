export {
  type AcquireOptions,
  AdaptiveSemaphore,
  type AdaptiveSemaphoreOptions,
  type AimdOptions,
  type FallbackGate,
  Lease,
  type WithLeaseOptions,
} from './adaptive-semaphore.ts';
export {
  AcquireResult,
  LeaseOutcome,
  LimitChangeDirection,
} from './constants.ts';
export { AcquireTimeoutError } from './errors/acquire-timeout-error.ts';
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
