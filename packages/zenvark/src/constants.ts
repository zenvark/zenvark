import type { ObjectValues } from './types.ts';

export const CircuitRole = {
	LEADER: 'leader',
	FOLLOWER: 'follower',
} as const;
export type CircuitRole = ObjectValues<typeof CircuitRole>;

export const CircuitState = {
	CLOSED: 'closed',
	OPEN: 'open',
} as const;
export type CircuitState = ObjectValues<typeof CircuitState>;

export const CallResult = {
	SUCCESS: 'success',
	FAILURE: 'failure',
} as const;
export type CallResult = ObjectValues<typeof CallResult>;

/**
 * Defines the types of health checks performed by the circuit breaker.
 * This helps in logging, metrics, and understanding the context of a health check.
 */
export const HealthCheckType = {
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
export type HealthCheckType = ObjectValues<typeof HealthCheckType>;
