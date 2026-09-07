---
"zenvark": major
---

Move `ioredis` from `dependencies` to `peerDependencies` with range `^5.0.0 || ^6.0.0`. zenvark only uses ioredis types and operates on the `Redis` instance you pass in, so the client you already depend on is the one that should be resolved. Consumers must now declare `ioredis` in their own `package.json`.

zenvark's test suite runs against ioredis 6, and its types accept both the default and `resp3` reply-mapping clients. Note that `redis-semaphore`, a zenvark dependency, still declares `ioredis@^4.1.0 || ^5` as its peer, so npm users on ioredis 6 will see a peer conflict until `redis-semaphore` widens its range. Install with `--legacy-peer-deps` in the meantime, or stay on ioredis 5.
