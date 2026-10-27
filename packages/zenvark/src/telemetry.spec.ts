import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircuitState, HealthCheckType } from './constants.ts';
import {
  BreakerTelemetry,
  clearRegisteredTelemetry,
  registerTelemetry,
  type Telemetry,
  type TelemetryOptions,
} from './telemetry.ts';

// An integration that logs when its wrappers enter and leave, so tests can
// tell which integrations ran and how they nest
const createIntegration = (name: string, log: string[]): Telemetry => ({
  executeCall: async ({ execute }) => {
    log.push(`${name}:enter`);
    try {
      return await execute();
    } finally {
      log.push(`${name}:exit`);
    }
  },
  executeHealthCheck: async ({ type, execute }) => {
    log.push(`${name}:healthcheck:${type}`);
    await execute();
  },
  onBlockedRequest: ({ breakerId }) => {
    log.push(`${name}:blocked:${breakerId}`);
  },
  onStateChange: ({ state }) => {
    log.push(`${name}:state:${state}`);
  },
});

describe('BreakerTelemetry', () => {
  const createTelemetry = (
    options?: TelemetryOptions,
    onError: (message: string, cause: unknown) => void = vi.fn(),
  ) => new BreakerTelemetry({ breakerId: 'test', options, onError });

  afterEach(() => {
    clearRegisteredTelemetry();
  });

  it('runs the call directly when no integrations are registered', async () => {
    const telemetry = createTelemetry();

    await expect(telemetry.executeCall(async () => 'ok')).resolves.toBe('ok');
  });

  it('uses integrations registered after the breaker was created', async () => {
    const log: string[] = [];
    const telemetry = createTelemetry();

    registerTelemetry(createIntegration('global', log));
    const result = await telemetry.executeCall(async () => {
      log.push('call');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(log).toEqual(['global:enter', 'call', 'global:exit']);
  });

  it('nests wrappers with the first integration outermost', async () => {
    const log: string[] = [];
    registerTelemetry(createIntegration('a', log));
    registerTelemetry(createIntegration('b', log));
    const telemetry = createTelemetry();

    await telemetry.executeCall(async () => {
      log.push('call');
    });

    expect(log).toEqual(['a:enter', 'b:enter', 'call', 'b:exit', 'a:exit']);
  });

  it('skips integrations that do not implement a hook', async () => {
    const log: string[] = [];
    registerTelemetry({}, createIntegration('b', log));
    const telemetry = createTelemetry();

    await telemetry.executeCall(async () => {
      log.push('call');
    });
    await telemetry.executeHealthCheck(
      HealthCheckType.IDLE,
      new AbortController().signal,
      async () => {},
    );
    telemetry.blockedRequest();

    expect(log).toEqual([
      'b:enter',
      'call',
      'b:exit',
      'b:healthcheck:idle',
      'b:blocked:test',
    ]);
  });

  it('replaces global integrations with per-breaker ones', async () => {
    const log: string[] = [];
    registerTelemetry(createIntegration('global', log));
    const telemetry = createTelemetry({
      integrations: createIntegration('local', log),
    });

    await telemetry.executeCall(async () => {});
    telemetry.stateChange(CircuitState.OPEN);

    expect(log).toEqual(['local:enter', 'local:exit', 'local:state:open']);
  });

  it('disables all integrations when isEnabled is false', async () => {
    const log: string[] = [];
    registerTelemetry(createIntegration('global', log));
    const telemetry = createTelemetry({
      isEnabled: false,
      integrations: [createIntegration('local', log)],
    });

    await telemetry.executeCall(async () => {});
    await telemetry.executeHealthCheck(
      HealthCheckType.RECOVERY,
      new AbortController().signal,
      async () => {},
    );
    telemetry.blockedRequest();
    telemetry.stateChange(CircuitState.OPEN);

    expect(log).toEqual([]);
  });

  it('reports a throwing event hook without skipping other integrations', () => {
    const log: string[] = [];
    const onError = vi.fn();
    const hookError = new Error('hook failed');
    registerTelemetry(
      {
        onBlockedRequest: () => {
          throw hookError;
        },
      },
      createIntegration('b', log),
    );
    const telemetry = createTelemetry(undefined, onError);

    expect(() => telemetry.blockedRequest()).not.toThrow();

    expect(log).toEqual(['b:blocked:test']);
    expect(onError).toHaveBeenCalledWith(
      'Telemetry integration onBlockedRequest threw',
      hookError,
    );
  });
});
