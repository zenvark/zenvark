import { CallResultEnum } from '../constants.ts';
import type { CallResultEvent } from '../types.ts';
import type { BreakerStrategy } from './BreakerStrategy.ts';

export interface CountBreakerOptions {
	/**
	 * The failure threshold (0-1) for opening the circuit
	 */
	threshold: number;
	/**
	 * The size of the sliding window
	 */
	size: number;
	/**
	 * Minimum number of calls required before the circuit can be opened
	 */
	minimumNumberOfCalls: number;
}

/**
 * Circuit breaker strategy that opens the circuit when the failure rate
 * exceeds a threshold within a sliding window of recent calls.
 */
export class CountBreaker implements BreakerStrategy {
	private readonly threshold: number;
	private readonly size: number;
	private readonly minimumNumberOfCalls: number;

	constructor(options: CountBreakerOptions) {
		this.threshold = options.threshold;
		this.size = options.size;
		this.minimumNumberOfCalls = options.minimumNumberOfCalls;
	}

	shouldOpenCircuit(events: CallResultEvent[]): boolean {
		const recentEvents = events.slice(-this.size);

		if (recentEvents.length < this.minimumNumberOfCalls) {
			return false;
		}

		const failures = recentEvents.filter(
			(event) => event.callResult === CallResultEnum.FAILURE,
		).length;
		const failureRate = failures / recentEvents.length;

		return failureRate >= this.threshold;
	}
}
