import type { ObjectValues } from './types.ts';

export const CircuitRoleEnum = {
	LEADER: 'leader',
	FOLLOWER: 'follower',
} as const;
export type CircuitRoleEnum = ObjectValues<typeof CircuitRoleEnum>;

export const CircuitStateEnum = {
	CLOSED: 'closed',
	OPEN: 'open',
} as const;
export type CircuitStateEnum = ObjectValues<typeof CircuitStateEnum>;

export const CallResultEnum = {
	SUCCESS: 'success',
	FAILURE: 'failure',
} as const;
export type CallResultEnum = ObjectValues<typeof CallResultEnum>;

/**
 * Defines the types of health checks performed by the circuit breaker.
 * This helps in logging, metrics, and understanding the context of a health check.
 */
export const HealthCheckTypeEnum = {
	/**
	 * A health check performed when the circuit is OPEN. Its purpose is to
	 * determine if the downstream service has recovered so the circuit can be closed.
	 */
	RECOVERY: 'recovery',

	/**
	 * A proactive health check performed when the circuit is CLOSED but has been
	 * inactive for a period. It detects silent failures during periods of no traffic.
	 */
	IDLE: 'idle',
} as const;
export type HealthCheckTypeEnum = ObjectValues<typeof HealthCheckTypeEnum>;
