import { describe, expect, it, vi } from 'vitest';
import { redis } from '../test/setup-redis.ts';
import { CircuitRole } from './constants.ts';
import { LeaderElector } from './leader-elector.ts';

describe('LeaderElector', () => {
  it('start is idempotent - calling twice should not throw', async () => {
    const elector = new LeaderElector({
      redis,
      key: 'duplicate',
      onRoleChange: vi.fn(),
      onAcquireError: vi.fn(),
    });

    await elector.start();

    await expect(elector.start()).resolves.not.toThrow();

    await elector.stop();
  });

  it('stop is idempotent - calling before start should not throw', async () => {
    const elector = new LeaderElector({
      redis,
      key: 'not-started',
      onRoleChange: vi.fn(),
      onAcquireError: vi.fn(),
    });

    await expect(elector.stop()).resolves.not.toThrow();
  });

  it('stop is idempotent - calling twice should not throw', async () => {
    const elector = new LeaderElector({
      redis,
      key: 'double-stop',
      onRoleChange: vi.fn(),
      onAcquireError: vi.fn(),
    });

    await elector.start();
    const stopPromise = elector.stop();

    await expect(elector.stop()).resolves.not.toThrow();

    await stopPromise;
  });

  it('acquires leadership and calls onRoleChange with leader', async () => {
    const onRoleChange = vi.fn();

    const elector = new LeaderElector({
      redis,
      key: 'test',
      onRoleChange,
      onAcquireError: vi.fn(),
    });

    await elector.start();

    await vi.waitFor(() => {
      expect(elector.isLeader).toBe(true);
      expect(onRoleChange).toHaveBeenCalledWith(CircuitRole.LEADER);
    });

    await elector.stop();
  });

  it('only one leader at a time', async () => {
    const electorA = new LeaderElector({
      redis,
      key: 'test',
      onRoleChange: vi.fn(),
      onAcquireError: vi.fn(),
    });

    const electorB = new LeaderElector({
      redis,
      key: 'test',
      onRoleChange: vi.fn(),
      onAcquireError: vi.fn(),
    });

    await Promise.all([electorA.start(), electorB.start()]);

    await vi.waitFor(() => {
      const leaders = [electorA.isLeader, electorB.isLeader].filter(Boolean);
      expect(leaders).toHaveLength(1);
    });

    await Promise.all([electorA.stop(), electorB.stop()]);
  });

  it('releases leadership on stop, allowing new leader', async () => {
    const onRoleChangeA = vi.fn();
    const electorA = new LeaderElector({
      redis,
      key: 'handover',
      onRoleChange: onRoleChangeA,
      onAcquireError: vi.fn(),
    });

    const onRoleChangeB = vi.fn();
    const electorB = new LeaderElector({
      redis,
      key: 'handover',
      onRoleChange: onRoleChangeB,
      onAcquireError: vi.fn(),
    });

    await electorA.start();

    await vi.waitFor(() => {
      expect(electorA.isLeader).toBe(true);
      expect(onRoleChangeA).toHaveBeenCalledWith(CircuitRole.LEADER);
    });

    await electorA.stop();

    await vi.waitFor(() => {
      expect(onRoleChangeA).toHaveBeenCalledWith(CircuitRole.FOLLOWER);
    });

    await electorB.start();

    await vi.waitFor(() => {
      expect(electorB.isLeader).toBe(true);
      expect(onRoleChangeB).toHaveBeenCalledWith(CircuitRole.LEADER);
    });

    await electorB.stop();

    await vi.waitFor(() => {
      expect(onRoleChangeB).toHaveBeenCalledWith(CircuitRole.FOLLOWER);
    });
  });
});
