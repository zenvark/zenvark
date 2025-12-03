import type { CallResultEvent } from '../types.ts';

/**
 * Strategy interface for determining when a circuit should open
 * based on call result events
 */
export interface BreakerStrategy {
	/**
	 * Check whether the circuit should open based on recent events.
	 * @param events Array of CallResultEvent (ordered from oldest to newest)
	 * @returns boolean indicating if circuit should open
	 */
	shouldOpenCircuit(events: CallResultEvent[]): boolean;
}
