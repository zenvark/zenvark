import { describe, expect, it, vi } from 'vitest';
import { HealthCheckType } from '../constants.ts';
import { HealthCheckManager } from './health-check-manager.ts';

describe('HealthCheckManager', () => {
  it('calls runCheck repeatedly with provided type and increments attempts', async () => {
    const calls: HealthCheckType[] = [];
    const attempts: number[] = [];

    const manager = new HealthCheckManager({
      runCheck: (type) => {
        calls.push(type);
        if (calls.length >= 3) {
          void manager.stop();
        }

        return Promise.resolve();
      },
    });

    await manager.start({
      type: HealthCheckType.IDLE,
      getDelayMs: (attempt) => {
        attempts.push(attempt);
        return 0;
      },
    });

    await vi.waitUntil(() => attempts.length >= 3);

    expect(calls).toEqual([
      HealthCheckType.IDLE,
      HealthCheckType.IDLE,
      HealthCheckType.IDLE,
    ]);
    expect(attempts).toEqual([1, 2, 3]);
  });

  it('does not invoke runCheck if stopped during delay', async () => {
    let called = false;

    const manager = new HealthCheckManager({
      runCheck: () => {
        called = true;

        return Promise.resolve();
      },
    });

    await manager.start({
      type: HealthCheckType.RECOVERY,
      getDelayMs: () => 50,
    });

    setTimeout(() => {
      void manager.stop();
    }, 10);

    await vi.waitUntil(() => !manager.isOperational);

    expect(called).toBe(false);
  });

  it('restart resets attempt counter for new config', async () => {
    const attemptsPhase1: number[] = [];
    const attemptsPhase2: number[] = [];

    let restarted = false;

    const manager = new HealthCheckManager({
      runCheck: () => {
        if (!restarted && attemptsPhase1.length >= 2) {
          restarted = true;

          void manager.restart({
            type: HealthCheckType.IDLE,
            getDelayMs: (attempt) => {
              attemptsPhase2.push(attempt);
              return 1;
            },
          });
        }

        if (restarted && attemptsPhase2.length >= 2) {
          void manager.stop();
        }

        return Promise.resolve();
      },
    });

    await manager.start({
      type: HealthCheckType.RECOVERY,
      getDelayMs: (attempt) => {
        attemptsPhase1.push(attempt);
        return 1;
      },
    });

    await vi.waitUntil(() => attemptsPhase2.length >= 2);

    expect(attemptsPhase1[0]).toBe(1);
    expect(attemptsPhase2[0]).toBe(1);
  });
});
