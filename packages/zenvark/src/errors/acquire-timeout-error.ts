import { ZenvarkError } from './zenvark-error.ts';

type AcquireTimeoutErrorDetails = {
  semaphoreId: string;
  timeoutMs: number;
  class?: string;
};

export class AcquireTimeoutError extends ZenvarkError<
  'SEMAPHORE_ACQUIRE_TIMEOUT',
  AcquireTimeoutErrorDetails
> {
  static readonly code = 'SEMAPHORE_ACQUIRE_TIMEOUT';

  static isInstance(value: unknown): value is AcquireTimeoutError {
    return ZenvarkError.hasCode(value, AcquireTimeoutError.code);
  }

  constructor(details: AcquireTimeoutErrorDetails) {
    super({
      message: 'Timed out waiting for a semaphore lease',
      code: AcquireTimeoutError.code,
      details,
    });
  }
}
