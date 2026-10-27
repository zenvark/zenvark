import { afterEach, describe, expect, it } from 'vitest';
import { redis } from '../test/setup-redis.ts';
import { AdaptiveSemaphore } from './adaptive-semaphore.ts';
import {
  AcquireResult,
  LeaseOutcome,
  LimitChangeDirection,
} from './constants.ts';
import { AcquireTimeoutError } from './errors/acquire-timeout-error.ts';
import {
  clearRegisteredTelemetry,
  registerZenvarkTelemetry,
} from './telemetry.ts';
import { delay } from './utils/delay.ts';

describe('AdaptiveSemaphore telemetry', () => {
  const events: { hook: string; event: object }[] = [];
  const of = (hook: string) =>
    events.filter((e) => e.hook === hook).map((e) => e.event);

  const registerRecorder = () => {
    const record =
      (hook: string) =>
      (event: object): void => {
        events.push({ hook, event });
      };
    registerZenvarkTelemetry({
      onSemaphoreInit: record('onSemaphoreInit'),
      onAcquire: record('onAcquire'),
      onRelease: record('onRelease'),
      onLimitChange: record('onLimitChange'),
      onThrottle: record('onThrottle'),
    });
  };

  const createSemaphore = () =>
    new AdaptiveSemaphore({
      id: 'testSemaphore',
      redis,
      initialLimit: 2,
      maxLimit: 100,
      classes: { bulk: {} },
      aimd: { windowMs: 60_000, cooldownMs: 60_000 },
      onError: () => {},
    });

  afterEach(() => {
    clearRegisteredTelemetry();
    events.length = 0;
  });

  it('reports creation, acquires with their wait, and releases with their hold time', async () => {
    registerRecorder();
    const semaphore = createSemaphore();

    const lease = await semaphore.acquire({ class: 'bulk' });
    await delay(30);
    await lease.release(LeaseOutcome.SUCCESS);

    expect(events[0]).toEqual({
      hook: 'onSemaphoreInit',
      event: { semaphoreId: 'testSemaphore' },
    });
    expect(of('onAcquire')).toEqual([
      {
        semaphoreId: 'testSemaphore',
        class: 'bulk',
        result: AcquireResult.ACQUIRED,
        waitMs: expect.any(Number),
      },
    ]);
    const [release] = of('onRelease') as { heldMs: number }[];
    expect(release).toMatchObject({
      semaphoreId: 'testSemaphore',
      class: 'bulk',
      outcome: LeaseOutcome.SUCCESS,
    });
    expect(release?.heldMs).toBeGreaterThanOrEqual(25);
    expect(of('onLimitChange')).toEqual([
      {
        semaphoreId: 'testSemaphore',
        limit: 2,
        direction: LimitChangeDirection.INIT,
      },
    ]);
  });

  it('reports a timed out acquire with the time spent waiting', async () => {
    registerRecorder();
    const semaphore = createSemaphore();
    const held = [await semaphore.acquire({}), await semaphore.acquire({})];

    await expect(semaphore.acquire({ timeoutMs: 100 })).rejects.toBeInstanceOf(
      AcquireTimeoutError,
    );

    const timedOut = of('onAcquire').at(-1) as {
      result: string;
      waitMs: number;
    };
    expect(timedOut.result).toBe(AcquireResult.TIMEOUT);
    expect(timedOut.waitMs).toBeGreaterThanOrEqual(90);
    for (const lease of held) {
      await lease.release(LeaseOutcome.FAILURE);
    }
  });

  it('reports a throttle and the resulting limit decrease', async () => {
    registerRecorder();
    const semaphore = createSemaphore();

    const lease = await semaphore.acquire({});
    await lease.release(LeaseOutcome.THROTTLED);

    expect(of('onThrottle')).toEqual([{ semaphoreId: 'testSemaphore' }]);
    expect(of('onLimitChange').at(-1)).toEqual({
      semaphoreId: 'testSemaphore',
      limit: 1,
      direction: LimitChangeDirection.DECREASE,
    });
  });

  it('sends nothing to global integrations when disabled for the semaphore', async () => {
    registerRecorder();
    const semaphore = new AdaptiveSemaphore({
      id: 'testSemaphore',
      redis,
      initialLimit: 2,
      onError: () => {},
      telemetry: { isEnabled: false },
    });

    const lease = await semaphore.acquire({});
    await lease.release(LeaseOutcome.SUCCESS);

    expect(events).toEqual([]);
  });
});
