import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircuitState, HealthCheckType } from './constants.ts';
import {
  BreakerTelemetry,
  clearRegisteredTelemetry,
  registerZenvarkTelemetry,
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

// The breaker settles with the work's outcome without waiting for the
// wrappers to finish; a macrotask lets them run to completion
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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

    registerZenvarkTelemetry(createIntegration('global', log));
    const result = await telemetry.executeCall(async () => {
      log.push('call');
      return 'ok';
    });
    await settle();

    expect(result).toBe('ok');
    expect(log).toEqual(['global:enter', 'call', 'global:exit']);
  });

  it('nests wrappers with the first integration outermost', async () => {
    const log: string[] = [];
    registerZenvarkTelemetry(createIntegration('a', log));
    registerZenvarkTelemetry(createIntegration('b', log));
    const telemetry = createTelemetry();

    await telemetry.executeCall(async () => {
      log.push('call');
    });
    await settle();

    expect(log).toEqual(['a:enter', 'b:enter', 'call', 'b:exit', 'a:exit']);
  });

  it('skips integrations that do not implement a hook', async () => {
    const log: string[] = [];
    registerZenvarkTelemetry({}, createIntegration('b', log));
    const telemetry = createTelemetry();

    await telemetry.executeCall(async () => {
      log.push('call');
    });
    await settle();
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
    registerZenvarkTelemetry(createIntegration('global', log));
    const telemetry = createTelemetry({
      integrations: createIntegration('local', log),
    });

    await telemetry.executeCall(async () => {});
    await settle();
    telemetry.stateChange(CircuitState.OPEN);

    expect(log).toEqual(['local:enter', 'local:exit', 'local:state:open']);
  });

  it('disables all integrations when isEnabled is false', async () => {
    const log: string[] = [];
    registerZenvarkTelemetry(createIntegration('global', log));
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
    registerZenvarkTelemetry(
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

  describe('guards the work against misbehaving integrations', () => {
    const work = () => vi.fn(async () => 'ok');

    it('runs the work when an integration never calls execute', async () => {
      const fn = work();
      const telemetry = createTelemetry({
        integrations: { executeCall: async <T>() => 'not called' as T },
      });

      await expect(telemetry.executeCall(fn)).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('runs the work once when an integration calls execute twice', async () => {
      const fn = work();
      const telemetry = createTelemetry({
        integrations: {
          executeCall: async ({ execute }) => {
            await execute();
            return execute();
          },
        },
      });

      await telemetry.executeCall(fn);
      await settle();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('settles with the work result, not the integration result', async () => {
      const telemetry = createTelemetry({
        integrations: {
          executeCall: async <T>({
            execute,
          }: {
            execute: () => Promise<T>;
          }) => {
            await execute();
            return 'replaced' as T;
          },
        },
      });

      await expect(telemetry.executeCall(work())).resolves.toBe('ok');
    });

    it('rejects with the work error even if an integration swallows it', async () => {
      const error = new Error('boom');
      const telemetry = createTelemetry({
        integrations: {
          executeCall: async ({ execute }) =>
            execute().catch(() => undefined as never),
        },
      });

      await expect(
        telemetry.executeCall(() => Promise.reject(error)),
      ).rejects.toBe(error);
    });

    it('does not wait for an integration that never settles', async () => {
      const telemetry = createTelemetry({
        integrations: {
          executeCall: async ({ execute }) => {
            await execute();
            return new Promise<never>(() => {});
          },
        },
      });

      await expect(telemetry.executeCall(work())).resolves.toBe('ok');
    });

    it('runs the work and reports an integration that throws before execute', async () => {
      const fn = work();
      const onError = vi.fn();
      const integrationError = new Error('integration failed');
      const telemetry = createTelemetry(
        {
          integrations: {
            executeCall: () => {
              throw integrationError;
            },
          },
        },
        onError,
      );

      await expect(telemetry.executeCall(fn)).resolves.toBe('ok');
      await settle();

      expect(fn).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        'Telemetry integration executeCall failed',
        integrationError,
      );
    });

    it('reports an integration that fails after the work succeeded', async () => {
      const onError = vi.fn();
      const integrationError = new Error('span export failed');
      const telemetry = createTelemetry(
        {
          integrations: {
            executeHealthCheck: async ({ execute }) => {
              await execute();
              throw integrationError;
            },
          },
        },
        onError,
      );

      await expect(
        telemetry.executeHealthCheck(
          HealthCheckType.IDLE,
          new AbortController().signal,
          async () => {},
        ),
      ).resolves.toBeUndefined();
      await settle();

      expect(onError).toHaveBeenCalledWith(
        'Telemetry integration executeHealthCheck failed',
        integrationError,
      );
    });

    it('does not report an integration that rethrows the work error', async () => {
      const onError = vi.fn();
      const error = new Error('boom');
      registerZenvarkTelemetry(createIntegration('a', []));
      const telemetry = createTelemetry(undefined, onError);

      await expect(
        telemetry.executeCall(() => Promise.reject(error)),
      ).rejects.toBe(error);
      await settle();

      expect(onError).not.toHaveBeenCalled();
    });

    it('runs work that throws synchronously once and rejects with its error', async () => {
      const error = new Error('sync');
      const fn = vi.fn((): Promise<never> => {
        throw error;
      });
      registerZenvarkTelemetry(createIntegration('a', []));
      const telemetry = createTelemetry();

      await expect(telemetry.executeCall(fn)).rejects.toBe(error);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
