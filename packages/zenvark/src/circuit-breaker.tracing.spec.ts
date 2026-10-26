import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it, vi } from 'vitest';
import { redis } from '../test/setup-redis.ts';
import { ConstantBackoff } from './backoffs/constant-backoff.ts';
import type { BreakerTracer } from './breaker-tracer.ts';
import { ConsecutiveBreaker } from './breakers/consecutive-breaker.ts';
import { CircuitBreaker } from './circuit-breaker.ts';
import { CircuitState, HealthCheckType } from './constants.ts';
import { CircuitOpenError } from './errors/circuit-open-error.ts';

// Records events the way a tracing library would see them, and runs every
// wrapped function inside a scope so tests can tell what ran inside it
const createTracer = () => {
  const scope = new AsyncLocalStorage<string>();
  const events: string[] = [];

  const tracing: BreakerTracer = {
    traceCall: ({ breakerId, execute }) =>
      scope.run(`call:${breakerId}`, async () => {
        try {
          const result = await execute();
          events.push('call:success');
          return result;
        } catch (err) {
          events.push('call:failure');
          throw err;
        }
      }),
    traceHealthCheck: ({ type, signal, execute }) =>
      scope.run(`healthcheck:${type}`, async () => {
        try {
          await execute();
          events.push(`healthcheck:${type}:success`);
        } catch (err) {
          events.push(
            `healthcheck:${type}:${signal.aborted ? 'aborted' : 'failure'}`,
          );
          throw err;
        }
      }),
    recordBlockedRequest: ({ breakerId }) => {
      events.push(`blocked:${breakerId}`);
    },
    recordStateChange: ({ state }) => {
      events.push(`state:${state}`);
    },
  };

  return { tracing, events, activeScope: () => scope.getStore() };
};

describe('CircuitBreaker tracing', () => {
  const createCircuit = async (
    tracing: BreakerTracer,
    check: (type: HealthCheckType) => Promise<void> = () => Promise.resolve(),
  ) => {
    const circuit = new CircuitBreaker({
      id: 'test',
      redis,
      breaker: new ConsecutiveBreaker({ threshold: 1 }),
      health: { backoff: new ConstantBackoff({ delayMs: 20 }), check },
      onError: vi.fn(),
      tracing,
    });
    await circuit.start();
    return circuit;
  };

  it('runs the protected call inside the tracer and returns its result', async () => {
    const { tracing, events, activeScope } = createTracer();
    const circuit = await createCircuit(tracing);

    const result = await circuit.execute(async () => activeScope());

    expect(result).toBe('call:test');
    expect(events).toEqual(['call:success']);

    await circuit.stop();
  });

  it('lets the tracer see a failed call and still rethrows the original error', async () => {
    const { tracing, events } = createTracer();
    const circuit = await createCircuit(tracing, () =>
      Promise.reject(new Error('down')),
    );
    const error = new Error('boom');

    await expect(circuit.execute(() => Promise.reject(error))).rejects.toBe(
      error,
    );
    expect(events[0]).toBe('call:failure');

    await circuit.stop();
  });

  it('reports blocked calls, health checks and state transitions', async () => {
    const { tracing, events, activeScope } = createTracer();
    let healthy = false;
    const checkScopes: (string | undefined)[] = [];
    const circuit = await createCircuit(tracing, async () => {
      checkScopes.push(activeScope());
      if (!healthy) {
        throw new Error('down');
      }
    });

    await expect(
      circuit.execute(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await vi.waitUntil(() => circuit.state === CircuitState.OPEN);
    await expect(
      circuit.execute(() => Promise.resolve()),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    await vi.waitUntil(() =>
      events.includes(`healthcheck:${HealthCheckType.RECOVERY}:failure`),
    );
    healthy = true;
    await vi.waitUntil(() => circuit.state === CircuitState.CLOSED);
    await circuit.stop();

    expect(events.filter((e) => e.startsWith('state:'))).toEqual([
      'state:open',
      'state:closed',
    ]);
    expect(events).toContain('blocked:test');
    expect(events).toContain(`healthcheck:${HealthCheckType.RECOVERY}:success`);
    expect(checkScopes.every((s) => s === 'healthcheck:recovery')).toBe(true);
  });
});
