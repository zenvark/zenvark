import { Registry } from '@prometheus-io/client';
import { describe, expect, it } from 'vitest';
import {
  AcquireResult,
  CallResult,
  CircuitRole,
  CircuitState,
  HealthCheckType,
  LeaseOutcome,
  LimitChangeDirection,
} from 'zenvark';
import { PrometheusBreakerMetrics } from './prometheus-breaker-metrics.ts';
import { PrometheusSemaphoreMetrics } from './prometheus-semaphore-metrics.ts';
import { ZenvarkProm } from './zenvark-prom.ts';

describe('ZenvarkProm', () => {
  const breakerId = 'testBreaker';
  const semaphoreId = 'testSemaphore';
  const options = { prefix: 'app', customLabels: { env: 'test' } };

  it('reports the same metrics as the deprecated recorders', async () => {
    const legacyRegistry = new Registry();
    const legacyBreaker = new PrometheusBreakerMetrics({
      registry: legacyRegistry,
      ...options,
    });
    const legacySemaphore = new PrometheusSemaphoreMetrics({
      registry: legacyRegistry,
      ...options,
    });
    const registry = new Registry();
    const prom = new ZenvarkProm({ registry, ...options });

    legacyBreaker.initialize(breakerId);
    prom.onBreakerInit({ breakerId });
    const call = { breakerId, result: CallResult.FAILURE, durationMs: 120 };
    legacyBreaker.recordCall(call);
    prom.onCallEnd(call);
    legacyBreaker.recordBlockedRequest({ breakerId });
    prom.onBlockedRequest({ breakerId });
    const check = {
      breakerId,
      type: HealthCheckType.RECOVERY,
      result: CallResult.SUCCESS,
      durationMs: 40,
    };
    legacyBreaker.recordHealthCheck(check);
    prom.onHealthCheckEnd(check);
    legacyBreaker.recordStateChange({ breakerId, state: CircuitState.OPEN });
    prom.onStateChange({ breakerId, state: CircuitState.OPEN });

    legacySemaphore.initialize(semaphoreId);
    prom.onSemaphoreInit({ semaphoreId });
    legacySemaphore.recordAcquire({
      id: semaphoreId,
      class: 'bulk',
      result: AcquireResult.ACQUIRED,
      waitMs: 15,
    });
    prom.onAcquire({
      semaphoreId,
      class: 'bulk',
      result: AcquireResult.ACQUIRED,
      waitMs: 15,
    });
    legacySemaphore.recordRelease({
      id: semaphoreId,
      class: 'bulk',
      outcome: LeaseOutcome.THROTTLED,
      heldMs: 300,
    });
    prom.onRelease({
      semaphoreId,
      class: 'bulk',
      outcome: LeaseOutcome.THROTTLED,
      heldMs: 300,
    });
    legacySemaphore.recordLimitChange({
      id: semaphoreId,
      limit: 5,
      direction: LimitChangeDirection.DECREASE,
    });
    prom.onLimitChange({
      semaphoreId,
      limit: 5,
      direction: LimitChangeDirection.DECREASE,
    });
    legacySemaphore.recordThrottle({ id: semaphoreId });
    prom.onThrottle({ semaphoreId });

    const output = await registry.metrics();
    expect(output).toBe(await legacyRegistry.metrics());
    expect(output).toContain('app_call_duration_seconds');
    expect(output).toContain(`semaphore_id="${semaphoreId}"`);
  });

  it('reports the state gauge only while this instance is the leader', async () => {
    const registry = new Registry();
    const prom = new ZenvarkProm({ registry });
    const stateSeries = new RegExp(
      `zenvark_state{[^}]*breaker_id="${breakerId}"[^}]*state="open"[^}]*} 1`,
    );

    prom.onRoleChange({
      breakerId,
      role: CircuitRole.LEADER,
      state: CircuitState.OPEN,
    });
    expect(await registry.metrics()).toMatch(stateSeries);

    prom.onRoleChange({
      breakerId,
      role: CircuitRole.FOLLOWER,
      state: CircuitState.OPEN,
    });
    expect(await registry.metrics()).not.toMatch(
      new RegExp(`zenvark_state{[^}]*breaker_id="${breakerId}"`),
    );
  });
});
