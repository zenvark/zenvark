import { Counter, Histogram, Registry } from 'prom-client';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	getOrCreateCounter,
	getOrCreateHistogram,
} from './getOrCreateMetric.ts';

describe('getOrCreateMetric', () => {
	let registry: Registry;

	beforeEach(() => {
		registry = new Registry();
	});

	describe('getOrCreateCounter', () => {
		it('should return existing counter if found in registry', () => {
			const config = {
				name: 'test_counter',
				help: 'Test counter',
				labelNames: ['label1'] as const,
				registers: [registry],
			};

			const existingCounter = new Counter(config);

			const result = getOrCreateCounter(registry, config);

			expect(result).toBe(existingCounter);
		});

		it('should create new counter if not found in registry', () => {
			const config = {
				name: 'test_counter',
				help: 'Test counter',
				labelNames: ['label1'] as const,
				registers: [registry],
			};

			const result = getOrCreateCounter(registry, config);

			expect(result).toBeInstanceOf(Counter);
			expect(registry.getSingleMetric(config.name)).toBe(result);
		});
	});

	describe('getOrCreateHistogram', () => {
		it('should return existing histogram if found in registry', () => {
			const config = {
				name: 'test_histogram',
				help: 'Test histogram',
				labelNames: ['label1'] as const,
				buckets: [0.1, 0.5, 1, 2.5, 5, 10],
				registers: [registry],
			};

			const existingHistogram = new Histogram(config);

			const result = getOrCreateHistogram(registry, config);

			expect(result).toBe(existingHistogram);
		});

		it('should create new histogram if not found in registry', () => {
			const config = {
				name: 'test_histogram',
				help: 'Test histogram',
				labelNames: ['label1'] as const,
				buckets: [0.1, 0.5, 1, 2.5, 5, 10],
				registers: [registry],
			};

			const result = getOrCreateHistogram(registry, config);

			expect(result).toBeInstanceOf(Histogram);
			expect(registry.getSingleMetric(config.name)).toBe(result);
		});
	});
});
