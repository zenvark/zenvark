import type { Redis } from 'ioredis';
import { Mutex } from 'redis-semaphore';
import { CircuitRoleEnum } from './constants.ts';
import { AbstractLifecycleManager } from './utils/AbstractLifecycleManager.ts';
import { delay } from './utils/delay.ts';

/**
 * Delay between attempts to acquire leadership, in milliseconds.
 * Defines how frequently the leader elector tries to obtain the leadership mutex.
 */
const ACQUIRE_LOOP_DELAY_MS = 5_000;

type LeaderElectorOptions = {
  /** Redis client used to acquire the mutex lock */
  redis: Redis;
  /** Redis key used to coordinate leadership */
  key: string;
  /** Called when an error occurs during the acquire loop */
  onAcquireError: (err: unknown) => void;
  /** Called when role changes to leader or follower */
  onRoleChange: (role: CircuitRoleEnum) => void;
};

type AcquireLoop = {
  abortController: AbortController;
  promise: Promise<unknown>;
};

/**
 * Performs leader election using a Redis-backed mutex and a periodic acquire loop.
 * Ensures only one instance holds leadership at a time.
 */
export class LeaderElector extends AbstractLifecycleManager {
  private readonly mutex: Mutex;
  private readonly onAcquireError: (err: unknown) => void;
  private readonly onRoleChange: (role: CircuitRoleEnum) => void;

  private acquireLoop: AcquireLoop | null = null;
  private currentRole: CircuitRoleEnum = CircuitRoleEnum.FOLLOWER;

  constructor(options: LeaderElectorOptions) {
    super();
    this.onAcquireError = options.onAcquireError;
    this.onRoleChange = options.onRoleChange;

    this.mutex = new Mutex(options.redis, options.key, {
      acquireAttemptsLimit: 1,
      onLockLost: () => {
        this.setRole(CircuitRoleEnum.FOLLOWER);
      },
    });
  }

  protected override startInternal(): Promise<void> {
    const abortController = new AbortController();

    this.acquireLoop = {
      abortController,
      promise: this.startAcquireLoop(abortController.signal),
    };

    return Promise.resolve();
  }

  protected override async stopInternal(): Promise<void> {
    if (!this.acquireLoop) {
      return;
    }

    this.acquireLoop.abortController.abort();
    await this.acquireLoop.promise;

    await this.mutex.release();
    this.setRole(CircuitRoleEnum.FOLLOWER);

    this.acquireLoop = null;
  }

  private setRole(role: CircuitRoleEnum): void {
    if (this.currentRole === role) {
      return;
    }
    this.currentRole = role;
    this.onRoleChange(role);
  }

  private async attemptAcquireLeadership(): Promise<void> {
    if (this.mutex.isAcquired) {
      return;
    }

    try {
      await this.mutex.tryAcquire();
    } catch (err) {
      this.onAcquireError(err);
    }

    if (this.mutex.isAcquired) {
      this.setRole(CircuitRoleEnum.LEADER);
    }
  }

  private async startAcquireLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.attemptAcquireLeadership();

      await delay(ACQUIRE_LOOP_DELAY_MS, signal);
    }
  }

  /** Returns true if this instance currently holds leadership */
  get isLeader(): boolean {
    return this.currentRole === CircuitRoleEnum.LEADER;
  }
}
