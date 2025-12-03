import type { BackoffStrategy } from './backoff-strategy.ts';

export interface ConstantBackoffOptions {
	/**
	 * The constant delay in milliseconds to apply before each attempt.
	 */
	delayMs: number;
}

/**
 * A backoff strategy that applies the same fixed delay before each attempt,
 * including the initial one.
 */
export class ConstantBackoff implements BackoffStrategy {
	private readonly delayMs: number;

	constructor(options: ConstantBackoffOptions) {
		this.delayMs = options.delayMs;
	}

	getDelayMs(_attempt: number): number {
		return this.delayMs;
	}
}
