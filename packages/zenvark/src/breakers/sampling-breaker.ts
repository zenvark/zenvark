import { CallResult } from '../constants.ts';
import type { CallResultEvent } from '../types.ts';
import type { BreakerStrategy } from './breaker-strategy.ts';

export interface SamplingBreakerOptions {
  /**
   * The failure threshold (0-1) for opening the circuit
   */
  threshold: number;
  /**
   * The duration of the sampling window in milliseconds
   */
  duration: number;
  /**
   * Minimum number of calls required before the circuit can be opened
   */
  minimumNumberOfCalls: number;
}

/**
 * Circuit breaker strategy that opens the circuit when the failure rate
 * exceeds a threshold within a time-based sampling window.
 */
export class SamplingBreaker implements BreakerStrategy {
  private readonly threshold: number;
  private readonly duration: number;
  private readonly minimumNumberOfCalls: number;

  constructor(options: SamplingBreakerOptions) {
    this.threshold = options.threshold;
    this.duration = options.duration;
    this.minimumNumberOfCalls = options.minimumNumberOfCalls;
  }

  shouldOpenCircuit(events: CallResultEvent[]): boolean {
    const latestEvent = events.at(-1);
    if (!latestEvent) {
      return false;
    }

    const cutoffTime = latestEvent.timestamp - this.duration;

    const timeWindowEvents = events.filter(
      (event) => event.timestamp >= cutoffTime,
    );

    if (timeWindowEvents.length < this.minimumNumberOfCalls) {
      return false;
    }

    const failures = timeWindowEvents.filter(
      (event) => event.callResult === CallResult.FAILURE,
    ).length;
    const failureRate = failures / timeWindowEvents.length;

    return failureRate >= this.threshold;
  }
}
