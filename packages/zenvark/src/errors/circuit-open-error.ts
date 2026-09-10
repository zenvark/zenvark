import { ZenvarkError } from './zenvark-error.ts';

type CircuitOpenErrorDetails = {
  circuitId: string;
};

export class CircuitOpenError extends ZenvarkError<
  'CIRCUIT_IS_OPEN',
  CircuitOpenErrorDetails
> {
  static readonly code = 'CIRCUIT_IS_OPEN';

  static isInstance(value: unknown): value is CircuitOpenError {
    return ZenvarkError.hasCode(value, CircuitOpenError.code);
  }

  constructor(circuitId: string) {
    super({
      message: 'Circuit is open',
      code: CircuitOpenError.code,
      details: { circuitId },
    });
  }
}
