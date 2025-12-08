import type { Redis } from 'ioredis';
import { CircuitState } from '../constants.ts';
import { AbstractLifecycleManager } from '../utils/abstract-lifecycle-manager.ts';
import { RedisStreamReader } from '../utils/redis-stream-reader.ts';

type CircuitStateEvent = {
  id: string;
  state: CircuitState;
  timestamp: number;
};

type CircuitStateStoreOptions = {
  /** Redis client used for storing and reading stream data */
  redis: Redis;
  /** Stream key identifying the circuit's state event log */
  redisStreamKey: string;
  /** Called when an error occurs while reading from the Redis stream */
  onStreamReadError: (err: unknown) => void;
  /** Called whenever the state changes to a new value. Not called during initial load. */
  onStateChange?: (state: CircuitState) => void;
};

export class CircuitStateStore extends AbstractLifecycleManager {
  private readonly redis: Redis;
  private readonly redisStreamKey: string;
  private readonly streamReader: RedisStreamReader;
  private readonly onStateChange?: (state: CircuitState) => void;

  private currentState: CircuitStateEvent = {
    id: '0',
    state: CircuitState.CLOSED,
    timestamp: 0,
  };

  constructor(options: CircuitStateStoreOptions) {
    super();
    this.redis = options.redis;
    this.redisStreamKey = options.redisStreamKey;
    this.onStateChange = options.onStateChange;

    this.streamReader = new RedisStreamReader({
      redis: this.redis,
      streamKey: this.redisStreamKey,
      getLastId: () => this.currentState.id,
      onEntries: (entries) => {
        const entry = entries.at(-1);
        if (!entry) {
          return;
        }

        const prev = this.getState();
        this.currentState = this.mapEntryToStateEvent(entry);
        const next = this.getState();

        if (prev !== next) {
          this.onStateChange?.(next);
        }
      },
      onError: options.onStreamReadError,
    });
  }

  /**
   * Starts the store by loading the latest state from Redis and listening for changes.
   */
  protected override async startInternal(): Promise<void> {
    await this.loadLatestState();
    await this.streamReader.start();
  }

  /**
   * Stops listening for changes.
   */
  protected override async stopInternal(): Promise<void> {
    await this.streamReader.stop();
  }

  async setState(state: CircuitState): Promise<void> {
    await this.redis.xadd(
      this.redisStreamKey,
      'MAXLEN',
      '~',
      10,
      '*',
      'state',
      state,
      'timestamp',
      Date.now().toString(),
    );
  }

  /**
   * Returns the current state of the circuit.
   */
  getState(): CircuitState {
    return this.currentState.state;
  }

  /**
   * Returns the Unix timestamp (in milliseconds) of the latest circuit state transition.
   * Returns 0 if the circuit has never transitioned from its initial state.
   */
  getLastStateChangeTimestamp(): number {
    return this.currentState.timestamp;
  }

  private mapEntryToStateEvent(entry: [string, string[]]): CircuitStateEvent {
    const [id, fields] = entry;

    return {
      id,
      state: fields[1] as CircuitState,
      timestamp: Number(fields[3]),
    };
  }

  private async loadLatestState(): Promise<void> {
    const entries = await this.redis.xrevrange(
      this.redisStreamKey,
      '+',
      '-',
      'COUNT',
      1,
    );

    const firstEntry = entries.at(0);

    if (firstEntry) {
      this.currentState = this.mapEntryToStateEvent(firstEntry);
    }
  }
}
