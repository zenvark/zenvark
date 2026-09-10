import { ZenvarkError } from './zenvark-error.ts';

type SemaphoreUnavailableErrorDetails = {
  semaphoreId: string;
};

export class SemaphoreUnavailableError extends ZenvarkError<
  'SEMAPHORE_UNAVAILABLE',
  SemaphoreUnavailableErrorDetails
> {
  static readonly code = 'SEMAPHORE_UNAVAILABLE';

  static isInstance(value: unknown): value is SemaphoreUnavailableError {
    return ZenvarkError.hasCode(value, SemaphoreUnavailableError.code);
  }

  constructor(semaphoreId: string, cause: unknown) {
    super({
      message: 'Semaphore backend is unavailable',
      code: SemaphoreUnavailableError.code,
      details: { semaphoreId },
      cause,
    });
  }
}
