import {
  context,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import type {
  BlockedRequestEvent,
  ExecuteCallParams,
  ExecuteHealthCheckParams,
  StateChangeEvent,
  Telemetry,
} from 'zenvark';
import { CallResult } from 'zenvark';

export type ZenvarkOtelOptions = {
  /**
   * Tracer to create spans with. Defaults to the `zenvark` tracer of the
   * globally registered tracer provider.
   */
  tracer?: Tracer;
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

  constructor(options: ZenvarkOtelOptions = {}) {
    this.tracer = options.tracer;
  }

  // The global tracer is looked up per span: one taken at construction stays
  // a no-op if the app registers its SDK later through another copy of
  // @opentelemetry/api
  private getTracer(): Tracer {
    return this.tracer ?? trace.getTracer(TRACER_NAME);
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
      attributes: { 'zenvark.breaker.id': breakerId },
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
      attributes: {
        'zenvark.breaker.id': breakerId,
        'zenvark.healthcheck.type': type,
      },
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
        attributes: { 'zenvark.breaker.id': breakerId },
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
        attributes: {
          'zenvark.breaker.id': breakerId,
          'zenvark.circuit.state': state,
        },
      })
      .end();
  }
}
