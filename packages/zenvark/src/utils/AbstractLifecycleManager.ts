import { isDeepStrictEqual } from 'node:util';
import type { ObjectValues } from '../types.ts';

// Represents the possible states of the lifecycle manager
export const LifecycleState = {
	// Never started or already stopped
	INACTIVE: 'inactive',
	// Currently in the process of starting
	STARTING: 'starting',
	// Successfully started and ready to use
	OPERATIONAL: 'operational',
	// Currently in the process of stopping
	STOPPING: 'stopping',
	// Fatal error requiring the manager to be recreated
	UNRECOVERABLE: 'unrecoverable',
} as const;
export type LifecycleState = ObjectValues<typeof LifecycleState>;

type StateInactive = {
	lifecycleState: typeof LifecycleState.INACTIVE;
};

type StateStarting<TConfig> = {
	lifecycleState: typeof LifecycleState.STARTING;
	startPromise: Promise<void>;
	config: TConfig;
};

type StateOperational<TConfig> = {
	lifecycleState: typeof LifecycleState.OPERATIONAL;
	config: TConfig;
};

type StateStopping = {
	lifecycleState: typeof LifecycleState.STOPPING;
	stopPromise: Promise<void>;
};

type StateUnrecoverable = {
	lifecycleState: typeof LifecycleState.UNRECOVERABLE;
	error: unknown;
};

type ManagerState<TConfig> =
	| StateInactive
	| StateStarting<TConfig>
	| StateOperational<TConfig>
	| StateStopping
	| StateUnrecoverable;

/**
 * An abstract class that provides a robust state machine for managing a
 * component's lifecycle (start, stop, restart) with safe concurrency handling.
 */
export abstract class AbstractLifecycleManager<TConfig = void> {
	private managerState: ManagerState<TConfig> = {
		lifecycleState: LifecycleState.INACTIVE,
	};

	protected abstract startInternal(config: TConfig): Promise<void>;
	protected abstract stopInternal(): Promise<void>;

	private createUnrecoverableError(cause: unknown): Error {
		return new Error(
			`${this.constructor.name} is in an unrecoverable state after a previous failure. Create a new instance to continue.`,
			{ cause },
		);
	}

	/**
	 * Starts the manager with the given configuration. This operation is idempotent
	 * if called with the same configuration. Attempting to start with a different
	 * configuration while already starting or running will throw an error.
	 */
	async start(config: TConfig): Promise<void> {
		switch (this.managerState.lifecycleState) {
			case LifecycleState.UNRECOVERABLE:
				throw this.createUnrecoverableError(this.managerState.error);

			case LifecycleState.STOPPING:
				await this.managerState.stopPromise;
				return this.start(config);

			case LifecycleState.STARTING:
				if (!isDeepStrictEqual(config, this.managerState.config)) {
					throw new Error(
						'Cannot start with a new configuration while a start operation is already in progress.',
					);
				}
				return this.managerState.startPromise;

			case LifecycleState.OPERATIONAL:
				if (!isDeepStrictEqual(config, this.managerState.config)) {
					throw new Error(
						'Cannot start with a new configuration while the process is running. Please stop it first.',
					);
				}
				return;

			case LifecycleState.INACTIVE:
				this.managerState = {
					lifecycleState: LifecycleState.STARTING,
					startPromise: this.startInternal(config),
					config,
				};
				try {
					await this.managerState.startPromise;
					this.managerState = {
						lifecycleState: LifecycleState.OPERATIONAL,
						config,
					};
				} catch (err) {
					this.managerState = {
						lifecycleState: LifecycleState.UNRECOVERABLE,
						error: err,
					};
					throw err;
				}
				return;
		}
	}

	/**
	 * Stops the manager. This operation is idempotent. If called while the manager
	 * is starting, it will await the start's completion before stopping.
	 */
	async stop(): Promise<void> {
		switch (this.managerState.lifecycleState) {
			case LifecycleState.UNRECOVERABLE:
				throw this.createUnrecoverableError(this.managerState.error);

			case LifecycleState.STARTING:
				await this.managerState.startPromise;
				return this.stop();

			case LifecycleState.STOPPING:
				return this.managerState.stopPromise;

			case LifecycleState.INACTIVE:
				return;

			case LifecycleState.OPERATIONAL:
				this.managerState = {
					lifecycleState: LifecycleState.STOPPING,
					stopPromise: this.stopInternal(),
				};
				try {
					await this.managerState.stopPromise;
					this.managerState = { lifecycleState: LifecycleState.INACTIVE };
				} catch (err) {
					this.managerState = {
						lifecycleState: LifecycleState.UNRECOVERABLE,
						error: err,
					};
					throw err;
				}
				return;
		}
	}

	/**
	 * Stops and then starts the manager with a new configuration. This operation
	 * is not idempotent and always forces a full restart cycle.
	 * Concurrent calls are queued and executed sequentially.
	 */
	async restart(config: TConfig): Promise<void> {
		while (this.managerState.lifecycleState !== LifecycleState.INACTIVE) {
			await this.stop();
		}

		await this.start(config);
	}

	/**
	 * Returns `true` if the manager is in the `OPERATIONAL` state.
	 */
	get isOperational(): boolean {
		return this.managerState.lifecycleState === LifecycleState.OPERATIONAL;
	}

	/**
	 * Ensures the manager is operational, throwing an error otherwise.
	 */
	protected ensureOperational(): void {
		if (!this.isOperational) {
			throw new Error(
				`${this.constructor.name} is not operational (current state: ${this.managerState.lifecycleState}).`,
			);
		}
	}
}
