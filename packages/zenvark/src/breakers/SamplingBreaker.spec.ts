import { describe, expect, it } from 'vitest';
import { CallResultEnum } from '../constants.ts';
import type { CallResultEvent } from '../types.ts';
import { SamplingBreaker } from './SamplingBreaker.ts';

describe('SamplingBreaker', () => {
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
      const breaker = new SamplingBreaker({
        threshold: 0.5,
        duration: 10000,
        minimumNumberOfCalls: 10,
      });

      expect(breaker.shouldOpenCircuit([])).toBe(false);
    });

    it('should return false when not enough calls in time window', () => {
      const breaker = new SamplingBreaker({
        threshold: 0.5,
        duration: 5000,
        minimumNumberOfCalls: 5,
      });

      const now = Date.now();
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.FAILURE, now - 3000),
        createEvent(CallResultEnum.FAILURE, now - 2000),
        createEvent(CallResultEnum.FAILURE, now - 1000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(false);
    });

    it('should return false when failure rate is below threshold', () => {
      const breaker = new SamplingBreaker({
        threshold: 0.5,
        duration: 10000,
        minimumNumberOfCalls: 5,
      });

      const now = Date.now();
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.SUCCESS, now - 8000),
        createEvent(CallResultEnum.SUCCESS, now - 6000),
        createEvent(CallResultEnum.FAILURE, now - 4000),
        createEvent(CallResultEnum.SUCCESS, now - 2000),
        createEvent(CallResultEnum.SUCCESS, now),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(false);
    });

    it('should return true when failure rate meets threshold', () => {
      const breaker = new SamplingBreaker({
        threshold: 0.5,
        duration: 10000,
        minimumNumberOfCalls: 4,
      });

      const now = Date.now();
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.FAILURE, now - 8000),
        createEvent(CallResultEnum.FAILURE, now - 6000),
        createEvent(CallResultEnum.SUCCESS, now - 4000),
        createEvent(CallResultEnum.SUCCESS, now),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(true);
    });

    it('should return true when failure rate exceeds threshold', () => {
      const breaker = new SamplingBreaker({
        threshold: 0.4,
        duration: 10000,
        minimumNumberOfCalls: 5,
      });

      const now = Date.now();
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.FAILURE, now - 8000),
        createEvent(CallResultEnum.FAILURE, now - 6000),
        createEvent(CallResultEnum.FAILURE, now - 4000),
        createEvent(CallResultEnum.SUCCESS, now - 2000),
        createEvent(CallResultEnum.SUCCESS, now),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(true);
    });

    it('should exclude events outside the time window', () => {
      const breaker = new SamplingBreaker({
        threshold: 0.5,
        duration: 5000,
        minimumNumberOfCalls: 3,
      });

      const now = Date.now();
      const events: CallResultEvent[] = [
        // Old events outside window (should be ignored)
        createEvent(CallResultEnum.FAILURE, now - 10000),
        createEvent(CallResultEnum.FAILURE, now - 8000),
        createEvent(CallResultEnum.FAILURE, now - 6000),
        // Recent events within window
        createEvent(CallResultEnum.SUCCESS, now - 3000),
        createEvent(CallResultEnum.SUCCESS, now - 2000),
        createEvent(CallResultEnum.SUCCESS, now),
      ];

      // Should only consider the last 3 events (all SUCCESS)
      expect(breaker.shouldOpenCircuit(events)).toBe(false);
    });

    it('should work with time windows', () => {
      const breaker = new SamplingBreaker({
        threshold: 0.5,
        duration: 1000,
        minimumNumberOfCalls: 2,
      });

      const now = Date.now();
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.FAILURE, now - 2000),
        createEvent(CallResultEnum.FAILURE, now - 500),
        createEvent(CallResultEnum.SUCCESS, now),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(true);
    });

    it('should work with 100% failure threshold', () => {
      const breaker = new SamplingBreaker({
        threshold: 1.0,
        duration: 10000,
        minimumNumberOfCalls: 3,
      });

      const now = Date.now();
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.FAILURE, now - 3000),
        createEvent(CallResultEnum.FAILURE, now - 2000),
        createEvent(CallResultEnum.SUCCESS, now),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(false);

      const allFailureEvents: CallResultEvent[] = [
        createEvent(CallResultEnum.FAILURE, now - 3000),
        createEvent(CallResultEnum.FAILURE, now - 2000),
        createEvent(CallResultEnum.FAILURE, now),
      ];

      expect(breaker.shouldOpenCircuit(allFailureEvents)).toBe(true);
    });

    it('should work with 0% failure threshold', () => {
      const breaker = new SamplingBreaker({
        threshold: 0.0,
        duration: 10000,
        minimumNumberOfCalls: 3,
      });

      const now = Date.now();
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.SUCCESS, now - 3000),
        createEvent(CallResultEnum.SUCCESS, now - 2000),
        createEvent(CallResultEnum.SUCCESS, now),
      ];

      // With 0% threshold, even 0% failure rate (0 >= 0) triggers the circuit
      expect(breaker.shouldOpenCircuit(events)).toBe(true);

      const withOneFailure: CallResultEvent[] = [
        createEvent(CallResultEnum.SUCCESS, now - 3000),
        createEvent(CallResultEnum.SUCCESS, now - 2000),
        createEvent(CallResultEnum.FAILURE, now),
      ];

      // Any failure (33% > 0%) should trigger circuit when threshold is 0%
      expect(breaker.shouldOpenCircuit(withOneFailure)).toBe(true);
    });
  });
});
