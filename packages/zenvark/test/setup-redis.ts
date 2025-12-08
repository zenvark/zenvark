import { Redis } from 'ioredis';
import { afterAll, beforeEach } from 'vitest';

export const redis = new Redis({
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
});

beforeEach(async () => {
  await redis.flushall();
});

afterAll(async () => {
  await redis.quit();
});
