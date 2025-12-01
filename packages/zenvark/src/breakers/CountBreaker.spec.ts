import { describe, expect, it } from 'vitest';
import { CallResultEnum } from '../constants.ts';
import type { CallResultEvent } from '../types.ts';
import { CountBreaker } from './CountBreaker.ts';

describe('CountBreaker', () => {
	const createEvent = (
		callResult: CallResultEnum,
		timestamp: number,
		id = 'test-id',
	): CallResultEvent => ({
		id,
		callResult,
		timestamp,
	});

	describe('shouldOpenCircuit', () => {
		it('should return false for empty events array', () => {
			const breaker = new CountBreaker({
				threshold: 0.5,
				size: 10,
				minimumNumberOfCalls: 10,
			});

			expect(breaker.shouldOpenCircuit([])).toBe(false);
		});

		it('should return false when not enough calls', () => {
			const breaker = new CountBreaker({
				threshold: 0.5,
				size: 10,
				minimumNumberOfCalls: 5,
			});

			const events: CallResultEvent[] = [
				createEvent(CallResultEnum.FAILURE, 1000),
				createEvent(CallResultEnum.FAILURE, 2000),
				createEvent(CallResultEnum.FAILURE, 3000),
			];

			expect(breaker.shouldOpenCircuit(events)).toBe(false);
		});

		it('should return false when failure rate is below threshold', () => {
			const breaker = new CountBreaker({
				threshold: 0.5,
				size: 10,
				minimumNumberOfCalls: 5,
			});

			const events: CallResultEvent[] = [
				createEvent(CallResultEnum.SUCCESS, 1000),
				createEvent(CallResultEnum.SUCCESS, 2000),
				createEvent(CallResultEnum.FAILURE, 3000),
				createEvent(CallResultEnum.SUCCESS, 4000),
				createEvent(CallResultEnum.SUCCESS, 5000),
			];

			expect(breaker.shouldOpenCircuit(events)).toBe(false);
		});

		it('should return true when failure rate meets threshold', () => {
			const breaker = new CountBreaker({
				threshold: 0.5,
				size: 10,
				minimumNumberOfCalls: 4,
			});

			const events: CallResultEvent[] = [
				createEvent(CallResultEnum.FAILURE, 1000),
				createEvent(CallResultEnum.FAILURE, 2000),
				createEvent(CallResultEnum.SUCCESS, 3000),
				createEvent(CallResultEnum.SUCCESS, 4000),
			];

			expect(breaker.shouldOpenCircuit(events)).toBe(true);
		});

		it('should return true when failure rate exceeds threshold', () => {
			const breaker = new CountBreaker({
				threshold: 0.4,
				size: 10,
				minimumNumberOfCalls: 5,
			});

			const events: CallResultEvent[] = [
				createEvent(CallResultEnum.FAILURE, 1000),
				createEvent(CallResultEnum.FAILURE, 2000),
				createEvent(CallResultEnum.FAILURE, 3000),
				createEvent(CallResultEnum.SUCCESS, 4000),
				createEvent(CallResultEnum.SUCCESS, 5000),
			];

			expect(breaker.shouldOpenCircuit(events)).toBe(true);
		});

		it('should only consider recent events within window size', () => {
			const breaker = new CountBreaker({
				threshold: 0.5,
				size: 3,
				minimumNumberOfCalls: 3,
			});

			const events: CallResultEvent[] = [
				createEvent(CallResultEnum.FAILURE, 1000),
				createEvent(CallResultEnum.FAILURE, 2000),
				createEvent(CallResultEnum.FAILURE, 3000),
				createEvent(CallResultEnum.SUCCESS, 4000),
				createEvent(CallResultEnum.SUCCESS, 5000),
				createEvent(CallResultEnum.SUCCESS, 6000),
			];

			expect(breaker.shouldOpenCircuit(events)).toBe(false);
		});

		it('should work with 100% failure threshold', () => {
			const breaker = new CountBreaker({
				threshold: 1.0,
				size: 5,
				minimumNumberOfCalls: 3,
			});

			const events: CallResultEvent[] = [
				createEvent(CallResultEnum.FAILURE, 1000),
				createEvent(CallResultEnum.FAILURE, 2000),
				createEvent(CallResultEnum.SUCCESS, 3000),
			];

			expect(breaker.shouldOpenCircuit(events)).toBe(false);

			const allFailureEvents: CallResultEvent[] = [
				createEvent(CallResultEnum.FAILURE, 1000),
				createEvent(CallResultEnum.FAILURE, 2000),
				createEvent(CallResultEnum.FAILURE, 3000),
			];

			expect(breaker.shouldOpenCircuit(allFailureEvents)).toBe(true);
		});

		it('should work with 0% failure threshold', () => {
			const breaker = new CountBreaker({
				threshold: 0.0,
				size: 5,
				minimumNumberOfCalls: 3,
			});

			const events: CallResultEvent[] = [
				createEvent(CallResultEnum.SUCCESS, 1000),
				createEvent(CallResultEnum.SUCCESS, 2000),
				createEvent(CallResultEnum.SUCCESS, 3000),
			];

			// With 0% threshold, even 0% failure rate (0 >= 0) triggers the circuit
			expect(breaker.shouldOpenCircuit(events)).toBe(true);

			const withOneFailure: CallResultEvent[] = [
				createEvent(CallResultEnum.SUCCESS, 1000),
				createEvent(CallResultEnum.SUCCESS, 2000),
				createEvent(CallResultEnum.FAILURE, 3000),
			];

			// Any failure (33% >= 0%) should trigger circuit when threshold is 0%
			expect(breaker.shouldOpenCircuit(withOneFailure)).toBe(true);
		});
	});
});
