import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redis } from '../test/setup-redis.ts';
import { ConstantBackoff } from './backoffs/constant-backoff.ts';
import { ConsecutiveBreaker } from './breakers/consecutive-breaker.ts';
import { CircuitBreaker } from './circuit-breaker.ts';
import { CircuitRole, CircuitState, HealthCheckType } from './constants.ts';
import { CircuitOpenError } from './errors/circuit-open-error.ts';
import {
  clearRegisteredTelemetry,
  registerZenvarkTelemetry,
  type Telemetry,
} from './telemetry.ts';
import { delay } from './utils/delay.ts';

// Records events the way a telemetry library would see them, and runs every
// wrapped function inside a scope so tests can tell what ran inside it
const createIntegration = () => {
  const scope = new AsyncLocalStorage<string>();
  const events: string[] = [];

  const integration: Telemetry = {
    executeCall: ({ breakerId, execute }) =>
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
    executeHealthCheck: ({ type, signal, execute }) =>
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
    onBlockedRequest: ({ breakerId }) => {
      events.push(`blocked:${breakerId}`);
    },
    onStateChange: ({ state }) => {
      events.push(`state:${state}`);
    },
  };

  return { integration, events, activeScope: () => scope.getStore() };
};

describe('CircuitBreaker telemetry', () => {
  const createCircuit = async (
    check: (type: HealthCheckType) => Promise<void> = () => Promise.resolve(),
  ) => {
    const circuit = new CircuitBreaker({
      id: 'test',
      redis,
      breaker: new ConsecutiveBreaker({ threshold: 1 }),
      health: { backoff: new ConstantBackoff({ delayMs: 20 }), check },
      onError: vi.fn(),
    });
    await circuit.start();
    return circuit;
  };

  afterEach(() => {
    clearRegisteredTelemetry();
  });

  it('runs the protected call inside the integration and returns its result', async () => {
    const { integration, events, activeScope } = createIntegration();
    registerZenvarkTelemetry(integration);
    const circuit = await createCircuit();

    const result = await circuit.execute(async () => activeScope());

    expect(result).toBe('call:test');
    await vi.waitFor(() => expect(events).toEqual(['call:success']));

    await circuit.stop();
  });

  it('lets the integration see a failed call and still rethrows the original error', async () => {
    const { integration, events } = createIntegration();
    registerZenvarkTelemetry(integration);
    const circuit = await createCircuit(() =>
      Promise.reject(new Error('down')),
    );
    const error = new Error('boom');

    await expect(circuit.execute(() => Promise.reject(error))).rejects.toBe(
      error,
    );
    await vi.waitFor(() => expect(events[0]).toBe('call:failure'));

    await circuit.stop();
  });

  it('reports blocked calls, health checks and state transitions', async () => {
    const { integration, events, activeScope } = createIntegration();
    registerZenvarkTelemetry(integration);
    let healthy = false;
    const checkScopes: (string | undefined)[] = [];
    const circuit = await createCircuit(async () => {
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

  it('reports creation, measured calls and health checks, and leadership', async () => {
    const events: { hook: string; event: object }[] = [];
    const record =
      (hook: string) =>
      (event: object): void => {
        events.push({ hook, event });
      };
    registerZenvarkTelemetry({
      onBreakerInit: record('onBreakerInit'),
      onCallEnd: record('onCallEnd'),
      onHealthCheckEnd: record('onHealthCheckEnd'),
      onRoleChange: record('onRoleChange'),
    });
    const circuit = await createCircuit(() => delay(30));
    await vi.waitUntil(() => circuit.role === CircuitRole.LEADER);

    await circuit.execute(() => delay(30));
    await expect(
      circuit.execute(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await vi.waitUntil(() =>
      events.some(({ hook }) => hook === 'onHealthCheckEnd'),
    );
    await circuit.stop();

    expect(events[0]).toEqual({
      hook: 'onBreakerInit',
      event: { breakerId: 'test' },
    });
    const of = (hook: string) =>
      events.filter((e) => e.hook === hook).map((e) => e.event);
    expect(of('onRoleChange')).toEqual([
      {
        breakerId: 'test',
        role: CircuitRole.LEADER,
        state: CircuitState.CLOSED,
      },
      {
        breakerId: 'test',
        role: CircuitRole.FOLLOWER,
        state: expect.any(String),
      },
    ]);
    const [success, failure] = of('onCallEnd');
    expect(success).toEqual({
      breakerId: 'test',
      result: 'success',
      durationMs: expect.any(Number),
    });
    expect(
      (success as { durationMs: number }).durationMs,
    ).toBeGreaterThanOrEqual(25);
    expect(failure).toMatchObject({ breakerId: 'test', result: 'failure' });
    const [check] = of('onHealthCheckEnd');
    expect(check).toMatchObject({
      breakerId: 'test',
      type: HealthCheckType.RECOVERY,
      result: 'success',
    });
    expect((check as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(
      25,
    );
  });
});
