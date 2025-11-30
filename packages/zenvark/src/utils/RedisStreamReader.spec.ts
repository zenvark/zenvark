import { describe, it, vi } from 'vitest';
import { redis } from '../../test/setupRedis.ts';
import { RedisStreamReader } from './RedisStreamReader.ts';

describe('RedisStreamReader', () => {
  it('reads new entries and forwards them to onEntries', async () => {
    const streamKey = 'stream:new-entries';

    const loadedEntries: [string, string[]][] = [];

    const reader = new RedisStreamReader({
      redis,
      streamKey,
      getLastId: () => {
        const lastEntry = loadedEntries.at(-1);

        return lastEntry ? lastEntry[0] : '0';
      },
      onEntries: (entries) => {
        loadedEntries.push(...entries);
      },
      onError: vi.fn(),
    });

    await reader.start();

    await redis.xadd(streamKey, '*', 'k', 'v1');
    await redis.xadd(streamKey, '*', 'k', 'v2');

    await vi.waitUntil(() => loadedEntries.length === 2);

    await reader.stop();
  });
});
