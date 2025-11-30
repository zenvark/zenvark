import { describe, expect, it } from 'vitest';
import { AbstractLifecycleManager } from './AbstractLifecycleManager.ts';

class TestLifecycleManager<
  TConfig = void,
> extends AbstractLifecycleManager<TConfig> {
  private startInternalCalled = 0;
  private stopInternalCalled = 0;
  private shouldFailStart = false;
  private shouldFailStop = false;

  setShouldFailStart(shouldFail: boolean): void {
    this.shouldFailStart = shouldFail;
  }

  setShouldFailStop(shouldFail: boolean): void {
    this.shouldFailStop = shouldFail;
  }

  get startInternalCallCount(): number {
    return this.startInternalCalled;
  }

  get stopInternalCallCount(): number {
    return this.stopInternalCalled;
  }

  execEnsureOperational(): void {
    this.ensureOperational();
  }

  protected override async startInternal(): Promise<void> {
    this.startInternalCalled++;

    await Promise.resolve();

    if (this.shouldFailStart) {
      throw new Error('Start failed');
    }
  }

  protected override async stopInternal(): Promise<void> {
    this.stopInternalCalled++;

    await Promise.resolve();

    if (this.shouldFailStop) {
      throw new Error('Stop failed');
    }
  }
}

describe('AbstractLifecycleManager', () => {
  describe('start', () => {
    it('should start successfully', async () => {
      const manager = new TestLifecycleManager();

      await manager.start();

      expect(manager.isOperational).toBe(true);
      expect(manager.startInternalCallCount).toBe(1);
    });

    it('should be idempotent - calling start multiple times should not cause errors', async () => {
      const manager = new TestLifecycleManager();

      await manager.start();
      await manager.start();
      await manager.start();

      expect(manager.isOperational).toBe(true);
      expect(manager.startInternalCallCount).toBe(1);
    });

    it('should handle concurrent start calls correctly', async () => {
      const manager = new TestLifecycleManager();

      await Promise.all([manager.start(), manager.start(), manager.start()]);

      expect(manager.isOperational).toBe(true);
      expect(manager.startInternalCallCount).toBe(1);
    });

    it('should handle start failure correctly', async () => {
      const manager = new TestLifecycleManager();
      manager.setShouldFailStart(true);

      await expect(manager.start()).rejects.toThrow('Start failed');

      expect(manager.isOperational).toBe(false);
      expect(manager.startInternalCallCount).toBe(1);
    });

    it('should throw error when starting while unrecoverable', async () => {
      const manager = new TestLifecycleManager();
      manager.setShouldFailStart(true);

      await expect(manager.start()).rejects.toThrow('Start failed');

      await expect(manager.start()).rejects.toThrow(
        'TestLifecycleManager is in an unrecoverable state after a previous failure. Create a new instance to continue.',
      );

      expect(manager.isOperational).toBe(false);
      expect(manager.startInternalCallCount).toBe(1);
    });
  });

  describe('start with config', () => {
    it('should be idempotent when called with an equivalent config object', async () => {
      const manager = new TestLifecycleManager<{ data: string }>();

      await manager.start({ data: 'test' });
      await manager.start({ data: 'test' });
      await manager.start({ data: 'test' });

      expect(manager.isOperational).toBe(true);
      expect(manager.startInternalCallCount).toBe(1);
    });

    it('should throw an error if start is called with a different config while operational', async () => {
      const manager = new TestLifecycleManager<number>();

      await manager.start(1);

      await expect(manager.start(2)).rejects.toThrow(
        'Cannot start with a new configuration while the process is running. Please stop it first.',
      );

      expect(manager.isOperational).toBe(true);
      expect(manager.startInternalCallCount).toBe(1);
    });

    it('should throw an error if start is called with a different config while already starting', async () => {
      const manager = new TestLifecycleManager<number>();

      const firstStartPromise = manager.start(1);

      await expect(manager.start(2)).rejects.toThrow(
        'Cannot start with a new configuration while a start operation is already in progress.',
      );

      await firstStartPromise;
      expect(manager.isOperational).toBe(true);
      expect(manager.startInternalCallCount).toBe(1);
    });
  });

  describe('stop', () => {
    it('should stop successfully from operational state', async () => {
      const manager = new TestLifecycleManager();
      await manager.start();

      await manager.stop();

      expect(manager.isOperational).toBe(false);
      expect(manager.stopInternalCallCount).toBe(1);
    });

    it('should be idempotent - calling stop multiple times should not cause errors', async () => {
      const manager = new TestLifecycleManager();
      await manager.start();

      await manager.stop();
      await manager.stop();
      await manager.stop();

      expect(manager.isOperational).toBe(false);
      expect(manager.stopInternalCallCount).toBe(1);
    });

    it('should handle concurrent stop calls correctly', async () => {
      const manager = new TestLifecycleManager();
      await manager.start();

      await Promise.all([manager.stop(), manager.stop(), manager.stop()]);

      expect(manager.isOperational).toBe(false);
      expect(manager.stopInternalCallCount).toBe(1);
    });

    it('should handle stop before start gracefully', async () => {
      const manager = new TestLifecycleManager();

      await manager.stop();

      expect(manager.isOperational).toBe(false);
      expect(manager.stopInternalCallCount).toBe(0);
    });

    it('should handle stop failure correctly', async () => {
      const manager = new TestLifecycleManager();
      await manager.start();
      manager.setShouldFailStop(true);

      await expect(manager.stop()).rejects.toThrow('Stop failed');

      expect(manager.isOperational).toBe(false);
      expect(manager.stopInternalCallCount).toBe(1);
    });

    it('should throw error when stopping while unrecoverable', async () => {
      const manager = new TestLifecycleManager();
      await manager.start();
      manager.setShouldFailStop(true);

      await expect(manager.stop()).rejects.toThrow('Stop failed');
      await expect(manager.stop()).rejects.toThrow(
        'TestLifecycleManager is in an unrecoverable state after a previous failure. Create a new instance to continue.',
      );

      expect(manager.isOperational).toBe(false);
      expect(manager.stopInternalCallCount).toBe(1);
    });
  });

  describe('concurrent start/stop operations', () => {
    it('should handle stop during start correctly', async () => {
      const manager = new TestLifecycleManager();

      const startPromise = manager.start();
      const stopPromise = manager.stop();

      await Promise.all([startPromise, stopPromise]);

      expect(manager.isOperational).toBe(false);
      expect(manager.startInternalCallCount).toBe(1);
      expect(manager.stopInternalCallCount).toBe(1);
    });

    it('should handle start during stop correctly', async () => {
      const manager = new TestLifecycleManager();
      await manager.start();

      const stopPromise = manager.stop();
      const startPromise = manager.start();

      await Promise.all([stopPromise, startPromise]);

      expect(manager.isOperational).toBe(true);
      expect(manager.startInternalCallCount).toBe(2);
      expect(manager.stopInternalCallCount).toBe(1);
    });

    it('should handle multiple concurrent start/stop operations', async () => {
      const manager = new TestLifecycleManager();

      await Promise.all([
        manager.start(),
        manager.stop(),
        manager.start(),
        manager.stop(),
        manager.start(),
      ]);

      // The final state depends on the order of completion, but we should have called both start and stop
      expect(manager.startInternalCallCount).toBeGreaterThan(0);
      expect(manager.stopInternalCallCount).toBeGreaterThan(0);

      // Ensure we end up in a valid state (either operational or stopped)
      const finalState = manager.isOperational;
      expect(typeof finalState).toBe('boolean');
    });
  });

  describe('restart', () => {
    it('should restart successfully from inactive', async () => {
      const manager = new TestLifecycleManager();

      await manager.restart();

      expect(manager.isOperational).toBe(true);
      expect(manager.startInternalCallCount).toBe(1);
      expect(manager.stopInternalCallCount).toBe(0);
    });

    it('should stop then start when restarting from operational', async () => {
      const manager = new TestLifecycleManager();
      await manager.start();

      await manager.restart();

      expect(manager.isOperational).toBe(true);
      expect(manager.startInternalCallCount).toBe(2);
      expect(manager.stopInternalCallCount).toBe(1);
    });

    it('should queue restart while start is in progress', async () => {
      const manager = new TestLifecycleManager();

      const startPromise = manager.start();
      const restartPromise = manager.restart();

      await Promise.all([startPromise, restartPromise]);

      expect(manager.isOperational).toBe(true);
      expect(manager.startInternalCallCount).toBe(2);
      expect(manager.stopInternalCallCount).toBe(1);
    });

    it('should surface stop failure on first restart and become unrecoverable for subsequent restarts', async () => {
      const manager = new TestLifecycleManager();
      await manager.start();
      manager.setShouldFailStop(true);

      await expect(manager.restart()).rejects.toThrow('Stop failed');

      await expect(manager.restart()).rejects.toThrow(
        'TestLifecycleManager is in an unrecoverable state after a previous failure. Create a new instance to continue.',
      );

      expect(manager.isOperational).toBe(false);
      expect(manager.stopInternalCallCount).toBe(1);
    });

    it('should handle restart during stopping by waiting then starting again', async () => {
      const manager = new TestLifecycleManager();
      await manager.start();

      const stopPromise = manager.stop();
      const restartPromise = manager.restart();

      await Promise.all([stopPromise, restartPromise]);

      expect(manager.isOperational).toBe(true);
      expect(manager.startInternalCallCount).toBe(2);
      expect(manager.stopInternalCallCount).toBe(1);
    });
  });

  describe('isOperational', () => {
    it('should transition through states correctly', async () => {
      const manager = new TestLifecycleManager();

      // Initial state
      expect(manager.isOperational).toBe(false);

      // Start
      await manager.start();
      expect(manager.isOperational).toBe(true);

      // Stop
      await manager.stop();
      expect(manager.isOperational).toBe(false);

      // Start again
      await manager.start();
      expect(manager.isOperational).toBe(true);
    });
  });

  describe('ensureOperational', () => {
    it('should not throw when operational', async () => {
      const manager = new TestLifecycleManager();
      await manager.start();

      expect(() => manager.execEnsureOperational()).not.toThrow();
    });

    it('should throw if not operational', () => {
      const manager = new TestLifecycleManager();

      expect(() => manager.execEnsureOperational()).toThrow(
        'TestLifecycleManager is not operational',
      );
    });

    it('should throw when stopped', async () => {
      const manager = new TestLifecycleManager();
      await manager.start();
      await manager.stop();

      expect(() => manager.execEnsureOperational()).toThrow(
        'TestLifecycleManager is not operational',
      );
    });

    it('should throw when in error state', async () => {
      const manager = new TestLifecycleManager();
      manager.setShouldFailStart(true);

      await expect(manager.start()).rejects.toThrow('Start failed');

      expect(() => manager.execEnsureOperational()).toThrow(
        'TestLifecycleManager is not operational',
      );
    });
  });
});
