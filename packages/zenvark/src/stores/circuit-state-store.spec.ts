import { describe, expect, it, vi } from 'vitest';
import { redis } from '../../test/setup-redis.ts';
import { CircuitStateEnum } from '../constants.ts';
import { CircuitStateStore } from './circuit-state-store.ts';

describe('CircuitStateStore', () => {
	it('start is idempotent - calling twice should not throw', async () => {
		const store = new CircuitStateStore({
			redis,
			redisStreamKey: 'test-circuit',
			onStreamReadError: vi.fn(),
		});

		await store.start();
		await expect(store.start()).resolves.not.toThrow();
		await store.stop();
	});

	it('stop is idempotent - calling before start should not throw', async () => {
		const store = new CircuitStateStore({
			redis,
			redisStreamKey: 'test-circuit',
			onStreamReadError: vi.fn(),
		});

		await expect(store.stop()).resolves.not.toThrow();
	});

	it('should write state updates to the Redis stream', async () => {
		const store = new CircuitStateStore({
			redis,
			redisStreamKey: 'test-circuit-stream',
			onStreamReadError: vi.fn(),
		});

		await store.setState(CircuitStateEnum.OPEN);
		await store.setState(CircuitStateEnum.CLOSED);

		const entries = await redis.xrange('test-circuit-stream', '-', '+');

		expect(entries).toHaveLength(2);

		expect(entries).toEqual([
			[
				expect.any(String),
				[
					'state',
					CircuitStateEnum.OPEN,
					'timestamp',
					expect.stringMatching(/^\d+$/),
				],
			],
			[
				expect.any(String),
				[
					'state',
					CircuitStateEnum.CLOSED,
					'timestamp',
					expect.stringMatching(/^\d+$/),
				],
			],
		]);
	});

	it('should load the latest existing state on start', async () => {
		const redisStreamKey = 'test-circuit-init';
		await redis.xadd(
			redisStreamKey,
			'*',
			'state',
			CircuitStateEnum.OPEN,
			'timestamp',
			Date.now().toString(),
		);

		const store = new CircuitStateStore({
			redis,
			redisStreamKey,
			onStreamReadError: vi.fn(),
		});

		await store.start();

		expect(store.getState()).toBe(CircuitStateEnum.OPEN);

		await store.stop();
	});

	it('should default to CLOSED if no state exists', async () => {
		const store = new CircuitStateStore({
			redis,
			redisStreamKey: 'test-default-state',
			onStreamReadError: vi.fn(),
		});

		await store.start();

		expect(store.getState()).toBe(CircuitStateEnum.CLOSED);

		await store.stop();
	});

	it('should update the current state when a new event is written', async () => {
		const redisStreamKey = 'test-circuit-update';

		const onStateChange1 = vi.fn();

		const store1 = new CircuitStateStore({
			redis,
			redisStreamKey,
			onStreamReadError: vi.fn(),
			onStateChange: onStateChange1,
		});

		const onStateChange2 = vi.fn();

		const store2 = new CircuitStateStore({
			redis,
			redisStreamKey,
			onStreamReadError: vi.fn(),
			onStateChange: onStateChange2,
		});

		await Promise.all([store1.start(), store2.start()]);

		await store1.setState(CircuitStateEnum.OPEN);

		await vi.waitUntil(
			() => onStateChange1.mock.calls[0]?.[0] === CircuitStateEnum.OPEN,
		);
		await vi.waitUntil(
			() => onStateChange2.mock.calls[0]?.[0] === CircuitStateEnum.OPEN,
		);
		await vi.waitUntil(() => store1.getState() === CircuitStateEnum.OPEN);
		await vi.waitUntil(() => store2.getState() === CircuitStateEnum.OPEN);

		await Promise.all([store1.stop(), store2.stop()]);
	});

	it('should listen for events after restart', async () => {
		const onStateChange = vi.fn();

		const store = new CircuitStateStore({
			redis,
			redisStreamKey: 'test-restart',
			onStreamReadError: vi.fn(),
			onStateChange,
		});

		await store.start();
		await store.stop();
		await store.start();

		await store.setState(CircuitStateEnum.OPEN);

		await vi.waitUntil(() => onStateChange.mock.calls.length > 0);

		await store.stop();
	});

	it('should return 0 as timestamp for initial state', () => {
		const store = new CircuitStateStore({
			redis,
			redisStreamKey: 'test-initial-timestamp',
			onStreamReadError: vi.fn(),
		});

		expect(store.getLastStateChangeTimestamp()).toBe(0);
	});

	it('should load timestamp from existing state on start', async () => {
		const redisStreamKey = 'test-load-timestamp';
		const expectedTimestamp = Date.now() - 1000;

		await redis.xadd(
			redisStreamKey,
			'*',
			'state',
			CircuitStateEnum.OPEN,
			'timestamp',
			expectedTimestamp.toString(),
		);

		const store = new CircuitStateStore({
			redis,
			redisStreamKey,
			onStreamReadError: vi.fn(),
		});

		await store.start();

		expect(store.getState()).toBe(CircuitStateEnum.OPEN);
		expect(store.getLastStateChangeTimestamp()).toBe(expectedTimestamp);

		await store.stop();
	});

	it('should return timestamp when state changes', async () => {
		const redisStreamKey = 'test-timestamp-change';
		const beforeTimestamp = Date.now();

		const store = new CircuitStateStore({
			redis,
			redisStreamKey,
			onStreamReadError: vi.fn(),
		});

		await store.start();
		await store.setState(CircuitStateEnum.OPEN);

		await vi.waitUntil(() => store.getState() === CircuitStateEnum.OPEN);

		const afterTimestamp = Date.now();
		const stateTimestamp = store.getLastStateChangeTimestamp();

		expect(stateTimestamp).toBeGreaterThanOrEqual(beforeTimestamp);
		expect(stateTimestamp).toBeLessThanOrEqual(afterTimestamp);

		await store.stop();
	});
});
