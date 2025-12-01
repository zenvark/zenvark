import type { Redis } from 'ioredis';
import type { CallResultEnum } from '../constants.ts';
import type { CallResultEvent } from '../types.ts';
import { AbstractLifecycleManager } from '../utils/AbstractLifecycleManager.ts';
import { RedisStreamReader } from '../utils/RedisStreamReader.ts';

type CallResultStoreOptions = {
	/** Redis client used for storing and reading stream data */
	redis: Redis;
	/** Stream key identifying the circuit's call-result event log */
	redisStreamKey: string;
	/** Maximum number of events to retain in memory and stream */
	maxLen: number;
	/** Called when an error occurs while reading from the Redis stream */
	onStreamReadError: (err: unknown) => void;
	/** Called whenever new events are added. Receives the full list of current events. */
	onEventsAdded: (events: CallResultEvent[]) => void | Promise<void>;
};

export class CallResultStore extends AbstractLifecycleManager {
	private readonly redis: Redis;
	private readonly redisStreamKey: string;
	private readonly streamReader: RedisStreamReader;
	private readonly maxLen: number;
	private readonly onEventsAdded: (
		events: CallResultEvent[],
	) => void | Promise<void>;

	private events: CallResultEvent[] = [];

	constructor(options: CallResultStoreOptions) {
		super();
		this.redis = options.redis;
		this.redisStreamKey = options.redisStreamKey;
		this.maxLen = options.maxLen;
		this.onEventsAdded = options.onEventsAdded;

		this.streamReader = new RedisStreamReader({
			redis: this.redis,
			streamKey: this.redisStreamKey,
			getLastId: () => this.events.at(-1)?.id ?? '0',
			onEntries: (entries) => {
				const events = entries.map(this.mapEntryToCallResultEvent);
				this.pushEvents(events);
			},
			onError: options.onStreamReadError,
		});
	}

	protected override async startInternal(): Promise<void> {
		this.events = await this.getInitialEvents();
		if (this.events.length > 0) {
			this.onEventsAdded(this.events);
		}
		await this.streamReader.start();
	}

	protected override async stopInternal(): Promise<void> {
		await this.streamReader.stop();
		this.events = [];
	}

	private async getInitialEvents(): Promise<CallResultEvent[]> {
		const entries = await this.redis.xrevrange(
			this.redisStreamKey,
			'+',
			'-',
			'COUNT',
			this.maxLen,
		);

		const orderedEntries = entries.toReversed();
		return orderedEntries.map(this.mapEntryToCallResultEvent);
	}

	getEvents(): CallResultEvent[] {
		return this.events;
	}

	async storeCallResult(callResult: CallResultEnum): Promise<void> {
		await this.redis.xadd(
			this.redisStreamKey,
			'MAXLEN',
			'~',
			this.maxLen,
			'*',
			'callResult',
			callResult,
			'timestamp',
			Date.now().toString(),
		);
	}

	private mapEntryToCallResultEvent(
		entry: [string, string[]],
	): CallResultEvent {
		const [id, fields] = entry;

		return {
			id,
			callResult: fields[1] as CallResultEnum,
			timestamp: Number(fields[3]),
		};
	}

	private pushEvents(events: CallResultEvent[]): void {
		this.events.push(...events);

		if (this.events.length > this.maxLen) {
			this.events.splice(0, this.events.length - this.maxLen);
		}

		this.onEventsAdded(this.events);
	}
}
