import { describe, expect, it, vi } from 'vitest';
import { redis } from '../test/setup-redis.ts';
import { ConstantBackoff } from './backoffs/constant-backoff.ts';
import { ConsecutiveBreaker } from './breakers/consecutive-breaker.ts';
import { CircuitBreaker } from './circuit-breaker.ts';
import {
	CircuitRoleEnum,
	CircuitStateEnum,
	type HealthCheckTypeEnum,
} from './constants.ts';
import { CircuitOpenError } from './errors/circuit-open-error.ts';
import { delay } from './utils/delay.ts';

describe('CircuitBreaker', () => {
	const createCircuit = async ({
		threshold = 3,
		check = () => Promise.resolve(),
		idleProbeIntervalMs,
		onRoleChange,
		onStateChange,
	}: {
		threshold?: number;
		check?: (type: HealthCheckTypeEnum, signal: AbortSignal) => Promise<void>;
		idleProbeIntervalMs?: number;
		onRoleChange?: (role: CircuitRoleEnum) => void;
		onStateChange?: (state: CircuitStateEnum) => void;
	} = {}) => {
		const circuit = new CircuitBreaker({
			id: 'test',
			redis,
			breaker: new ConsecutiveBreaker({ threshold }),
			health: {
				backoff: new ConstantBackoff({ delayMs: 50 }),
				check,
				idleProbeIntervalMs,
			},
			onError: vi.fn(),
			onRoleChange,
			onStateChange,
		});

		await circuit.start();

		return circuit;
	};

	it('start is idempotent - calling twice should not throw', async () => {
		const circuit = await createCircuit();

		await expect(circuit.start()).resolves.not.toThrow();

		await circuit.stop();
	});

	it('stop is idempotent - calling before start should not throw', async () => {
		const circuit = new CircuitBreaker({
			id: 'test',
			redis,
			breaker: new ConsecutiveBreaker({ threshold: 1 }),
			health: {
				backoff: new ConstantBackoff({ delayMs: 10 }),
				check: () => Promise.resolve(),
			},
		});

		await expect(circuit.stop()).resolves.not.toThrow();
	});

	it('executes successfully when circuit is closed', async () => {
		const circuit = await createCircuit();

		await circuit.start();

		const result = await circuit.execute(() => Promise.resolve('ok'));

		expect(result).toBe('ok');

		await circuit.stop();
	});

	it('opens circuit across instances when threshold is breached', async () => {
		const [circuitA, circuitB] = await Promise.all([
			createCircuit({ threshold: 2, check: () => Promise.reject() }),
			createCircuit({ threshold: 2, check: () => Promise.reject() }),
		]);

		await Promise.all([circuitA.start(), circuitB.start()]);

		await expect(
			circuitA.execute(() => Promise.reject('fail')),
		).rejects.toThrow();
		await expect(
			circuitA.execute(() => Promise.reject('fail')),
		).rejects.toThrow();

		await vi.waitUntil(
			() =>
				circuitA.state === CircuitStateEnum.OPEN &&
				circuitB.state === CircuitStateEnum.OPEN,
		);

		await expect(
			circuitA.execute(() => Promise.resolve('blocked')),
		).rejects.toBeInstanceOf(CircuitOpenError);
		await expect(
			circuitB.execute(() => Promise.resolve('blocked')),
		).rejects.toBeInstanceOf(CircuitOpenError);

		await Promise.all([circuitA.stop(), circuitB.stop()]);
	});

	it('recovers circuit after health check succeeds', async () => {
		let healthcheckCalled = 0;

		const circuit = await createCircuit({
			threshold: 1,
			async check() {
				healthcheckCalled++;

				await delay(2);

				if (healthcheckCalled < 1) {
					throw new Error('still broken');
				}
			},
		});

		await circuit.start();

		await expect(circuit.execute(() => Promise.reject())).rejects.toThrow();

		await vi.waitUntil(() => circuit.state === CircuitStateEnum.OPEN, {
			interval: 1,
		});

		await expect(
			circuit.execute(() => Promise.resolve('blocked')),
		).rejects.toBeInstanceOf(CircuitOpenError);

		await vi.waitUntil(() => circuit.state === CircuitStateEnum.CLOSED);

		const result = await circuit.execute(() => Promise.resolve('ok again'));
		expect(result).toBe('ok again');

		await circuit.stop();
	});

	it('runs idle healthcheck and opens circuit on failure, then closes on subsequent loop success', async () => {
		const check = vi
			.fn()
			.mockImplementationOnce(async () => {
				await delay(2);
				throw new Error('idle fail');
			})
			.mockImplementationOnce(async () => {
				await delay(2);
			});

		const circuit = await createCircuit({
			threshold: 1000,
			check,
			idleProbeIntervalMs: 30,
		});

		await circuit.start();

		// No calls -> idle triggers
		await vi.waitUntil(() => circuit.state === CircuitStateEnum.OPEN, {
			interval: 1,
		});

		await vi.waitUntil(() => circuit.state === CircuitStateEnum.CLOSED);

		await circuit.stop();
	});

	it('invokes onStateChange when circuit opens and then closes (recovery)', async () => {
		const onStateChange = vi.fn();

		const circuit = await createCircuit({
			threshold: 1,
			check: async () => await delay(2),
			onStateChange,
		});

		await circuit.start();

		await expect(
			circuit.execute(() => Promise.reject('fail')),
		).rejects.toThrow();

		await vi.waitUntil(() => circuit.state === CircuitStateEnum.OPEN, {
			interval: 1,
		});

		await vi.waitUntil(() =>
			onStateChange.mock.calls.some(
				(args) => args[0] === CircuitStateEnum.OPEN,
			),
		);

		await vi.waitUntil(() => circuit.state === CircuitStateEnum.CLOSED);

		await vi.waitUntil(() =>
			onStateChange.mock.calls.some(
				(args) => args[0] === CircuitStateEnum.CLOSED,
			),
		);

		await circuit.stop();
	});

	it('reports role transitions via getter and invokes onRoleChange', async () => {
		const onRoleChange = vi.fn();

		const circuit = await createCircuit({ onRoleChange });

		await circuit.start();

		const waitForRole = async (role: CircuitRoleEnum) => {
			await vi.waitUntil(() => circuit.role === role, { interval: 1 });
			expect(onRoleChange).toHaveBeenLastCalledWith(role);
		};

		await waitForRole(CircuitRoleEnum.LEADER);

		await circuit.stop();

		await waitForRole(CircuitRoleEnum.FOLLOWER);
	});

	it('filters out historical failures after successful recovery', async () => {
		const circuit = await createCircuit({
			threshold: 2,
			check: async () => await delay(2),
		});

		await circuit.start();

		await expect(circuit.execute(() => Promise.reject())).rejects.toThrow();
		await expect(circuit.execute(() => Promise.reject())).rejects.toThrow();

		// Wait for circuit to open
		await vi.waitUntil(() => circuit.state === CircuitStateEnum.OPEN, {
			interval: 1,
		});

		// Wait for recovery health check to succeed and circuit to close
		await vi.waitUntil(() => circuit.state === CircuitStateEnum.CLOSED, {
			interval: 1,
		});

		// New failed request after recovery should not open the circuit
		// because historical failures are filtered out
		await expect(circuit.execute(() => Promise.reject())).rejects.toThrow();
		await delay(10);
		expect(circuit.state).toBe(CircuitStateEnum.CLOSED);

		// Second failed request should open the circuit again (threshold: 2)
		await expect(circuit.execute(() => Promise.reject())).rejects.toThrow();
		await vi.waitUntil(() => circuit.state === CircuitStateEnum.OPEN, {
			interval: 1,
		});

		await circuit.stop();
	});
});
