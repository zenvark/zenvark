import type { Redis } from 'ioredis';
import { AbstractLifecycleManager } from './AbstractLifecycleManager.ts';
import { delay } from './delay.ts';

const XREAD_BLOCK_TIMEOUT_MS = 1000;
const ERROR_RETRY_DELAY_MS = 500;

type RedisStreamReaderOptions = {
	/** Base Redis client to duplicate for the dedicated listener connection */
	redis: Redis;
	/** Stream key to read from */
	streamKey: string;
	/** Function returning the last seen id; used to resume reads without duplicates */
	getLastId: () => string;
	/** Called with newly read raw entries (array of [id, fields]) */
	onEntries: (entries: [string, string[]][]) => void | Promise<void>;
	/** Called when an error occurs while reading */
	onError: (err: unknown) => void;
};

type ReaderLoop = {
	abortController: AbortController;
	redisListener: Redis;
	promise: Promise<unknown>;
};

/**
 * Helper that encapsulates a robust XREAD BLOCK loop to read from a Redis Stream.
 */
export class RedisStreamReader extends AbstractLifecycleManager {
	private readonly redis: Redis;
	private readonly streamKey: string;
	private readonly getLastId: () => string;
	private readonly onEntries: (
		entries: [string, string[]][],
	) => void | Promise<void>;
	private readonly onError: (err: unknown) => void;

	private readerLoop: ReaderLoop | null = null;

	constructor(options: RedisStreamReaderOptions) {
		super();

		this.redis = options.redis;
		this.streamKey = options.streamKey;
		this.getLastId = options.getLastId;
		this.onEntries = options.onEntries;
		this.onError = options.onError;
	}

	protected override startInternal(): Promise<void> {
		if (this.readerLoop) {
			return Promise.resolve();
		}

		const abortController = new AbortController();
		const redisListener = this.redis.duplicate();

		this.readerLoop = {
			abortController,
			redisListener,
			promise: this.listenLoop(abortController.signal, redisListener),
		};

		return Promise.resolve();
	}

	protected override async stopInternal(): Promise<void> {
		if (!this.readerLoop) {
			return;
		}

		this.readerLoop.abortController.abort();
		this.readerLoop.redisListener.disconnect();
		await this.readerLoop.promise;

		this.readerLoop = null;
	}

	private async listenLoop(
		signal: AbortSignal,
		redisListener: Redis,
	): Promise<void> {
		while (!signal.aborted) {
			try {
				const result = await redisListener.xread(
					'BLOCK',
					XREAD_BLOCK_TIMEOUT_MS,
					'STREAMS',
					this.streamKey,
					this.getLastId(),
				);

				const entries = result?.[0]?.[1];
				if (entries && entries.length > 0) {
					await this.onEntries(entries);
				}
			} catch (err) {
				// If shutdown was initiated, we can assume this error is a side effect
				// of closing the connection and can be safely ignored.
				if (signal.aborted) {
					break;
				}

				this.onError(err);

				await delay(ERROR_RETRY_DELAY_MS, signal);
			}
		}
	}
}
