import { describe, expect, it } from 'vitest';
import { ConstantBackoff } from './ConstantBackoff.ts';

describe('ConstantBackoff', () => {
	it('should return the configured constant delay for any attempt', () => {
		const delayMs = 1500;
		const backoff = new ConstantBackoff({ delayMs });

		expect(backoff.getDelayMs(0)).toBe(delayMs);
		expect(backoff.getDelayMs(1)).toBe(delayMs);
		expect(backoff.getDelayMs(10)).toBe(delayMs);
		expect(backoff.getDelayMs(999)).toBe(delayMs);
	});

	it('should return zero delay if delayMs is zero', () => {
		const backoff = new ConstantBackoff({ delayMs: 0 });

		expect(backoff.getDelayMs(0)).toBe(0);
		expect(backoff.getDelayMs(5)).toBe(0);
	});
});
