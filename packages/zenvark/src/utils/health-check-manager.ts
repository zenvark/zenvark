import type { HealthCheckType } from '../constants.ts';
import { AbstractLifecycleManager } from './abstract-lifecycle-manager.ts';
import { delay } from './delay.ts';

type RunCheck = (type: HealthCheckType, signal: AbortSignal) => Promise<void>;

type HealthCheckManagerOptions = {
	/**
	 * The function to execute on each loop iteration.
	 * It is expected to handle its own internal errors gracefully.
	 * The manager will not react to failures.
	 */
	runCheck: RunCheck;
};

export type HealthCheckStartOptions = {
	/** Which healthcheck type to run for this loop instance */
	type: HealthCheckType;
	/** Computes delay before each attempt. Attempt starts at 1 and increments after failures. */
	getDelayMs: (attempt: number) => number;
};

type HealthCheckLoop = {
	abortController: AbortController;
	promise: Promise<unknown>;
};

/**
 * Manages recurring health check execution in a cancellable loop.
 */
export class HealthCheckManager extends AbstractLifecycleManager<HealthCheckStartOptions> {
	private readonly runCheck: RunCheck;

	private healthCheckLoop: HealthCheckLoop | null = null;

	constructor(options: HealthCheckManagerOptions) {
		super();

		this.runCheck = options.runCheck;
	}

	protected override startInternal(
		options: HealthCheckStartOptions,
	): Promise<void> {
		const abortController = new AbortController();
		this.healthCheckLoop = {
			abortController,
			promise: this.startHealthCheckLoop(abortController.signal, options),
		};

		return Promise.resolve();
	}

	protected override async stopInternal(): Promise<void> {
		if (!this.healthCheckLoop) {
			return;
		}

		this.healthCheckLoop.abortController.abort();
		await this.healthCheckLoop.promise;

		this.healthCheckLoop = null;
	}

	private async startHealthCheckLoop(
		signal: AbortSignal,
		options: HealthCheckStartOptions,
	): Promise<void> {
		let attempt = 1;

		while (!signal.aborted) {
			const delayMs = options.getDelayMs(attempt);

			await delay(delayMs, signal);
			if (signal.aborted) {
				return;
			}

			await this.runCheck(options.type, signal);

			attempt += 1;
		}
	}
}
