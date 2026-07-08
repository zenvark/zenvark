import { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { redis } from '../test/setup-redis.ts';
import {
  AdaptiveSemaphore,
  type AdaptiveSemaphoreOptions,
} from './adaptive-semaphore.ts';
import { LeaseOutcome } from './constants.ts';
import { AcquireTimeoutError } from './errors/acquire-timeout-error.ts';
import { SemaphoreDisposedError } from './errors/semaphore-disposed-error.ts';
import { SemaphoreUnavailableError } from './errors/semaphore-unavailable-error.ts';
import { delay } from './utils/delay.ts';

const SEMAPHORE_ID = 'testSemaphore';
const GATE_KEY = `semaphore:zenvark:${SEMAPHORE_ID}`;
const LIMIT_KEY = `zenvark:${SEMAPHORE_ID}:limit`;
const DEMAND_KEY = `zenvark:${SEMAPHORE_ID}:demand`;

const createSemaphore = (overrides: Partial<AdaptiveSemaphoreOptions> = {}) =>
  new AdaptiveSemaphore({
    id: SEMAPHORE_ID,
    redis,
    initialLimit: 1,
    maxLimit: 100,
    aimd: { windowMs: 60_000, cooldownMs: 60_000 },
    onError: () => {},
    ...overrides,
  });

const createBrokenRedis = () =>
  new Redis({
    host: 'localhost',
    port: 6399,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });

describe('AdaptiveSemaphore', () => {
  describe('acquire and release', () => {
    it('acquires a lease, tracks it and returns the slot on release', async () => {
      const semaphore = createSemaphore({ initialLimit: 5 });

      const lease = await semaphore.acquire({ timeoutMs: 1_000 });

      expect(semaphore.getState()).toMatchObject({ limit: 5, inflight: 1 });
      expect(await redis.zcard(GATE_KEY)).toBe(1);
      expect(await redis.get(LIMIT_KEY)).toBe('5');

      await lease.release(LeaseOutcome.SUCCESS);

      expect(semaphore.getState().inflight).toBe(0);
      expect(await redis.zcard(GATE_KEY)).toBe(0);
    });

    it('release is idempotent', async () => {
      const semaphore = createSemaphore({ initialLimit: 5 });

      const lease = await semaphore.acquire({ timeoutMs: 1_000 });
      await lease.release(LeaseOutcome.SUCCESS);
      await lease.release(LeaseOutcome.SUCCESS);

      expect(semaphore.getState().inflight).toBe(0);
    });

    it('adopts an already-seeded limit instead of overwriting it', async () => {
      await redis.set(LIMIT_KEY, '3');
      const semaphore = createSemaphore({ initialLimit: 10 });

      const lease = await semaphore.acquire({ timeoutMs: 1_000 });

      expect(semaphore.getState().limit).toBe(3);
      await lease.release(LeaseOutcome.SUCCESS);
    });

    it('enforces the limit fleet-wide across instances and marks demand on denial', async () => {
      const semaphoreA = createSemaphore();
      const semaphoreB = createSemaphore();

      const lease = await semaphoreA.acquire({ timeoutMs: 1_000 });

      await expect(
        semaphoreB.acquire({ timeoutMs: 250 }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);
      expect(await redis.exists(DEMAND_KEY)).toBe(1);

      await lease.release(LeaseOutcome.SUCCESS);
      const leaseB = await semaphoreB.acquire({ timeoutMs: 1_000 });
      await leaseB.release(LeaseOutcome.SUCCESS);
    });

    it('reclaims slots of leases that lapsed by TTL', async () => {
      // A crashed holder: present in the gate but with a heartbeat far in the past
      await redis.zadd(GATE_KEY, Date.now() - 60_000, 'dead-process');
      const semaphore = createSemaphore();

      const lease = await semaphore.acquire({ timeoutMs: 1_000 });

      await lease.release(LeaseOutcome.SUCCESS);
    });

    it('rejects the wait when the caller aborts', async () => {
      const semaphore = createSemaphore();
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });
      const controller = new AbortController();

      const pending = semaphore.acquire({
        timeoutMs: 5_000,
        signal: controller.signal,
      });
      controller.abort(new Error('cancelled by caller'));

      await expect(pending).rejects.toThrow('cancelled by caller');
      await lease.release(LeaseOutcome.SUCCESS);
    });

    it('grants a waiting acquire when a slot frees up mid-wait', async () => {
      const semaphore = createSemaphore();
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });

      const pending = semaphore.acquire({ timeoutMs: 5_000 });
      await delay(150);
      await lease.release(LeaseOutcome.FAILURE);

      const waiterLease = await pending;
      expect(semaphore.getState().inflight).toBe(1);
      await waiterLease.release(LeaseOutcome.SUCCESS);
    });

    it('grants a waiting acquire when the fleet-wide limit is raised mid-wait', async () => {
      const semaphore = createSemaphore();
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });

      const pending = semaphore.acquire({ timeoutMs: 5_000 });
      await delay(100);
      // another instance wins an increase; this waiter re-reads the limit on
      // its next attempt and gets the new slot without releasing anything
      await redis.set(LIMIT_KEY, '2');

      const secondLease = await pending;
      expect(semaphore.getState().inflight).toBe(2);

      await lease.release(LeaseOutcome.FAILURE);
      await secondLease.release(LeaseOutcome.FAILURE);
    });

    it('performs exactly one attempt when timeoutMs is 0', async () => {
      const semaphore = createSemaphore();

      // a free slot is still granted immediately
      const lease = await semaphore.acquire({ timeoutMs: 0 });

      // a full gate is rejected without waiting out a retry interval
      const start = performance.now();
      await expect(semaphore.acquire({ timeoutMs: 0 })).rejects.toBeInstanceOf(
        AcquireTimeoutError,
      );
      expect(performance.now() - start).toBeLessThan(100);

      await lease.release(LeaseOutcome.SUCCESS);
    });

    it('auto-renews held leases so they outlive the lease TTL', async () => {
      const holder = createSemaphore({ leaseTtlMs: 500 });
      const contender = createSemaphore({ leaseTtlMs: 500 });

      const lease = await holder.acquire({ timeoutMs: 1_000 });
      await delay(700);

      // the slot was not reclaimed: the holder's heartbeat kept refreshing it
      await expect(
        contender.acquire({ timeoutMs: 250 }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);

      await lease.release(LeaseOutcome.FAILURE);
      const nextLease = await contender.acquire({ timeoutMs: 1_000 });
      await nextLease.release(LeaseOutcome.FAILURE);
    });

    it('reports a lost lease through onError when its gate entry disappears', async () => {
      const onError = vi.fn();
      const semaphore = createSemaphore({ leaseTtlMs: 500, onError });
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });

      // simulate an external wipe of the gate; the next heartbeat notices
      await redis.del(GATE_KEY);
      await delay(700);

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('was lost'),
        }),
      );

      // releasing an already-lost lease is still safe
      await lease.release(LeaseOutcome.FAILURE);
      expect(semaphore.getState().inflight).toBe(0);
    });

    it('serves the limit from the local cache within its TTL', async () => {
      const semaphore = createSemaphore({ initialLimit: 5 });
      const leaseA = await semaphore.acquire({ timeoutMs: 1_000 });

      const getSpy = vi.spyOn(redis, 'get');
      const leaseB = await semaphore.acquire({ timeoutMs: 1_000 });

      expect(getSpy).not.toHaveBeenCalledWith(LIMIT_KEY);
      await leaseA.release(LeaseOutcome.FAILURE);
      await leaseB.release(LeaseOutcome.FAILURE);
    });
  });

  describe('AIMD adaptation', () => {
    it('multiplicatively decreases the limit on THROTTLED, once per cooldown', async () => {
      const semaphore = createSemaphore({ initialLimit: 10 });
      const leaseA = await semaphore.acquire({ timeoutMs: 1_000 });
      const leaseB = await semaphore.acquire({ timeoutMs: 1_000 });

      await leaseA.release(LeaseOutcome.THROTTLED);
      await leaseB.release(LeaseOutcome.THROTTLED);

      expect(await redis.get(LIMIT_KEY)).toBe('5');
      expect(semaphore.getState().limit).toBe(5);
    });

    it('never decreases below minLimit', async () => {
      const semaphore = createSemaphore({ initialLimit: 3, minLimit: 2 });
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });

      await lease.release(LeaseOutcome.THROTTLED);

      expect(await redis.get(LIMIT_KEY)).toBe('2');
    });

    it('additively increases on demand at the cap, once per window', async () => {
      const onLimitChange = vi.fn();
      const semaphore = createSemaphore({ onLimitChange });
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });
      await expect(
        semaphore.acquire({ timeoutMs: 250 }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);

      await lease.release(LeaseOutcome.SUCCESS);
      expect(await redis.get(LIMIT_KEY)).toBe('2');
      expect(onLimitChange).toHaveBeenCalledWith(2);

      // The increase claim is still held for this window, so no second step
      const leaseB = await semaphore.acquire({ timeoutMs: 1_000 });
      await leaseB.release(LeaseOutcome.SUCCESS);
      expect(await redis.get(LIMIT_KEY)).toBe('2');
    });

    it('does not increase without demand at the cap', async () => {
      const semaphore = createSemaphore({ initialLimit: 2 });
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });

      await lease.release(LeaseOutcome.SUCCESS);

      expect(await redis.get(LIMIT_KEY)).toBe('2');
    });

    it('does not increase while a throttle marker is fresh', async () => {
      const semaphore = createSemaphore({ initialLimit: 2 });
      const leaseA = await semaphore.acquire({ timeoutMs: 1_000 });
      const leaseB = await semaphore.acquire({ timeoutMs: 1_000 });
      await expect(
        semaphore.acquire({ timeoutMs: 250 }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);

      await leaseA.release(LeaseOutcome.THROTTLED);
      await leaseB.release(LeaseOutcome.SUCCESS);

      expect(await redis.get(LIMIT_KEY)).toBe('1');
    });

    it('never increases above maxLimit', async () => {
      const semaphore = createSemaphore({ maxLimit: 1 });
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });
      await expect(
        semaphore.acquire({ timeoutMs: 250 }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);

      await lease.release(LeaseOutcome.SUCCESS);

      expect(await redis.get(LIMIT_KEY)).toBe('1');
    });

    it('FAILURE releases are adaptation-neutral', async () => {
      const semaphore = createSemaphore();
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });
      await expect(
        semaphore.acquire({ timeoutMs: 250 }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);

      await lease.release(LeaseOutcome.FAILURE);

      expect(await redis.get(LIMIT_KEY)).toBe('1');
    });

    it('halves again once the cooldown expires', async () => {
      const semaphore = createSemaphore({
        initialLimit: 8,
        aimd: { windowMs: 200, cooldownMs: 200 },
      });
      const leaseA = await semaphore.acquire({ timeoutMs: 1_000 });
      const leaseB = await semaphore.acquire({ timeoutMs: 1_000 });

      await leaseA.release(LeaseOutcome.THROTTLED);
      expect(await redis.get(LIMIT_KEY)).toBe('4');

      await delay(250);
      await leaseB.release(LeaseOutcome.THROTTLED);
      expect(await redis.get(LIMIT_KEY)).toBe('2');
    });

    it('takes another increase step in the next window while demand persists', async () => {
      const semaphore = createSemaphore({
        aimd: { windowMs: 200, cooldownMs: 200 },
      });
      const leaseA = await semaphore.acquire({ timeoutMs: 1_000 });
      await expect(
        semaphore.acquire({ timeoutMs: 250 }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);
      await leaseA.release(LeaseOutcome.SUCCESS);
      expect(await redis.get(LIMIT_KEY)).toBe('2');

      const leaseB = await semaphore.acquire({ timeoutMs: 1_000 });
      const leaseC = await semaphore.acquire({ timeoutMs: 1_000 });
      // this denial re-marks demand and outlasts the previous increase claim
      await expect(
        semaphore.acquire({ timeoutMs: 250 }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);
      await leaseB.release(LeaseOutcome.SUCCESS);
      expect(await redis.get(LIMIT_KEY)).toBe('3');

      await leaseC.release(LeaseOutcome.FAILURE);
    });

    it('applies a single halving when two instances throttle concurrently', async () => {
      const semaphoreA = createSemaphore({ initialLimit: 8 });
      const semaphoreB = createSemaphore({ initialLimit: 8 });
      const leaseA = await semaphoreA.acquire({ timeoutMs: 1_000 });
      const leaseB = await semaphoreB.acquire({ timeoutMs: 1_000 });

      await Promise.all([
        leaseA.release(LeaseOutcome.THROTTLED),
        leaseB.release(LeaseOutcome.THROTTLED),
      ]);

      expect(await redis.get(LIMIT_KEY)).toBe('4');
    });
  });

  describe('priority classes', () => {
    it('caps unreserved classes below the reserved slice', async () => {
      const semaphore = createSemaphore({
        initialLimit: 4,
        classes: {
          interactive: { reservedShare: 0.5 },
          background: {},
        },
      });

      // background is capped at 4 - ceil(0.5 * 4) = 2
      const backgroundA = await semaphore.acquire({
        class: 'background',
        timeoutMs: 1_000,
      });
      const backgroundB = await semaphore.acquire({
        class: 'background',
        timeoutMs: 1_000,
      });
      await expect(
        semaphore.acquire({ class: 'background', timeoutMs: 250 }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);

      // the reserved slice is still available to interactive
      const interactive = await semaphore.acquire({
        class: 'interactive',
        timeoutMs: 1_000,
      });

      expect(semaphore.getState().inflightByClass).toEqual({
        background: 2,
        interactive: 1,
      });

      await backgroundA.release(LeaseOutcome.SUCCESS);
      await backgroundB.release(LeaseOutcome.SUCCESS);
      await interactive.release(LeaseOutcome.SUCCESS);
    });

    it('leaves a class at least one slot when reservations consume the whole limit', async () => {
      const semaphore = createSemaphore({
        classes: {
          interactive: { reservedShare: 0.5 },
          background: {},
        },
      });

      // limit 1: interactive reserves ceil(0.5 * 1) = 1, but background is floored at 1
      const lease = await semaphore.acquire({
        class: 'background',
        timeoutMs: 1_000,
      });

      await lease.release(LeaseOutcome.SUCCESS);
    });

    it('rejects acquires for unknown classes', async () => {
      const semaphore = createSemaphore({
        classes: { interactive: { reservedShare: 0.25 } },
      });

      await expect(
        semaphore.acquire({ class: 'bulk', timeoutMs: 100 }),
      ).rejects.toThrow('Unknown semaphore class "bulk"');
    });
  });

  describe('withLease', () => {
    it('releases with SUCCESS when the callback resolves', async () => {
      const semaphore = createSemaphore({ initialLimit: 2 });

      const result = await semaphore.withLease({ timeoutMs: 1_000 }, () =>
        Promise.resolve('done'),
      );

      expect(result).toBe('done');
      expect(semaphore.getState().inflight).toBe(0);
      expect(await redis.get(LIMIT_KEY)).toBe('2');
    });

    it('releases with THROTTLED when the classifier matches and rethrows', async () => {
      const semaphore = createSemaphore({ initialLimit: 10 });

      await expect(
        semaphore.withLease(
          {
            timeoutMs: 1_000,
            classifyError: (err) =>
              err instanceof Error && err.message === '429',
          },
          () => Promise.reject(new Error('429')),
        ),
      ).rejects.toThrow('429');

      expect(await redis.get(LIMIT_KEY)).toBe('5');
    });

    it('releases with FAILURE for unclassified errors and rethrows', async () => {
      const semaphore = createSemaphore({ initialLimit: 10 });

      await expect(
        semaphore.withLease({ timeoutMs: 1_000 }, () =>
          Promise.reject(new Error('boom')),
        ),
      ).rejects.toThrow('boom');

      expect(await redis.get(LIMIT_KEY)).toBe('10');
      expect(semaphore.getState().inflight).toBe(0);
    });

    it('treats a throwing classifier as FAILURE', async () => {
      const onError = vi.fn();
      const semaphore = createSemaphore({ initialLimit: 10, onError });

      await expect(
        semaphore.withLease(
          {
            timeoutMs: 1_000,
            classifyError: () => {
              throw new Error('classifier bug');
            },
          },
          () => Promise.reject(new Error('boom')),
        ),
      ).rejects.toThrow('boom');

      expect(await redis.get(LIMIT_KEY)).toBe('10');
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('aborts pending acquires and rejects future ones', async () => {
      const semaphore = createSemaphore();
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });

      const pending = semaphore.acquire({ timeoutMs: 5_000 });
      await delay(50);
      semaphore.dispose();

      await expect(pending).rejects.toBeInstanceOf(SemaphoreDisposedError);
      await expect(
        semaphore.acquire({ timeoutMs: 100 }),
      ).rejects.toBeInstanceOf(SemaphoreDisposedError);

      // held leases are unaffected and can still be released
      await lease.release(LeaseOutcome.SUCCESS);
      semaphore.dispose();
    });
  });

  describe('Redis unavailability', () => {
    it('throws SemaphoreUnavailableError by default', async () => {
      const brokenRedis = createBrokenRedis();
      const semaphore = createSemaphore({ redis: brokenRedis });

      await expect(
        semaphore.acquire({ timeoutMs: 1_000 }),
      ).rejects.toBeInstanceOf(SemaphoreUnavailableError);

      brokenRedis.disconnect();
    });

    it('falls back to a local limit when configured', async () => {
      const brokenRedis = createBrokenRedis();
      const onError = vi.fn();
      const semaphore = createSemaphore({
        redis: brokenRedis,
        onUnavailable: { localLimit: 1 },
        onError,
      });

      const lease = await semaphore.acquire({ timeoutMs: 1_000 });
      expect(semaphore.getState().inflight).toBe(1);
      expect(onError).toHaveBeenCalled();

      await expect(
        semaphore.acquire({ timeoutMs: 250 }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);

      await lease.release(LeaseOutcome.SUCCESS);
      expect(semaphore.getState().inflight).toBe(0);

      const nextLease = await semaphore.acquire({ timeoutMs: 1_000 });
      await nextLease.release(LeaseOutcome.SUCCESS);

      brokenRedis.disconnect();
    });

    it('retries seeding the limit after a transient failure', async () => {
      const onError = vi.fn();
      const semaphore = createSemaphore({
        onUnavailable: { localLimit: 1 },
        onError,
      });
      // the very first Redis command in the acquire path is the seeding SET
      vi.spyOn(redis, 'set').mockRejectedValueOnce(
        new Error('transient outage'),
      );

      const fallbackLease = await semaphore.acquire({ timeoutMs: 1_000 });
      expect(onError).toHaveBeenCalled();
      expect(await redis.exists(LIMIT_KEY)).toBe(0);
      await fallbackLease.release(LeaseOutcome.SUCCESS);

      // the next acquire re-attempts the seed and returns to the distributed gate
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });
      expect(await redis.get(LIMIT_KEY)).toBe('1');
      expect(await redis.zcard(GATE_KEY)).toBe(1);
      await lease.release(LeaseOutcome.SUCCESS);
    });
  });

  describe('metrics', () => {
    it('reports acquire, release, throttle and limit changes', async () => {
      const metrics = {
        initialize: vi.fn(),
        recordAcquire: vi.fn(),
        recordRelease: vi.fn(),
        recordLimitChange: vi.fn(),
        recordThrottle: vi.fn(),
      };
      const semaphore = createSemaphore({ initialLimit: 10, metrics });

      expect(metrics.initialize).toHaveBeenCalledWith(SEMAPHORE_ID);

      const lease = await semaphore.acquire({ timeoutMs: 1_000 });
      expect(metrics.recordAcquire).toHaveBeenCalledWith(
        expect.objectContaining({
          id: SEMAPHORE_ID,
          result: 'acquired',
          waitMs: expect.any(Number),
        }),
      );
      expect(metrics.recordLimitChange).toHaveBeenCalledWith({
        id: SEMAPHORE_ID,
        limit: 10,
        direction: 'init',
      });

      await lease.release(LeaseOutcome.THROTTLED);
      expect(metrics.recordRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          id: SEMAPHORE_ID,
          outcome: 'throttled',
          heldMs: expect.any(Number),
        }),
      );
      expect(metrics.recordThrottle).toHaveBeenCalledWith({
        id: SEMAPHORE_ID,
      });
      expect(metrics.recordLimitChange).toHaveBeenCalledWith({
        id: SEMAPHORE_ID,
        limit: 5,
        direction: 'decrease',
      });
    });

    it('reports timed out acquires', async () => {
      const metrics = {
        recordAcquire: vi.fn(),
        recordRelease: vi.fn(),
      };
      const semaphore = createSemaphore({ metrics });
      const lease = await semaphore.acquire({ timeoutMs: 1_000 });

      await expect(
        semaphore.acquire({ timeoutMs: 250 }),
      ).rejects.toBeInstanceOf(AcquireTimeoutError);

      expect(metrics.recordAcquire).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'timeout' }),
      );
      await lease.release(LeaseOutcome.SUCCESS);
    });
  });

  describe('contention', () => {
    it('never exceeds the limit under concurrent load', async () => {
      const semaphore = createSemaphore({ initialLimit: 3, maxLimit: 3 });
      let inflight = 0;
      let maxInflight = 0;

      await Promise.all(
        Array.from({ length: 10 }, async () => {
          const lease = await semaphore.acquire({ timeoutMs: 10_000 });
          inflight += 1;
          maxInflight = Math.max(maxInflight, inflight);
          await delay(50);
          inflight -= 1;
          await lease.release(LeaseOutcome.FAILURE);
        }),
      );

      expect(maxInflight).toBeLessThanOrEqual(3);
      expect(maxInflight).toBeGreaterThanOrEqual(2);
      expect(semaphore.getState().inflight).toBe(0);
      expect(await redis.zcard(GATE_KEY)).toBe(0);
    });
  });

  describe('end-to-end convergence', () => {
    it('converges the limit toward a hidden provider capacity', async () => {
      const HIDDEN_CAPACITY = 3;
      const directions: string[] = [];
      const semaphore = createSemaphore({
        initialLimit: 6,
        maxLimit: 20,
        aimd: { windowMs: 150, cooldownMs: 150 },
        metrics: {
          recordAcquire: () => {},
          recordRelease: () => {},
          recordLimitChange: ({ direction }) => {
            directions.push(direction);
          },
        },
      });

      // a fake provider that starts rejecting when its capacity is exceeded
      let providerInflight = 0;
      let providerRejected = 0;
      const callProvider = async () => {
        providerInflight += 1;
        const overloaded = providerInflight > HIDDEN_CAPACITY;
        await delay(20);
        providerInflight -= 1;
        if (overloaded) {
          providerRejected += 1;
          throw new Error('429');
        }
      };

      await Promise.all(
        Array.from({ length: 5 }, async () => {
          for (let i = 0; i < 8; i += 1) {
            await semaphore
              .withLease(
                {
                  timeoutMs: 2_000,
                  classifyError: (err) =>
                    err instanceof Error && err.message === '429',
                },
                callProvider,
              )
              .catch(() => {});
          }
        }),
      );

      // starting above capacity must produce throttles and drive the limit down
      expect(providerRejected).toBeGreaterThan(0);
      expect(directions).toContain('decrease');
      const finalLimit = Number(await redis.get(LIMIT_KEY));
      expect(finalLimit).toBeLessThan(6);
      expect(finalLimit).toBeGreaterThanOrEqual(1);
    });
  });

  describe('validation', () => {
    it.each([
      [{ initialLimit: 0 }, 'initialLimit must be an integer >= 1'],
      [{ minLimit: 0 }, 'minLimit must be an integer >= 1'],
      [{ maxLimit: 0.5 }, 'maxLimit must be an integer >= 1'],
      [
        { initialLimit: 10, maxLimit: 5 },
        'initialLimit must be within [minLimit, maxLimit]',
      ],
      [
        { aimd: { decreaseFactor: 1 } },
        'aimd.decreaseFactor must be within (0, 1)',
      ],
      [
        { aimd: { increaseStep: 0 } },
        'aimd.increaseStep must be an integer >= 1',
      ],
      [
        { aimd: { windowMs: 0 } },
        'aimd.windowMs and aimd.cooldownMs must be positive',
      ],
      [
        { classes: { a: { reservedShare: 1 } } },
        'classes.a.reservedShare must be within (0, 1)',
      ],
      [
        {
          classes: {
            a: { reservedShare: 0.6 },
            b: { reservedShare: 0.6 },
          },
        },
        'the sum of reservedShare across classes must be < 1',
      ],
      [
        { onUnavailable: { localLimit: 0 } },
        'onUnavailable.localLimit must be an integer >= 1',
      ],
    ] satisfies [
      Partial<AdaptiveSemaphoreOptions>,
      string,
    ][])('rejects invalid options %j', (overrides, message) => {
      expect(() => createSemaphore(overrides)).toThrow(message);
    });

    it('rejects a negative acquire timeout', async () => {
      const semaphore = createSemaphore();

      await expect(semaphore.acquire({ timeoutMs: -1 })).rejects.toThrow(
        'timeoutMs must be a non-negative number',
      );
    });
  });
});
