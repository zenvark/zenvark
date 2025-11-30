import { describe, expect, it } from 'vitest';
import { delay } from './delay.ts';

describe('delay', () => {
  it('resolves immediately if AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const start = performance.now();

    await delay(10, controller.signal);

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(5);
  });

  it('resolves after the specified time', async () => {
    const start = performance.now();

    await delay(10);

    const duration = performance.now() - start;
    expect(duration).toBeGreaterThanOrEqual(5);
  });

  it('resolves early if aborted during delay', async () => {
    const controller = new AbortController();
    const delayPromise = delay(50, controller.signal);

    const start = performance.now();
    setTimeout(() => controller.abort(), 10);
    await delayPromise;
    const duration = performance.now() - start;

    expect(duration).toBeGreaterThanOrEqual(5);
    expect(duration).toBeLessThan(20);
  });
});
