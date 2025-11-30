import type { BackoffStrategy } from './BackoffStrategy.ts';

export interface ExponentialBackoffOptions {
  /**
   * The initial delay in milliseconds for the first attempt (attempt = 1).
   */
  initialDelayMs: number;

  /**
   * The multiplier applied to the delay on each subsequent attempt.
   * For example, a multiplier of 2 will double the delay each time.
   */
  multiplier: number;

  /**
   * Optional maximum delay in milliseconds. The delay will not exceed this value.
   */
  maxDelayMs?: number;
}

/**
 * A backoff strategy that increases the delay exponentially with each attempt.
 */
export class ExponentialBackoff implements BackoffStrategy {
  private readonly initialDelayMs: number;
  private readonly multiplier: number;
  private readonly maxDelayMs?: number;

  constructor(options: ExponentialBackoffOptions) {
    this.initialDelayMs = options.initialDelayMs;
    this.multiplier = options.multiplier;
    this.maxDelayMs = options.maxDelayMs;
  }

  getDelayMs(attempt: number): number {
    const delay = this.initialDelayMs * this.multiplier ** (attempt - 1);
    return this.maxDelayMs ? Math.min(delay, this.maxDelayMs) : delay;
  }
}
