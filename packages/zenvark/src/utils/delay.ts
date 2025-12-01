import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import { isNativeError } from 'node:util/types';

/**
 * Pauses execution for a specified number of milliseconds.
 * The returned promise resolves after `ms` milliseconds, or immediately
 * if the provided AbortSignal is already aborted. If the signal is
 * aborted during the delay, the promise resolves early.
 *
 * @param ms - Number of milliseconds to wait.
 * @param abortSignal - Optional AbortSignal to cancel the delay.
 * @returns A promise that resolves to `void` after the delay or if aborted.
 */
export const delay = async (
	ms: number,
	abortSignal?: AbortSignal,
): Promise<void> => {
	try {
		await setTimeoutAsync(ms, undefined, { signal: abortSignal });
	} catch (err) {
		if (!isNativeError(err) || err.name !== 'AbortError') {
			throw err;
		}
	}
};
