const BRAND = Symbol.for('zenvark.error');

export type ZenvarkErrorParams<
  TCode extends string,
  TDetails extends Record<string, unknown>,
> = {
  message: string;
  code: TCode;
  details: TDetails;
  cause?: unknown;
};

/**
 * Base class for all errors thrown by zenvark.
 *
 * `instanceof` works as usual. When the prototype chain cannot be trusted
 * (two copies of zenvark in `node_modules`, errors crossing realms), use the
 * static `isInstance()` guard on the concrete error class instead. It matches on a
 * shared `Symbol.for` brand plus the error `code`, so it does not depend on
 * class identity.
 */
export abstract class ZenvarkError<
  TCode extends string = string,
  TDetails extends Record<string, unknown> = Record<string, unknown>,
> extends Error {
  readonly code: TCode;
  readonly details: TDetails;
  readonly [BRAND] = true;

  constructor(params: ZenvarkErrorParams<TCode, TDetails>) {
    super(params.message, { cause: params.cause });
    this.name = new.target.name;
    this.code = params.code;
    this.details = params.details;
  }

  static isZenvarkError(value: unknown): value is ZenvarkError {
    return typeof value === 'object' && value !== null && BRAND in value;
  }

  protected static hasCode<TCode extends string>(
    value: unknown,
    code: TCode,
  ): value is ZenvarkError<TCode> {
    return ZenvarkError.isZenvarkError(value) && value.code === code;
  }
}
