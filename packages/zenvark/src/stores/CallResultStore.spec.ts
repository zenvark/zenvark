import { describe, expect, it, vi } from 'vitest';
import { redis } from '../../test/setupRedis.ts';
import { CallResultEnum } from '../constants.ts';
import { CallResultStore } from './CallResultStore.ts';

describe('CallResultStore', () => {
	it('start is idempotent - calling twice should not throw', async () => {
		const store = new CallResultStore({
			redis,
			redisStreamKey: 'test-stream',
			maxLen: 1000,
			onStreamReadError: vi.fn(),
			onEventsAdded: vi.fn(),
		});

		await store.start();
		await expect(store.start()).resolves.not.toThrow();

		await store.stop();
	});

	it('stop is idempotent - calling before start should not throw', async () => {
		const store = new CallResultStore({
			redis,
			redisStreamKey: 'test-stream',
			maxLen: 1000,
			onStreamReadError: vi.fn(),
			onEventsAdded: vi.fn(),
		});

		await expect(store.stop()).resolves.not.toThrow();
	});

	it('should append call results to the redis stream', async () => {
		const store = new CallResultStore({
			redis,
			redisStreamKey: 'test',
			maxLen: 1000,
			onStreamReadError: vi.fn(),
			onEventsAdded: vi.fn(),
		});

		await store.storeCallResult(CallResultEnum.SUCCESS);
		await store.storeCallResult(CallResultEnum.FAILURE);

		const elements = await redis.xrange('test', '-', '+');

		expect(elements).toHaveLength(2);

		expect(elements).toEqual([
			[
				expect.any(String),
				[
					'callResult',
					CallResultEnum.SUCCESS,
					'timestamp',
					expect.stringMatching(/^\d+$/),
				],
			],
			[
				expect.any(String),
				[
					'callResult',
					CallResultEnum.FAILURE,
					'timestamp',
					expect.stringMatching(/^\d+$/),
				],
			],
		]);
	});

	it('should load existing events on start', async () => {
		const onEventsAddedSpy = vi.fn();

		const store = new CallResultStore({
			redis,
			redisStreamKey: 'test',
			maxLen: 1000,
			onStreamReadError: vi.fn(),
			onEventsAdded: onEventsAddedSpy,
		});

		await store.storeCallResult(CallResultEnum.SUCCESS);
		await store.storeCallResult(CallResultEnum.FAILURE);

		await store.start();

		expect(store.getEvents()).toEqual([
			expect.objectContaining({ callResult: CallResultEnum.SUCCESS }),
			expect.objectContaining({ callResult: CallResultEnum.FAILURE }),
		]);

		await store.stop();
	});

	it('should notify both store1 and store2 when new events are added', async () => {
		const onEventsAddedSpy1 = vi.fn();
		const onEventsAddedSpy2 = vi.fn();

		const store1 = new CallResultStore({
			redis,
			redisStreamKey: 'test',
			maxLen: 1000,
			onStreamReadError: vi.fn(),
			onEventsAdded: onEventsAddedSpy1,
		});

		const store2 = new CallResultStore({
			redis,
			redisStreamKey: 'test',
			maxLen: 1000,
			onStreamReadError: vi.fn(),
			onEventsAdded: onEventsAddedSpy2,
		});

		await Promise.all([store1.start(), store2.start()]);

		await Promise.all([
			store1.storeCallResult(CallResultEnum.SUCCESS),
			store2.storeCallResult(CallResultEnum.FAILURE),
		]);

		await vi.waitUntil(
			() =>
				onEventsAddedSpy1.mock.calls.length > 0 &&
				onEventsAddedSpy2.mock.calls.length > 0,
		);

		const expectedEvents = expect.arrayContaining([
			expect.objectContaining({ callResult: CallResultEnum.SUCCESS }),
			expect.objectContaining({ callResult: CallResultEnum.FAILURE }),
		]);

		expect(onEventsAddedSpy1).toHaveBeenCalledWith(expectedEvents);
		expect(onEventsAddedSpy2).toHaveBeenCalledWith(expectedEvents);

		await Promise.all([store1.stop(), store2.stop()]);
	});

	it('should enforce maxLen limit', async () => {
		const onEventsAddedSpy = vi.fn();

		const store = new CallResultStore({
			redis,
			redisStreamKey: 'test-maxlen',
			maxLen: 3,
			onStreamReadError: vi.fn(),
			onEventsAdded: onEventsAddedSpy,
		});

		await store.start();

		await Promise.all([
			store.storeCallResult(CallResultEnum.SUCCESS),
			store.storeCallResult(CallResultEnum.SUCCESS),
			store.storeCallResult(CallResultEnum.SUCCESS),
			store.storeCallResult(CallResultEnum.SUCCESS),
			store.storeCallResult(CallResultEnum.SUCCESS),
		]);

		await vi.waitUntil(() => onEventsAddedSpy.mock.calls.length > 0);

		expect(onEventsAddedSpy).toHaveBeenCalledWith([
			expect.objectContaining({ callResult: CallResultEnum.SUCCESS }),
			expect.objectContaining({ callResult: CallResultEnum.SUCCESS }),
			expect.objectContaining({ callResult: CallResultEnum.SUCCESS }),
		]);

		await store.stop();
	});

	it('should listen for events after restart', async () => {
		const onEventsAddedSpy = vi.fn();

		const store = new CallResultStore({
			redis,
			redisStreamKey: 'test-restart',
			maxLen: 3,
			onStreamReadError: vi.fn(),
			onEventsAdded: onEventsAddedSpy,
		});

		await store.start();
		await store.stop();
		await store.start();

		await store.storeCallResult(CallResultEnum.SUCCESS);

		await vi.waitUntil(() => onEventsAddedSpy.mock.calls.length > 0);

		await store.stop();
	});
});
