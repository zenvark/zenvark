import { describe, expect, it } from 'vitest';
import { ExponentialBackoff } from './ExponentialBackoff.ts';

describe('ExponentialBackoff', () => {
	it('should return the initial delay on the first attempt', () => {
		const backoff = new ExponentialBackoff({
			initialDelayMs: 100,
			multiplier: 2,
		});

		expect(backoff.getDelayMs(1)).toBe(100);
	});

	it('should increase the delay exponentially with each attempt', () => {
		const backoff = new ExponentialBackoff({
			initialDelayMs: 100,
			multiplier: 2,
		});

		expect(backoff.getDelayMs(1)).toBe(100); // 100 * 2^0
		expect(backoff.getDelayMs(2)).toBe(200); // 100 * 2^1
		expect(backoff.getDelayMs(3)).toBe(400); // 100 * 2^2
		expect(backoff.getDelayMs(4)).toBe(800); // 100 * 2^3
	});

	it('should cap the delay at maxDelayMs if specified', () => {
		const backoff = new ExponentialBackoff({
			initialDelayMs: 100,
			multiplier: 3,
			maxDelayMs: 500,
		});

		expect(backoff.getDelayMs(1)).toBe(100); // 100
		expect(backoff.getDelayMs(2)).toBe(300); // 100 * 3
		expect(backoff.getDelayMs(3)).toBe(500); // 100 * 9 = 900 → capped at 500
		expect(backoff.getDelayMs(4)).toBe(500); // 100 * 27 = 2700 → capped
	});

	it('should handle multiplier of 1 (constant growth)', () => {
		const backoff = new ExponentialBackoff({
			initialDelayMs: 200,
			multiplier: 1,
		});

		expect(backoff.getDelayMs(1)).toBe(200);
		expect(backoff.getDelayMs(2)).toBe(200);
		expect(backoff.getDelayMs(5)).toBe(200);
	});

	it('should handle initialDelayMs of 0 (always zero)', () => {
		const backoff = new ExponentialBackoff({
			initialDelayMs: 0,
			multiplier: 2,
		});

		expect(backoff.getDelayMs(1)).toBe(0);
		expect(backoff.getDelayMs(5)).toBe(0);
	});
});
