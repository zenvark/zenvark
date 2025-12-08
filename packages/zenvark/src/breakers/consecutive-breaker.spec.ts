import { describe, expect, it } from 'vitest';
import { CallResult } from '../constants.ts';
import type { CallResultEvent } from '../types.ts';
import { ConsecutiveBreaker } from './consecutive-breaker.ts';

describe('ConsecutiveBreaker', () => {
  const createEvent = (
    callResult: CallResult,
    timestamp: number,
    id = 'test-id',
  ): CallResultEvent => ({
    id,
    callResult,
    timestamp,
  });

  describe('shouldOpenCircuit', () => {
    it('should return false for empty events array', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 3 });
      expect(breaker.shouldOpenCircuit([])).toBe(false);
    });

    it('should return false when consecutive failures are below threshold', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 3 });
      const events: CallResultEvent[] = [
        createEvent(CallResult.FAILURE, 1000),
        createEvent(CallResult.FAILURE, 2000),
        createEvent(CallResult.SUCCESS, 3000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(false);
    });

    it('should return true when consecutive failures meet threshold', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 3 });
      const events: CallResultEvent[] = [
        createEvent(CallResult.SUCCESS, 1000),
        createEvent(CallResult.FAILURE, 2000),
        createEvent(CallResult.FAILURE, 3000),
        createEvent(CallResult.FAILURE, 4000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(true);
    });

    it('should return true when consecutive failures exceed threshold', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 2 });
      const events: CallResultEvent[] = [
        createEvent(CallResult.FAILURE, 1000),
        createEvent(CallResult.FAILURE, 2000),
        createEvent(CallResult.FAILURE, 3000),
        createEvent(CallResult.FAILURE, 4000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(true);
    });

    it('should only count consecutive failures from the end', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 3 });
      const events: CallResultEvent[] = [
        createEvent(CallResult.FAILURE, 1000),
        createEvent(CallResult.FAILURE, 2000),
        createEvent(CallResult.FAILURE, 3000),
        createEvent(CallResult.SUCCESS, 4000),
        createEvent(CallResult.FAILURE, 5000),
        createEvent(CallResult.FAILURE, 6000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(false);
    });

    it('should work with threshold of 1', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 1 });
      const events: CallResultEvent[] = [
        createEvent(CallResult.SUCCESS, 1000),
        createEvent(CallResult.FAILURE, 2000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(true);
    });

    it('should return false when all calls are successful', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 3 });
      const events: CallResultEvent[] = [
        createEvent(CallResult.SUCCESS, 1000),
        createEvent(CallResult.SUCCESS, 2000),
        createEvent(CallResult.SUCCESS, 3000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(false);
    });

    it('should reset consecutive count on success', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 4 });
      const events: CallResultEvent[] = [
        createEvent(CallResult.FAILURE, 1000),
        createEvent(CallResult.FAILURE, 2000),
        createEvent(CallResult.FAILURE, 3000),
        createEvent(CallResult.SUCCESS, 4000),
        createEvent(CallResult.FAILURE, 5000),
        createEvent(CallResult.FAILURE, 6000),
        createEvent(CallResult.FAILURE, 7000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(false);
    });
  });
});
