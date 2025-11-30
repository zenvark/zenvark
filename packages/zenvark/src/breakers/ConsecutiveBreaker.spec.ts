import { describe, expect, it } from 'vitest';
import { CallResultEnum } from '../constants.ts';
import type { CallResultEvent } from '../types.ts';
import { ConsecutiveBreaker } from './ConsecutiveBreaker.ts';

describe('ConsecutiveBreaker', () => {
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
      const breaker = new ConsecutiveBreaker({ threshold: 3 });
      expect(breaker.shouldOpenCircuit([])).toBe(false);
    });

    it('should return false when consecutive failures are below threshold', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 3 });
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.FAILURE, 1000),
        createEvent(CallResultEnum.FAILURE, 2000),
        createEvent(CallResultEnum.SUCCESS, 3000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(false);
    });

    it('should return true when consecutive failures meet threshold', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 3 });
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.SUCCESS, 1000),
        createEvent(CallResultEnum.FAILURE, 2000),
        createEvent(CallResultEnum.FAILURE, 3000),
        createEvent(CallResultEnum.FAILURE, 4000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(true);
    });

    it('should return true when consecutive failures exceed threshold', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 2 });
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.FAILURE, 1000),
        createEvent(CallResultEnum.FAILURE, 2000),
        createEvent(CallResultEnum.FAILURE, 3000),
        createEvent(CallResultEnum.FAILURE, 4000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(true);
    });

    it('should only count consecutive failures from the end', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 3 });
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.FAILURE, 1000),
        createEvent(CallResultEnum.FAILURE, 2000),
        createEvent(CallResultEnum.FAILURE, 3000),
        createEvent(CallResultEnum.SUCCESS, 4000),
        createEvent(CallResultEnum.FAILURE, 5000),
        createEvent(CallResultEnum.FAILURE, 6000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(false);
    });

    it('should work with threshold of 1', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 1 });
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.SUCCESS, 1000),
        createEvent(CallResultEnum.FAILURE, 2000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(true);
    });

    it('should return false when all calls are successful', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 3 });
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.SUCCESS, 1000),
        createEvent(CallResultEnum.SUCCESS, 2000),
        createEvent(CallResultEnum.SUCCESS, 3000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(false);
    });

    it('should reset consecutive count on success', () => {
      const breaker = new ConsecutiveBreaker({ threshold: 4 });
      const events: CallResultEvent[] = [
        createEvent(CallResultEnum.FAILURE, 1000),
        createEvent(CallResultEnum.FAILURE, 2000),
        createEvent(CallResultEnum.FAILURE, 3000),
        createEvent(CallResultEnum.SUCCESS, 4000),
        createEvent(CallResultEnum.FAILURE, 5000),
        createEvent(CallResultEnum.FAILURE, 6000),
        createEvent(CallResultEnum.FAILURE, 7000),
      ];

      expect(breaker.shouldOpenCircuit(events)).toBe(false);
    });
  });
});
