import { describe, expect, it, vi } from 'vitest';
import { redis } from '../test/setup-redis.ts';
import { AdaptiveSemaphore } from './adaptive-semaphore.ts';
import { ConstantBackoff } from './backoffs/constant-backoff.ts';
import { ConsecutiveBreaker } from './breakers/consecutive-breaker.ts';
import {
  type BreakerSemaphoreOptions,
  CircuitBreaker,
} from './circuit-breaker.ts';
import {
  CircuitRole,
  CircuitState,
  type HealthCheckType,
  LeaseOutcome,
} from './constants.ts';
import { AcquireTimeoutError } from './errors/acquire-timeout-error.ts';
import { CircuitOpenError } from './errors/circuit-open-error.ts';
import type { SemaphoreClassConfig } from './types.ts';
import { delay } from './utils/delay.ts';

describe('CircuitBreaker', () => {
  const createCircuit = async ({
    threshold = 3,
    check = () => Promise.resolve(),
    idleProbeIntervalMs,
    onRoleChange,
    onStateChange,
  }: {
    threshold?: number;
    check?: (type: HealthCheckType, signal: AbortSignal) => Promise<void>;
    idleProbeIntervalMs?: number;
    onRoleChange?: (role: CircuitRole) => void;
    onStateChange?: (state: CircuitState) => void;
  } = {}) => {
    const circuit = new CircuitBreaker({
      id: 'test',
      redis,
      breaker: new ConsecutiveBreaker({ threshold }),
      health: {
        backoff: new ConstantBackoff({ delayMs: 50 }),
        check,
        idleProbeIntervalMs,
      },
      onError: vi.fn(),
      onRoleChange,
      onStateChange,
    });

    await circuit.start();

    return circuit;
  };

  it('start is idempotent - calling twice should not throw', async () => {
    const circuit = await createCircuit();

    await expect(circuit.start()).resolves.not.toThrow();

    await circuit.stop();
  });

  it('stop is idempotent - calling before start should not throw', async () => {
    const circuit = new CircuitBreaker({
      id: 'test',
      redis,
      breaker: new ConsecutiveBreaker({ threshold: 1 }),
      health: {
        backoff: new ConstantBackoff({ delayMs: 10 }),
        check: () => Promise.resolve(),
      },
    });

    await expect(circuit.stop()).resolves.not.toThrow();
  });

  it('executes successfully when circuit is closed', async () => {
    const circuit = await createCircuit();

    await circuit.start();

    const result = await circuit.execute(() => Promise.resolve('ok'));

    expect(result).toBe('ok');

    await circuit.stop();
  });

  it('opens circuit across instances when threshold is breached', async () => {
    const [circuitA, circuitB] = await Promise.all([
      createCircuit({ threshold: 2, check: () => Promise.reject() }),
      createCircuit({ threshold: 2, check: () => Promise.reject() }),
    ]);

    await Promise.all([circuitA.start(), circuitB.start()]);

    await expect(
      circuitA.execute(() => Promise.reject('fail')),
    ).rejects.toThrow();
    await expect(
      circuitA.execute(() => Promise.reject('fail')),
    ).rejects.toThrow();

    await vi.waitUntil(
      () =>
        circuitA.state === CircuitState.OPEN &&
        circuitB.state === CircuitState.OPEN,
    );

    await expect(
      circuitA.execute(() => Promise.resolve('blocked')),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    await expect(
      circuitB.execute(() => Promise.resolve('blocked')),
    ).rejects.toBeInstanceOf(CircuitOpenError);

    await Promise.all([circuitA.stop(), circuitB.stop()]);
  });

  it('recovers circuit after health check succeeds', async () => {
    let healthcheckCalled = 0;

    const circuit = await createCircuit({
      threshold: 1,
      async check() {
        healthcheckCalled++;

        await delay(2);

        if (healthcheckCalled < 1) {
          throw new Error('still broken');
        }
      },
    });

    await circuit.start();

    await expect(circuit.execute(() => Promise.reject())).rejects.toThrow();

    await vi.waitUntil(() => circuit.state === CircuitState.OPEN, {
      interval: 1,
    });

    await expect(
      circuit.execute(() => Promise.resolve('blocked')),
    ).rejects.toBeInstanceOf(CircuitOpenError);

    await vi.waitUntil(() => circuit.state === CircuitState.CLOSED);

    const result = await circuit.execute(() => Promise.resolve('ok again'));
    expect(result).toBe('ok again');

    await circuit.stop();
  });

  it('runs idle healthcheck and opens circuit on failure, then closes on subsequent loop success', async () => {
    const check = vi
      .fn()
      .mockImplementationOnce(async () => {
        await delay(2);
        throw new Error('idle fail');
      })
      .mockImplementationOnce(async () => {
        await delay(2);
      });

    const circuit = await createCircuit({
      threshold: 1000,
      check,
      idleProbeIntervalMs: 30,
    });

    await circuit.start();

    // No calls -> idle triggers
    await vi.waitUntil(() => circuit.state === CircuitState.OPEN, {
      interval: 1,
    });

    await vi.waitUntil(() => circuit.state === CircuitState.CLOSED);

    await circuit.stop();
  });

  it('invokes onStateChange when circuit opens and then closes (recovery)', async () => {
    const onStateChange = vi.fn();

    const circuit = await createCircuit({
      threshold: 1,
      check: async () => await delay(2),
      onStateChange,
    });

    await circuit.start();

    await expect(
      circuit.execute(() => Promise.reject('fail')),
    ).rejects.toThrow();

    await vi.waitUntil(() => circuit.state === CircuitState.OPEN, {
      interval: 1,
    });

    await vi.waitUntil(() =>
      onStateChange.mock.calls.some((args) => args[0] === CircuitState.OPEN),
    );

    await vi.waitUntil(() => circuit.state === CircuitState.CLOSED);

    await vi.waitUntil(() =>
      onStateChange.mock.calls.some((args) => args[0] === CircuitState.CLOSED),
    );

    await circuit.stop();
  });

  it('reports role transitions via getter and invokes onRoleChange', async () => {
    const onRoleChange = vi.fn();

    const circuit = await createCircuit({ onRoleChange });

    await circuit.start();

    const waitForRole = async (role: CircuitRole) => {
      await vi.waitUntil(() => circuit.role === role, { interval: 1 });
      expect(onRoleChange).toHaveBeenLastCalledWith(role);
    };

    await waitForRole(CircuitRole.LEADER);

    await circuit.stop();

    await waitForRole(CircuitRole.FOLLOWER);
  });

  it('filters out historical failures after successful recovery', async () => {
    const circuit = await createCircuit({
      threshold: 2,
      check: async () => await delay(2),
    });

    await circuit.start();

    await expect(circuit.execute(() => Promise.reject())).rejects.toThrow();
    await expect(circuit.execute(() => Promise.reject())).rejects.toThrow();

    // Wait for circuit to open
    await vi.waitUntil(() => circuit.state === CircuitState.OPEN, {
      interval: 1,
    });

    // Wait for recovery health check to succeed and circuit to close
    await vi.waitUntil(() => circuit.state === CircuitState.CLOSED, {
      interval: 1,
    });

    // New failed request after recovery should not open the circuit
    // because historical failures are filtered out
    await expect(circuit.execute(() => Promise.reject())).rejects.toThrow();
    await delay(10);
    expect(circuit.state).toBe(CircuitState.CLOSED);

    // Second failed request should open the circuit again (threshold: 2)
    await expect(circuit.execute(() => Promise.reject())).rejects.toThrow();
    await vi.waitUntil(() => circuit.state === CircuitState.OPEN, {
      interval: 1,
    });

    await circuit.stop();
  });

  describe('semaphore integration', () => {
    const SEMAPHORE_LIMIT_KEY = 'zenvark:testSemaphore:limit';
    const SEMAPHORE_GATE_KEY = 'semaphore:zenvark:testSemaphore';

    const createBreakerMetrics = () => ({
      recordCall: vi.fn(),
      recordBlockedRequest: vi.fn(),
      recordHealthCheck: vi.fn(),
    });

    const createGatedCircuit = async ({
      initialLimit = 10,
      classes,
      lease = { timeoutMs: 1_000 },
      threshold = 1_000,
      check = () => Promise.resolve(),
      metrics,
      onError,
    }: {
      initialLimit?: number;
      classes?: Record<string, SemaphoreClassConfig>;
      lease?: Omit<BreakerSemaphoreOptions, 'instance'>;
      threshold?: number;
      check?: () => Promise<void>;
      metrics?: ReturnType<typeof createBreakerMetrics>;
      onError?: (err: Error) => void;
    } = {}) => {
      const semaphore = new AdaptiveSemaphore({
        id: 'testSemaphore',
        redis,
        initialLimit,
        maxLimit: 100,
        classes,
        aimd: { windowMs: 60_000, cooldownMs: 60_000 },
        onError: () => {},
      });

      const circuit = new CircuitBreaker({
        id: 'test',
        redis,
        breaker: new ConsecutiveBreaker({ threshold }),
        health: {
          backoff: new ConstantBackoff({ delayMs: 50 }),
          check,
        },
        semaphore: { instance: semaphore, ...lease },
        metrics,
        onError: onError ?? vi.fn(),
      });

      await circuit.start();

      return { circuit, semaphore };
    };

    it('gates calls through the semaphore and releases with SUCCESS', async () => {
      const { circuit, semaphore } = await createGatedCircuit();

      const result = await circuit.execute(() => {
        expect(semaphore.getState().inflight).toBe(1);
        return Promise.resolve('ok');
      });

      expect(result).toBe('ok');
      expect(semaphore.getState().inflight).toBe(0);
      expect(await redis.zcard(SEMAPHORE_GATE_KEY)).toBe(0);

      await circuit.stop();
    });

    it('uses the semaphore acquire timeout when lease timeoutMs is omitted', async () => {
      const { circuit, semaphore } = await createGatedCircuit({ lease: {} });

      const result = await circuit.execute(() => Promise.resolve('ok'));

      expect(result).toBe('ok');
      expect(semaphore.getState().inflight).toBe(0);

      await circuit.stop();
    });

    it('releases THROTTLED for classified errors while breaker accounting is unchanged', async () => {
      const metrics = createBreakerMetrics();
      const { circuit } = await createGatedCircuit({
        initialLimit: 10,
        lease: {
          timeoutMs: 1_000,
          outcomeOnError: (err) =>
            err instanceof Error && err.message === '429'
              ? LeaseOutcome.THROTTLED
              : LeaseOutcome.FAILURE,
        },
        metrics,
      });

      await expect(
        circuit.execute(() => Promise.reject(new Error('429'))),
      ).rejects.toThrow('429');

      // the semaphore halved its limit, but the breaker recorded a plain failure
      expect(await redis.get(SEMAPHORE_LIMIT_KEY)).toBe('5');
      expect(metrics.recordCall).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'failure' }),
      );

      await circuit.stop();
    });

    it('does not record a breaker call when the lease acquisition times out', async () => {
      const metrics = createBreakerMetrics();
      const { circuit, semaphore } = await createGatedCircuit({
        initialLimit: 1,
        metrics,
      });
      const blocker = await semaphore.acquire({ timeoutMs: 1_000 });
      const fn = vi.fn(() => Promise.resolve('never'));

      await expect(
        circuit.execute(fn, { lease: { timeoutMs: 250 } }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);

      expect(fn).not.toHaveBeenCalled();
      expect(metrics.recordCall).not.toHaveBeenCalled();
      expect(metrics.recordBlockedRequest).not.toHaveBeenCalled();

      await blocker.release(LeaseOutcome.FAILURE);
      await circuit.stop();
    });

    it('blocks open-circuit calls before touching the semaphore', async () => {
      const metrics = createBreakerMetrics();
      const { circuit, semaphore } = await createGatedCircuit({
        threshold: 1,
        check: () => Promise.reject(new Error('still down')),
        metrics,
      });

      await expect(
        circuit.execute(() => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');
      await vi.waitUntil(() => circuit.state === CircuitState.OPEN, {
        interval: 1,
      });

      const acquireSpy = vi.spyOn(semaphore, 'acquire');
      await expect(
        circuit.execute(() => Promise.resolve('blocked')),
      ).rejects.toBeInstanceOf(CircuitOpenError);

      expect(acquireSpy).not.toHaveBeenCalled();
      expect(metrics.recordBlockedRequest).toHaveBeenCalledWith({
        breakerId: 'test',
      });

      await circuit.stop();
    });

    it('aborts a waiting lease acquisition when the circuit opens', async () => {
      const metrics = createBreakerMetrics();
      const { circuit, semaphore } = await createGatedCircuit({
        initialLimit: 1,
        threshold: 1,
        check: () => Promise.reject(new Error('still down')),
        metrics,
      });
      // a second breaker on the same circuit id, without a semaphore, to
      // trip the circuit while the first one is stuck waiting for a lease
      const tripper = new CircuitBreaker({
        id: 'test',
        redis,
        breaker: new ConsecutiveBreaker({ threshold: 1 }),
        health: {
          backoff: new ConstantBackoff({ delayMs: 50 }),
          check: () => Promise.reject(new Error('still down')),
        },
        onError: vi.fn(),
      });
      await tripper.start();

      const blocker = await semaphore.acquire({ timeoutMs: 1_000 });
      const pending = circuit
        .execute(() => Promise.resolve('never'), {
          lease: { timeoutMs: 10_000 },
        })
        .catch((err: unknown) => err);
      await delay(100);

      await expect(
        tripper.execute(() => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');

      expect(await pending).toBeInstanceOf(CircuitOpenError);
      expect(metrics.recordBlockedRequest).toHaveBeenCalledWith({
        breakerId: 'test',
      });

      await blocker.release(LeaseOutcome.FAILURE);
      await Promise.all([circuit.stop(), tripper.stop()]);
    });

    it('applies per-call lease overrides on top of the configured defaults', async () => {
      const { circuit, semaphore } = await createGatedCircuit({
        classes: {
          interactive: { reservedShare: 0.5 },
          background: {},
        },
        lease: { timeoutMs: 1_000, class: 'background' },
      });

      const acquireSpy = vi.spyOn(semaphore, 'acquire');
      await circuit.execute(() => Promise.resolve('ok'), {
        lease: { class: 'interactive' },
      });

      expect(acquireSpy).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 1_000, class: 'interactive' }),
      );

      await circuit.stop();
    });

    it('treats a throwing classifier as FAILURE and reports it', async () => {
      const onError = vi.fn();
      const { circuit } = await createGatedCircuit({
        initialLimit: 10,
        lease: {
          timeoutMs: 1_000,
          outcomeOnError: () => {
            throw new Error('classifier bug');
          },
        },
        onError,
      });

      await expect(
        circuit.execute(() => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');

      expect(await redis.get(SEMAPHORE_LIMIT_KEY)).toBe('10');
      expect(onError).toHaveBeenCalled();

      await circuit.stop();
    });

    it('rejects lease options when no semaphore is configured', async () => {
      const circuit = await createCircuit();

      await expect(
        circuit.execute(() => Promise.resolve('ok'), {
          lease: { timeoutMs: 100 },
        }),
      ).rejects.toThrow('require a semaphore to be configured');

      await circuit.stop();
    });
  });
});
