import { CallResult } from '../constants.ts';
import type { CallResultEvent } from '../types.ts';
import type { BreakerStrategy } from './breaker-strategy.ts';

export interface ConsecutiveBreakerOptions {
	/**
	 * The number of consecutive failures required to open the circuit
	 */
	threshold: number;
}

/**
 * Circuit breaker strategy that opens the circuit after a specified number
 * of consecutive failures.
 */
export class ConsecutiveBreaker implements BreakerStrategy {
	private readonly threshold: number;

	constructor(options: ConsecutiveBreakerOptions) {
		this.threshold = options.threshold;
	}

	shouldOpenCircuit(events: CallResultEvent[]): boolean {
		if (events.length < this.threshold) {
			return false;
		}

		const recentEvents = events.slice(-this.threshold);

		return recentEvents.every(
			(event) => event.callResult === CallResult.FAILURE,
		);
	}
}
