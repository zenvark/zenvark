---
"zenvark": major
---

Move `ioredis` from `dependencies` to `peerDependencies` with range `^5.0.0 || ^6.0.0`. zenvark only uses ioredis types and operates on the `Redis` instance you pass in, so the client you already depend on is the one that should be resolved. Consumers must now declare `ioredis` in their own `package.json`.

zenvark's test suite runs against ioredis 6, and its types accept both the default and `resp3` reply-mapping clients. `redis-semaphore` is bumped to 5.8.0, which also accepts ioredis 6, so no peer conflicts remain.
