import { InternalError } from '@lokalise/node-core';

type SemaphoreDisposedErrorDetails = {
  semaphoreId: string;
};

export class SemaphoreDisposedError extends InternalError<SemaphoreDisposedErrorDetails> {
  constructor(semaphoreId: string) {
    super({
      message: 'Semaphore has been disposed',
      errorCode: 'SEMAPHORE_DISPOSED',
      details: { semaphoreId },
    });
  }
}
