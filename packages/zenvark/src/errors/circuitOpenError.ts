import { InternalError } from '@lokalise/node-core';

type CircuitOpenErrorDetails = {
  circuitId: string;
};

export class CircuitOpenError extends InternalError<CircuitOpenErrorDetails> {
  constructor(circuitId: string) {
    super({
      message: 'Circuit is open',
      errorCode: 'CIRCUIT_IS_OPEN',
      details: {
        circuitId,
      },
    });
  }
}
