import { describe, expect, it } from 'vitest';
import { AcquireTimeoutError } from './acquire-timeout-error.ts';
import { CircuitOpenError } from './circuit-open-error.ts';
import { SemaphoreDisposedError } from './semaphore-disposed-error.ts';
import { SemaphoreUnavailableError } from './semaphore-unavailable-error.ts';
import { ZenvarkError } from './zenvark-error.ts';

describe('ZenvarkError', () => {
  it('should expose code, details, cause and the concrete class name', () => {
    const cause = new Error('ECONNREFUSED');
    const err = new SemaphoreUnavailableError('sem-1', cause);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SemaphoreUnavailableError');
    expect(err.code).toBe('SEMAPHORE_UNAVAILABLE');
    expect(err.details).toEqual({ semaphoreId: 'sem-1' });
    expect(err.cause).toBe(cause);
  });

  describe('isInstance()', () => {
    it('should match an instance whose prototype chain has been broken', () => {
      const err = new CircuitOpenError('cb-1');
      // Simulates a duplicate copy of zenvark in node_modules or a cross-realm
      // error: same shape, but a foreign prototype.
      Object.setPrototypeOf(err, Error.prototype);

      expect(err instanceof CircuitOpenError).toBe(false);
      expect(CircuitOpenError.isInstance(err)).toBe(true);
      expect(ZenvarkError.isZenvarkError(err)).toBe(true);
    });

    it('should not match a zenvark error with a different code', () => {
      const err = new SemaphoreDisposedError('sem-1');

      expect(ZenvarkError.isZenvarkError(err)).toBe(true);
      expect(SemaphoreDisposedError.isInstance(err)).toBe(true);
      expect(AcquireTimeoutError.isInstance(err)).toBe(false);
      expect(CircuitOpenError.isInstance(err)).toBe(false);
    });

    it('should not match foreign errors that merely carry the same code', () => {
      const lookalike = Object.assign(new Error('Circuit is open'), {
        code: 'CIRCUIT_IS_OPEN',
        details: { circuitId: 'cb-1' },
      });

      expect(CircuitOpenError.isInstance(lookalike)).toBe(false);
      expect(ZenvarkError.isZenvarkError(lookalike)).toBe(false);
    });

    it('should reject non-object values', () => {
      expect(CircuitOpenError.isInstance(null)).toBe(false);
      expect(CircuitOpenError.isInstance(undefined)).toBe(false);
      expect(CircuitOpenError.isInstance('CIRCUIT_IS_OPEN')).toBe(false);
    });
  });
});
