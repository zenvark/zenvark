import type { CallResultEnum, HealthCheckTypeEnum } from './constants.ts';

export type RecordCallParams = {
  breakerId: string;
  result: CallResultEnum;
  durationMs: number;
};

export type RecordBlockedRequestParams = {
  breakerId: string;
};

export type RecordHealthCheckParams = {
  breakerId: string;
  type: HealthCheckTypeEnum;
  result: CallResultEnum;
  durationMs: number;
};

/**
 * Metrics interface for recording circuit breaker events.
 * Implement this interface to integrate with your metrics system.
 */
export type BreakerMetricsRecorder = {
  /**
   * Initialize metrics for a circuit breaker.
   * This is called once when the circuit breaker is created.
   */
  initialize?(breakerId: string): void;

  /**
   * Record a successful or failed call
   */
  recordCall(params: RecordCallParams): void;

  /**
   * Record a blocked request when circuit is open
   */
  recordBlockedRequest(params: RecordBlockedRequestParams): void;

  /**
   * Record healthcheck attempt
   */
  recordHealthCheck(params: RecordHealthCheckParams): void;
};
