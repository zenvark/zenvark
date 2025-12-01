/**
 * Interface representing a backoff strategy for attempts including the initial one.
 */
export interface BackoffStrategy {
	/**
	 * Calculates the delay in milliseconds before the specified attempt.
	 *
	 * @param attempt - The attempt number, starting from 1 for the initial call.
	 * @returns The delay in milliseconds to wait before this attempt.
	 */
	getDelayMs(attempt: number): number;
}
