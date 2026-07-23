import { InternalError } from '@lokalise/node-core';

type SemaphoreUnavailableErrorDetails = {
  semaphoreId: string;
};

export class SemaphoreUnavailableError extends InternalError<SemaphoreUnavailableErrorDetails> {
  constructor(semaphoreId: string, cause: unknown) {
    super({
      message: 'Semaphore backend is unavailable',
      errorCode: 'SEMAPHORE_UNAVAILABLE',
      details: { semaphoreId },
      cause,
    });
  }
}
