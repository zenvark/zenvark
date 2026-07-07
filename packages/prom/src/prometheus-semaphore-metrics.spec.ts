import {
  AcquireResult,
  LeaseOutcome,
  LimitChangeDirection,
} from '@zenvark/semaphore';
import { Registry } from 'prom-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { PrometheusSemaphoreMetrics } from './prometheus-semaphore-metrics.ts';

describe('PrometheusSemaphoreMetrics', () => {
  let registry: Registry;
  const semaphoreId = 'testSemaphore';

  beforeEach(() => {
    registry = new Registry();
  });

  it('registers metrics with default prefix', async () => {
    new PrometheusSemaphoreMetrics({ registry });

    const allMetrics = await registry.metrics();

    // Default prefix is 'zenvark'
    expect(allMetrics).toContain('zenvark_semaphore_acquire_wait_seconds');
    expect(allMetrics).toContain('zenvark_semaphore_hold_duration_seconds');
    expect(allMetrics).toContain('zenvark_semaphore_limit');
    expect(allMetrics).toContain('zenvark_semaphore_throttle_events_total');
  });

  it('registers metrics with custom prefix', async () => {
    new PrometheusSemaphoreMetrics({ registry, prefix: 'custom' });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain('custom_semaphore_acquire_wait_seconds');
    expect(allMetrics).toContain('custom_semaphore_limit');
  });

  it('initialize sets the throttle counter to 0', async () => {
    const sm = new PrometheusSemaphoreMetrics({ registry });

    sm.initialize(semaphoreId);

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain(
      `zenvark_semaphore_throttle_events_total{semaphore_id="${semaphoreId}"} 0`,
    );
  });

  it('recordAcquire observes wait duration with result and class labels', async () => {
    const sm = new PrometheusSemaphoreMetrics({ registry });

    sm.recordAcquire({
      id: semaphoreId,
      class: 'interactive',
      result: AcquireResult.ACQUIRED,
      waitMs: 400,
    });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain('zenvark_semaphore_acquire_wait_seconds');
    expect(allMetrics).toContain(`semaphore_id="${semaphoreId}"`);
    expect(allMetrics).toContain('class="interactive"');
    expect(allMetrics).toContain(`result="${AcquireResult.ACQUIRED}"`);
    expect(allMetrics).toContain('0.4');
  });

  it('recordAcquire uses an empty class label when no class was given', async () => {
    const sm = new PrometheusSemaphoreMetrics({ registry });

    sm.recordAcquire({
      id: semaphoreId,
      result: AcquireResult.TIMEOUT,
      waitMs: 100,
    });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain('class=""');
    expect(allMetrics).toContain(`result="${AcquireResult.TIMEOUT}"`);
  });

  it('recordRelease observes hold duration with outcome label', async () => {
    const sm = new PrometheusSemaphoreMetrics({ registry });

    sm.recordRelease({
      id: semaphoreId,
      class: 'background',
      outcome: LeaseOutcome.THROTTLED,
      heldMs: 300,
    });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain('zenvark_semaphore_hold_duration_seconds');
    expect(allMetrics).toContain(`outcome="${LeaseOutcome.THROTTLED}"`);
    expect(allMetrics).toContain('0.3');
  });

  it('recordLimitChange sets the limit gauge', async () => {
    const sm = new PrometheusSemaphoreMetrics({ registry });

    sm.recordLimitChange({
      id: semaphoreId,
      limit: 12,
      direction: LimitChangeDirection.INCREASE,
    });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain(
      `zenvark_semaphore_limit{semaphore_id="${semaphoreId}"} 12`,
    );
  });

  it('recordThrottle increments the throttle counter', async () => {
    const sm = new PrometheusSemaphoreMetrics({ registry });

    sm.recordThrottle({ id: semaphoreId });
    sm.recordThrottle({ id: semaphoreId });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain(
      `zenvark_semaphore_throttle_events_total{semaphore_id="${semaphoreId}"} 2`,
    );
  });

  it('adds custom labels to all metrics', async () => {
    const sm = new PrometheusSemaphoreMetrics({
      registry,
      customLabels: { app: 'myApp' },
    });

    sm.recordThrottle({ id: semaphoreId });
    sm.recordLimitChange({
      id: semaphoreId,
      limit: 5,
      direction: LimitChangeDirection.INIT,
    });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain(
      `zenvark_semaphore_throttle_events_total{app="myApp",semaphore_id="${semaphoreId}"} 1`,
    );
    expect(allMetrics).toContain(
      `zenvark_semaphore_limit{app="myApp",semaphore_id="${semaphoreId}"} 5`,
    );
  });
});
