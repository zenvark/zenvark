import type { Redis } from 'ioredis';
import type { BreakerMetricsRecorder } from './BreakerMetricsRecorder.ts';
import type { BackoffStrategy } from './backoffs/BackoffStrategy.ts';
import type { BreakerStrategy } from './breakers/BreakerStrategy.ts';
import {
	CallResultEnum,
	CircuitRoleEnum,
	CircuitStateEnum,
	HealthCheckTypeEnum,
} from './constants.ts';
import { CircuitOpenError } from './errors/circuitOpenError.ts';
import { LeaderElector } from './LeaderElector.ts';
import { CallResultStore } from './stores/CallResultStore.ts';
import { CircuitStateStore } from './stores/CircuitStateStore.ts';
import type { CallResultEvent } from './types.ts';
import { AbstractLifecycleManager } from './utils/AbstractLifecycleManager.ts';
import { HealthCheckManager } from './utils/HealthCheckManager.ts';

type HealthConfig = {
	backoff: BackoffStrategy;
	check: (type: HealthCheckTypeEnum, signal: AbortSignal) => Promise<void>;
	idleProbeIntervalMs?: number;
};

type OnErrorCallback = (err: Error) => void;
type OnRoleChangeCallback = (role: CircuitRoleEnum) => void;
type OnStateChangeCallback = (state: CircuitStateEnum) => void;

export type CircuitBreakerOptions = {
	id: string;
	redis: Redis;
	breaker: BreakerStrategy;
	health: HealthConfig;
	onError?: OnErrorCallback;
	onRoleChange?: OnRoleChangeCallback;
	onStateChange?: OnStateChangeCallback;
	metrics?: BreakerMetricsRecorder;
};

export class CircuitBreaker extends AbstractLifecycleManager {
	private readonly id: string;
	private readonly redis: Redis;
	private readonly breaker: BreakerStrategy;
	private readonly health: HealthConfig;
	private readonly onError?: OnErrorCallback;
	private readonly onRoleChange?: OnRoleChangeCallback;
	private readonly onStateChange?: OnStateChangeCallback;
	private readonly metrics?: BreakerMetricsRecorder;

	private readonly circuitStateStore: CircuitStateStore;
	private readonly callResultStore: CallResultStore;
	private readonly elector: LeaderElector;
	private readonly healthCheckManager: HealthCheckManager;

	constructor(options: CircuitBreakerOptions) {
		super();
		this.id = options.id;
		this.redis = options.redis;
		this.breaker = options.breaker;
		this.health = options.health;
		this.onError = options.onError;
		this.onRoleChange = options.onRoleChange;
		this.onStateChange = options.onStateChange;
		this.metrics = options.metrics;

		this.metrics?.initialize?.(this.id);

		this.circuitStateStore = new CircuitStateStore({
			redis: this.redis,
			redisStreamKey: `circuit:${this.id}:state`,
			onStreamReadError: (err: unknown) => {
				this.handleError('CircuitStateStore stream read error', err);
			},
			onStateChange: (state) => {
				this.onStateChange?.(state);
			},
		});

		this.callResultStore = new CallResultStore({
			redis: this.redis,
			redisStreamKey: `circuit:${this.id}:call-result`,
			maxLen: 1000,
			onStreamReadError: (err: unknown) => {
				this.handleError('CallResultStore stream read error', err);
			},
			onEventsAdded: (events) => {
				void this.handleEventsAdded(events);
			},
		});

		this.elector = new LeaderElector({
			redis: this.redis,
			key: `circuit:${options.id}:leader`,
			onAcquireError: (err: unknown) => {
				this.handleError('LeaderElector acquire error', err);
			},
			onRoleChange: (role) => {
				if (role === CircuitRoleEnum.LEADER) {
					if (this.state === CircuitStateEnum.OPEN) {
						void this.runRecoveryHealthChecks();
					} else if (this.health.idleProbeIntervalMs) {
						void this.rescheduleIdleHealthChecks();
					}
				} else {
					void this.stopHealthChecks();
				}

				this.onRoleChange?.(role);
			},
		});

		this.healthCheckManager = new HealthCheckManager({
			runCheck: async (type, signal) => {
				const startedAt = performance.now();

				try {
					await this.health.check(type, signal);

					if (this.metrics) {
						const durationMs = performance.now() - startedAt;
						this.metrics.recordHealthCheck({
							breakerId: this.id,
							type,
							result: CallResultEnum.SUCCESS,
							durationMs,
						});
					}

					void this.onHealthCheckSuccess(type);
				} catch (err) {
					if (signal.aborted) {
						return;
					}

					if (this.metrics) {
						const durationMs = performance.now() - startedAt;
						this.metrics.recordHealthCheck({
							breakerId: this.id,
							type,
							result: CallResultEnum.FAILURE,
							durationMs,
						});
					}

					this.handleError(`Failed to perform ${type} health check`, err);

					void this.onHealthCheckFailure(type);
				}
			},
		});
	}

	protected override async startInternal(): Promise<void> {
		await Promise.all([
			this.callResultStore.start(),
			this.circuitStateStore.start(),
		]);

		await this.elector.start();
	}

	protected override async stopInternal(): Promise<void> {
		await Promise.all([
			this.callResultStore.stop(),
			this.circuitStateStore.stop(),
			this.elector.stop(),
			this.stopHealthChecks(),
		]);
	}

	get role(): CircuitRoleEnum {
		return this.elector.isLeader
			? CircuitRoleEnum.LEADER
			: CircuitRoleEnum.FOLLOWER;
	}

	get state(): CircuitStateEnum {
		return this.circuitStateStore.getState();
	}

	private async onHealthCheckSuccess(type: HealthCheckTypeEnum) {
		if (!this.elector.isLeader) {
			return;
		}

		if (type === HealthCheckTypeEnum.RECOVERY) {
			await this.circuitStateStore.setState(CircuitStateEnum.CLOSED);
			await this.rescheduleIdleHealthChecks();
		}
	}

	private async onHealthCheckFailure(type: HealthCheckTypeEnum) {
		if (!this.elector.isLeader) {
			return;
		}

		if (type === HealthCheckTypeEnum.IDLE) {
			await this.circuitStateStore.setState(CircuitStateEnum.OPEN);
			await this.runRecoveryHealthChecks();
		}
	}

	private async stopHealthChecks(): Promise<void> {
		await this.healthCheckManager.stop();
	}

	private async runRecoveryHealthChecks(): Promise<void> {
		if (!this.elector.isLeader) {
			return;
		}

		await this.healthCheckManager.restart({
			type: HealthCheckTypeEnum.RECOVERY,
			getDelayMs: (attempt) => this.health.backoff.getDelayMs(attempt),
		});
	}

	private async rescheduleIdleHealthChecks(): Promise<void> {
		if (!this.health.idleProbeIntervalMs || !this.elector.isLeader) {
			return;
		}

		const lastEventTimestamp = this.callResultStore
			.getEvents()
			.at(-1)?.timestamp;
		const initialExecutionStartMs = lastEventTimestamp
			? lastEventTimestamp + this.health.idleProbeIntervalMs
			: 0;

		await this.healthCheckManager.restart({
			type: HealthCheckTypeEnum.IDLE,
			getDelayMs: (attempt) => {
				if (attempt === 1) {
					return Math.max(0, initialExecutionStartMs - Date.now());
				}
				return this.health.idleProbeIntervalMs ?? Infinity;
			},
		});
	}

	private handleEventsAdded = async (events: CallResultEvent[]) => {
		if (!this.elector.isLeader || this.state === CircuitStateEnum.OPEN) {
			return;
		}

		// Filter out events that occurred before the last state change
		// This prevents historical failures from causing repeated circuit opens after successful recovery
		const lastStateChangeTimestamp =
			this.circuitStateStore.getLastStateChangeTimestamp();
		const recentEvents = events.filter(
			(event) => event.timestamp >= lastStateChangeTimestamp,
		);

		if (this.shouldOpenCircuit(recentEvents)) {
			await this.circuitStateStore.setState(CircuitStateEnum.OPEN);
			await this.runRecoveryHealthChecks();
		} else if (this.health.idleProbeIntervalMs) {
			await this.rescheduleIdleHealthChecks();
		}
	};

	private async recordCallResult(
		callResult: CallResultEnum,
		callStartedAtMs: number,
	) {
		const durationMs = performance.now() - callStartedAtMs;

		this.metrics?.recordCall({
			breakerId: this.id,
			result: callResult,
			durationMs,
		});

		await this.callResultStore.storeCallResult(callResult);
	}

	async execute<T>(fn: () => Promise<T>): Promise<T> {
		if (this.state === CircuitStateEnum.OPEN) {
			this.metrics?.recordBlockedRequest({ breakerId: this.id });

			throw new CircuitOpenError(this.id);
		}

		const startedAt = performance.now();

		try {
			const result = await fn();

			void this.recordCallResult(CallResultEnum.SUCCESS, startedAt);

			return result;
		} catch (err) {
			void this.recordCallResult(CallResultEnum.FAILURE, startedAt);

			throw err;
		}
	}

	private shouldOpenCircuit(events: CallResultEvent[]): boolean {
		if (events.length === 0) {
			return false;
		}

		return this.breaker.shouldOpenCircuit(events);
	}

	private handleError(message: string, cause: unknown): void {
		const err = new Error(message, { cause });

		if (!this.onError) {
			throw err;
		}
		this.onError(err);
	}
}
