import { ZenvarkError } from './zenvark-error.ts';

type SemaphoreDisposedErrorDetails = {
  semaphoreId: string;
};

export class SemaphoreDisposedError extends ZenvarkError<
  'SEMAPHORE_DISPOSED',
  SemaphoreDisposedErrorDetails
> {
  static readonly code = 'SEMAPHORE_DISPOSED';

  static isInstance(value: unknown): value is SemaphoreDisposedError {
    return ZenvarkError.hasCode(value, SemaphoreDisposedError.code);
  }

  constructor(semaphoreId: string) {
    super({
      message: 'Semaphore has been disposed',
      code: SemaphoreDisposedError.code,
      details: { semaphoreId },
    });
  }
}
