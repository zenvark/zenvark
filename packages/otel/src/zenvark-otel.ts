import {
  type Attributes,
  context,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import type {
  AcquireEvent,
  BlockedRequestEvent,
  ExecuteCallParams,
  ExecuteHealthCheckParams,
  StateChangeEvent,
  Telemetry,
} from 'zenvark';
import { AcquireResult, CallResult } from 'zenvark';

export type ZenvarkOtelOptions = {
  /**
   * Tracer to create spans with. Defaults to the `zenvark` tracer of the
   * globally registered tracer provider.
   */
  tracer?: Tracer;

  /**
   * Extra attributes for every span, either fixed or resolved from the id
   * of the breaker or semaphore the span belongs to.
   *
   * Zenvark knows what a breaker is called, not what it protects, so a
   * `zenvark.call` span carries no peer of its own. Use this to describe
   * the dependency, such as the `server.address` that OpenTelemetry's
   * semantic conventions expect on a client span:
   *
   * ```typescript
   * new ZenvarkOtel({
   *   attributes: (id) => ({ 'server.address': HOSTS[id] }),
   * });
   * ```
   *
   * Zenvark's own attributes take precedence over these, and are set
   * first, so a low `attributeCountLimit` drops these rather than the
   * breaker id and the call result.
   */
  attributes?: Attributes | ((id: string) => Attributes | undefined);
};

const TRACER_NAME = 'zenvark';

const markFailed = (span: Span, err: unknown): void => {
  if (Error.isError(err)) {
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  } else {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
};

export class ZenvarkOtel implements Telemetry {
  private readonly tracer?: Tracer;
  private readonly attributes?: ZenvarkOtelOptions['attributes'];

  constructor(options: ZenvarkOtelOptions = {}) {
    this.tracer = options.tracer;
    this.attributes = options.attributes;
  }

  // The global tracer is looked up per span: one taken at construction stays
  // a no-op if the app registers its SDK later through another copy of
  // @opentelemetry/api
  private getTracer(): Tracer {
    return this.tracer ?? trace.getTracer(TRACER_NAME);
  }

  // Zenvark's own attributes are set first, so a low `attributeCountLimit`
  // drops the configured extras rather than the breaker id and result
  private withExtras(id: string, own: Attributes): Attributes {
    const extra =
      typeof this.attributes === 'function'
        ? this.attributes(id)
        : this.attributes;
    if (extra === undefined) {
      return own;
    }

    const merged: Attributes = { ...own };
    for (const [key, value] of Object.entries(extra)) {
      if (!(key in own)) {
        merged[key] = value;
      }
    }
    return merged;
  }

  /**
   * Wrap a protected call in a `zenvark.call` span, active while the call
   * runs so spans it creates nest under it
   */
  async executeCall<T>({
    breakerId,
    execute,
  }: ExecuteCallParams<T>): Promise<T> {
    const span = this.getTracer().startSpan('zenvark.call', {
      kind: SpanKind.CLIENT,
      attributes: this.withExtras(breakerId, {
        'zenvark.breaker.id': breakerId,
      }),
    });

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        execute,
      );
      span.setAttribute('zenvark.call.result', CallResult.SUCCESS);
      return result;
    } catch (err) {
      span.setAttribute('zenvark.call.result', CallResult.FAILURE);
      markFailed(span, err);
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * Wrap a health check attempt in a `zenvark.healthcheck` span. Checks run
   * in the background, so each one starts a new trace.
   */
  async executeHealthCheck({
    breakerId,
    type,
    signal,
    execute,
  }: ExecuteHealthCheckParams): Promise<void> {
    const span = this.getTracer().startSpan('zenvark.healthcheck', {
      root: true,
      kind: SpanKind.CLIENT,
      attributes: this.withExtras(breakerId, {
        'zenvark.breaker.id': breakerId,
        'zenvark.healthcheck.type': type,
      }),
    });

    try {
      await context.with(trace.setSpan(context.active(), span), execute);
      span.setAttribute('zenvark.healthcheck.result', CallResult.SUCCESS);
    } catch (err) {
      // A cancelled check has no result
      if (!signal.aborted) {
        span.setAttribute('zenvark.healthcheck.result', CallResult.FAILURE);
        markFailed(span, err);
      }
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * Record a `zenvark.blocked` span under the caller's active span
   */
  onBlockedRequest({ breakerId }: BlockedRequestEvent): void {
    this.getTracer()
      .startSpan('zenvark.blocked', {
        kind: SpanKind.CLIENT,
        attributes: this.withExtras(breakerId, {
          'zenvark.breaker.id': breakerId,
        }),
      })
      .setStatus({ code: SpanStatusCode.ERROR, message: 'Circuit is open' })
      .end();
  }

  /**
   * Record a `zenvark.state_change` span in a new trace
   */
  onStateChange({ breakerId, state }: StateChangeEvent): void {
    this.getTracer()
      .startSpan('zenvark.state_change', {
        root: true,
        attributes: this.withExtras(breakerId, {
          'zenvark.breaker.id': breakerId,
          'zenvark.circuit.state': state,
        }),
      })
      .end();
  }

  /**
   * Record a `zenvark.semaphore.acquire` span under the caller's active
   * span. The event fires once the wait is over, so the span is started
   * back at the moment the wait began.
   */
  onAcquire({
    semaphoreId,
    class: className,
    result,
    waitMs,
  }: AcquireEvent): void {
    const endTime = Date.now();
    const span = this.getTracer().startSpan('zenvark.semaphore.acquire', {
      startTime: endTime - waitMs,
      attributes: this.withExtras(semaphoreId, {
        'zenvark.semaphore.id': semaphoreId,
        'zenvark.semaphore.acquire.result': result,
        ...(className === undefined
          ? {}
          : { 'zenvark.semaphore.class': className }),
      }),
    });
    if (result === AcquireResult.TIMEOUT) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Timed out waiting for a lease',
      });
    }
    span.end(endTime);
  }
}
