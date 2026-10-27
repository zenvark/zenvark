import type {
  AcquireResult,
  LeaseOutcome,
  LimitChangeDirection,
} from './constants.ts';

export type RecordAcquireParams = {
  id: string;
  class?: string;
  result: AcquireResult;
  waitMs: number;
};

export type RecordReleaseParams = {
  id: string;
  class?: string;
  outcome: LeaseOutcome;
  heldMs: number;
};

export type RecordLimitChangeParams = {
  id: string;
  limit: number;
  direction: LimitChangeDirection;
};

export type RecordThrottleParams = {
  id: string;
};

/**
 * Metrics interface for recording semaphore events.
 *
 * @deprecated Implement a `Telemetry` integration instead and register it
 * with `registerZenvarkTelemetry`; `onAcquire`, `onRelease`,
 * `onLimitChange`, `onThrottle` and `onSemaphoreInit` carry the same data.
 */
export type SemaphoreMetricsRecorder = {
  /**
   * Called once from the constructor so metrics appear in scrapes immediately.
   */
  initialize?(id: string): void;

  /**
   * Record the outcome of an acquire attempt and the time spent waiting.
   */
  recordAcquire(params: RecordAcquireParams): void;

  /**
   * Record a lease release with its caller-reported outcome and hold duration.
   */
  recordRelease(params: RecordReleaseParams): void;

  /**
   * Record a change of this process's cached view of the fleet-wide limit.
   * Fires on every node when its view changes, so the gauge is correct on
   * whichever instance a scrape hits.
   */
  recordLimitChange?(params: RecordLimitChangeParams): void;

  /**
   * Record a caller-reported throttle event (a `THROTTLED` release).
   */
  recordThrottle?(params: RecordThrottleParams): void;
};
