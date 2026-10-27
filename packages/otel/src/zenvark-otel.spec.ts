import { cp, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { AcquireResult, CircuitState, HealthCheckType } from 'zenvark';
import { ZenvarkOtel } from './zenvark-otel.ts';

describe('ZenvarkOtel', () => {
  const breakerId = 'testBreaker';
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  const testTracer = provider.getTracer('test');

  const spans = (name: string) =>
    exporter.getFinishedSpans().filter((s) => s.name === name);

  beforeAll(() => {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
  });

  beforeEach(() => {
    exporter.reset();
  });

  afterAll(() => {
    context.disable();
  });

  describe('executeCall', () => {
    const telemetry = new ZenvarkOtel({ tracer: testTracer });

    it('nests the call span between the caller and spans the call creates', async () => {
      const result = await testTracer.startActiveSpan(
        'request',
        async (request) => {
          const value = await telemetry.executeCall({
            breakerId,
            execute: async () => {
              testTracer.startSpan('http').end();
              return 'ok';
            },
          });
          request.end();
          return value;
        },
      );

      expect(result).toBe('ok');
      const [request] = spans('request');
      const [call] = spans('zenvark.call');
      const [http] = spans('http');
      expect(call?.kind).toBe(SpanKind.CLIENT);
      expect(call?.attributes).toEqual({
        'zenvark.breaker.id': breakerId,
        'zenvark.call.result': 'success',
      });
      expect(call?.status.code).toBe(SpanStatusCode.UNSET);
      expect(call?.parentSpanContext?.spanId).toBe(
        request?.spanContext().spanId,
      );
      expect(http?.parentSpanContext?.spanId).toBe(call?.spanContext().spanId);
    });

    it('marks a failed call as an error and rethrows', async () => {
      const error = new Error('boom');

      await expect(
        telemetry.executeCall({
          breakerId,
          execute: () => Promise.reject(error),
        }),
      ).rejects.toBe(error);

      const [call] = spans('zenvark.call');
      expect(call?.attributes['zenvark.call.result']).toBe('failure');
      expect(call?.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'boom',
      });
      expect(call?.events.map((e) => e.name)).toEqual(['exception']);
    });

    it('marks a call rejected with a non-error value as an error', async () => {
      await expect(
        telemetry.executeCall({
          breakerId,
          execute: () => Promise.reject('nope'),
        }),
      ).rejects.toBe('nope');

      const [call] = spans('zenvark.call');
      expect(call?.status.code).toBe(SpanStatusCode.ERROR);
      expect(call?.events).toEqual([]);
    });
  });

  describe('executeHealthCheck', () => {
    const telemetry = new ZenvarkOtel({ tracer: testTracer });

    it('starts a new trace even when a span is active', async () => {
      await testTracer.startActiveSpan('unrelated', async (unrelated) => {
        await telemetry.executeHealthCheck({
          breakerId,
          type: HealthCheckType.RECOVERY,
          signal: new AbortController().signal,
          execute: async () => {
            testTracer.startSpan('ping').end();
          },
        });
        unrelated.end();
      });

      const [check] = spans('zenvark.healthcheck');
      const [ping] = spans('ping');
      expect(check?.parentSpanContext).toBeUndefined();
      expect(check?.attributes).toEqual({
        'zenvark.breaker.id': breakerId,
        'zenvark.healthcheck.type': 'recovery',
        'zenvark.healthcheck.result': 'success',
      });
      expect(ping?.parentSpanContext?.spanId).toBe(check?.spanContext().spanId);
    });

    it('marks a failed check as an error and rethrows', async () => {
      const error = new Error('down');

      await expect(
        telemetry.executeHealthCheck({
          breakerId,
          type: HealthCheckType.IDLE,
          signal: new AbortController().signal,
          execute: () => Promise.reject(error),
        }),
      ).rejects.toBe(error);

      const [check] = spans('zenvark.healthcheck');
      expect(check?.attributes['zenvark.healthcheck.result']).toBe('failure');
      expect(check?.status.code).toBe(SpanStatusCode.ERROR);
    });

    it('records no result for a cancelled check', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        telemetry.executeHealthCheck({
          breakerId,
          type: HealthCheckType.IDLE,
          signal: controller.signal,
          execute: () => Promise.reject(new Error('aborted')),
        }),
      ).rejects.toThrow('aborted');

      const [check] = spans('zenvark.healthcheck');
      expect(check?.attributes['zenvark.healthcheck.result']).toBeUndefined();
      expect(check?.status.code).toBe(SpanStatusCode.UNSET);
    });
  });

  it('records a blocked request as an error span under the caller', () => {
    const telemetry = new ZenvarkOtel({ tracer: testTracer });

    testTracer.startActiveSpan('request', (request) => {
      telemetry.onBlockedRequest({ breakerId });
      request.end();
    });

    const [request] = spans('request');
    const [blocked] = spans('zenvark.blocked');
    expect(blocked?.attributes).toEqual({ 'zenvark.breaker.id': breakerId });
    expect(blocked?.status.code).toBe(SpanStatusCode.ERROR);
    expect(blocked?.parentSpanContext?.spanId).toBe(
      request?.spanContext().spanId,
    );
  });

  it('records a state change in a new trace', () => {
    const telemetry = new ZenvarkOtel({ tracer: testTracer });

    testTracer.startActiveSpan('unrelated', (unrelated) => {
      telemetry.onStateChange({ breakerId, state: CircuitState.OPEN });
      unrelated.end();
    });

    const [change] = spans('zenvark.state_change');
    expect(change?.parentSpanContext).toBeUndefined();
    expect(change?.attributes).toEqual({
      'zenvark.breaker.id': breakerId,
      'zenvark.circuit.state': 'open',
    });
  });

  describe('onAcquire', () => {
    const telemetry = new ZenvarkOtel({ tracer: testTracer });
    const durationMs = ([s, ns]: [number, number]) => s * 1000 + ns / 1e6;

    it('records the wait as a span under the caller', () => {
      testTracer.startActiveSpan('request', (request) => {
        telemetry.onAcquire({
          semaphoreId: 'testSemaphore',
          class: 'bulk',
          result: AcquireResult.ACQUIRED,
          waitMs: 250,
        });
        request.end();
      });

      const [request] = spans('request');
      const [acquire] = spans('zenvark.semaphore.acquire');
      expect(acquire?.parentSpanContext?.spanId).toBe(
        request?.spanContext().spanId,
      );
      expect(acquire?.attributes).toEqual({
        'zenvark.semaphore.id': 'testSemaphore',
        'zenvark.semaphore.class': 'bulk',
        'zenvark.semaphore.acquire.result': 'acquired',
      });
      expect(acquire?.status.code).toBe(SpanStatusCode.UNSET);
      expect(durationMs(acquire?.duration ?? [0, 0])).toBeCloseTo(250, -1);
    });

    it('marks a timed out acquire as an error', () => {
      telemetry.onAcquire({
        semaphoreId: 'testSemaphore',
        result: AcquireResult.TIMEOUT,
        waitMs: 100,
      });

      const [acquire] = spans('zenvark.semaphore.acquire');
      expect(acquire?.attributes).not.toHaveProperty('zenvark.semaphore.class');
      expect(acquire?.status.code).toBe(SpanStatusCode.ERROR);
    });
  });

  describe('without a tracer option', () => {
    let restore: (() => Promise<void> | void) | undefined;

    afterEach(async () => {
      await restore?.();
      restore = undefined;
    });

    // A duplicate install of @opentelemetry/api, as when the app and this
    // package resolve it to different directories. It has no dependencies,
    // so a copy of the package directory is a complete second instance.
    const importApiCopy = async () => {
      const entry = createRequire(import.meta.url).resolve(
        '@opentelemetry/api',
      );
      const packageDir = resolve(entry, '../../..');
      const copyDir = await mkdtemp(join(tmpdir(), 'zenvark-otel-api-'));
      await cp(packageDir, copyDir, { recursive: true });
      const api: typeof import('@opentelemetry/api') = await import(
        pathToFileURL(join(copyDir, relative(packageDir, entry))).href
      );
      return { api, cleanup: () => rm(copyDir, { recursive: true }) };
    };

    it('exports through a provider registered after construction', () => {
      const telemetry = new ZenvarkOtel();
      trace.setGlobalTracerProvider(provider);
      restore = () => trace.disable();

      telemetry.onBlockedRequest({ breakerId });

      expect(spans('zenvark.blocked')).toHaveLength(1);
    });

    it('exports through a provider registered by another copy of the API', async () => {
      const telemetry = new ZenvarkOtel();
      telemetry.onBlockedRequest({ breakerId });

      const { api: otherApi, cleanup } = await importApiCopy();
      expect(otherApi.trace).not.toBe(trace);
      otherApi.trace.setGlobalTracerProvider(provider);
      restore = async () => {
        otherApi.trace.disable();
        await cleanup();
      };

      telemetry.onBlockedRequest({ breakerId });

      expect(spans('zenvark.blocked')).toHaveLength(1);
    });
  });
});
