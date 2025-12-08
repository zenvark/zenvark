import { Registry } from 'prom-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { CallResult, HealthCheckType } from 'zenvark';
import { PrometheusBreakerMetrics } from './prometheus-breaker-metrics.ts';

describe('PrometheusBreakerMetrics', () => {
  let registry: Registry;
  const breakerId = 'testBreaker';

  beforeEach(() => {
    registry = new Registry();
  });

  it('registers metrics with default prefix', async () => {
    new PrometheusBreakerMetrics({ registry });

    const allMetrics = await registry.metrics();

    // Default prefix is 'zenvark'
    expect(allMetrics).toContain('zenvark_call_duration_seconds');
    expect(allMetrics).toContain('zenvark_blocked_requests_total');
    expect(allMetrics).toContain('zenvark_healthcheck_duration_seconds');
  });

  it('recordCall observes duration with success result label', async () => {
    const callResult = CallResult.SUCCESS;

    const bm = new PrometheusBreakerMetrics({ registry });

    bm.recordCall({ breakerId, result: callResult, durationMs: 400 });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain('zenvark_call_duration_seconds');
    expect(allMetrics).toContain(`breaker_id="${breakerId}"`);
    expect(allMetrics).toContain(`result="${callResult}"`);
    expect(allMetrics).toContain('0.4');
  });

  it('recordCall observes duration with failure result label', async () => {
    const callResult = CallResult.FAILURE;

    const bm = new PrometheusBreakerMetrics({ registry });

    bm.recordCall({ breakerId, result: callResult, durationMs: 300 });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain('zenvark_call_duration_seconds');
    expect(allMetrics).toContain(`breaker_id="${breakerId}"`);
    expect(allMetrics).toContain(`result="${callResult}"`);
    expect(allMetrics).toContain('0.3');
  });

  it('recordBlockedRequest increments blocked requests counter', async () => {
    const bm = new PrometheusBreakerMetrics({ registry });

    bm.recordBlockedRequest({ breakerId });
    bm.recordBlockedRequest({ breakerId });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toMatch(
      new RegExp(
        `zenvark_blocked_requests_total{[^}]*breaker_id="${breakerId}"[^}]*} 2`,
      ),
    );
  });

  it('recordHealthCheck observes duration with correct labels', async () => {
    const callResult = CallResult.SUCCESS;

    const bm = new PrometheusBreakerMetrics({ registry });
    const type = HealthCheckType.IDLE;

    bm.recordHealthCheck({
      breakerId,
      type,
      result: callResult,
      durationMs: 700,
    });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain('zenvark_healthcheck_duration_seconds');
    expect(allMetrics).toContain(`breaker_id="${breakerId}"`);
    expect(allMetrics).toContain(`type="${type}"`);
    expect(allMetrics).toContain(`result="${callResult}"`);
    expect(allMetrics).toContain('0.7');
  });

  it('uses the custom prefix and includes custom labels in metrics', async () => {
    const prefix = 'testprefix';
    const customLabels = { env: 'test', version: 'v1' };

    const bm = new PrometheusBreakerMetrics({
      registry,
      prefix,
      customLabels,
    });

    // Record a metric to see the labels
    bm.recordBlockedRequest({ breakerId });

    const allMetrics = await registry.metrics();

    expect(allMetrics).toContain(`${prefix}_call_duration_seconds`);
    expect(allMetrics).toContain(`${prefix}_blocked_requests_total`);
    expect(allMetrics).toContain(`${prefix}_healthcheck_duration_seconds`);

    expect(allMetrics).toContain(`breaker_id="${breakerId}"`);
    expect(allMetrics).toContain(`env="${customLabels.env}"`);
    expect(allMetrics).toContain(`version="${customLabels.version}"`);
  });

  describe('initialize', () => {
    it('makes blocked requests counter visible before any actual blocks occur', async () => {
      const bm = new PrometheusBreakerMetrics({ registry });

      bm.initialize(breakerId);

      const metricsBeforeBlock = await registry.metrics();
      expect(metricsBeforeBlock).toContain('zenvark_blocked_requests_total');
      expect(metricsBeforeBlock).toContain(`breaker_id="${breakerId}"`);

      // Counter should still increment normally after initialization
      bm.recordBlockedRequest({ breakerId });

      const metricsAfterBlock = await registry.metrics();
      expect(metricsAfterBlock).toMatch(
        new RegExp(
          `zenvark_blocked_requests_total{[^}]*breaker_id="${breakerId}"[^}]*} 1`,
        ),
      );
    });

    it('works with custom labels', async () => {
      const customLabels = { env: 'production', region: 'us-east' };
      const bm = new PrometheusBreakerMetrics({ registry, customLabels });

      bm.initialize(breakerId);

      const allMetrics = await registry.metrics();

      expect(allMetrics).toContain(`breaker_id="${breakerId}"`);
      expect(allMetrics).toContain(`env="${customLabels.env}"`);
      expect(allMetrics).toContain(`region="${customLabels.region}"`);
      expect(allMetrics).toMatch(/zenvark_blocked_requests_total{[^}]*} 0/);
    });
  });
});
