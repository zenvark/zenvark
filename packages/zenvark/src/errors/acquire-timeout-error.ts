import { InternalError } from '@lokalise/node-core';

type AcquireTimeoutErrorDetails = {
  semaphoreId: string;
  timeoutMs: number;
  class?: string;
};

export class AcquireTimeoutError extends InternalError<AcquireTimeoutErrorDetails> {
  constructor(details: AcquireTimeoutErrorDetails) {
    super({
      message: 'Timed out waiting for a semaphore lease',
      errorCode: 'SEMAPHORE_ACQUIRE_TIMEOUT',
      details,
    });
  }
}
