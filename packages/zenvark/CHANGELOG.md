# zenvark

## 3.0.0

### Major Changes

- 164bb7f: Drop the `@lokalise/node-core` runtime dependency. All error classes now extend a local, exported `ZenvarkError` base class with `code`, `details`, and `cause` fields.

  Breaking changes for consumers:
  - The `errorCode` field on thrown errors is renamed to `code`.
  - `instanceof InternalError` checks from `@lokalise/node-core` no longer match zenvark errors; use `instanceof ZenvarkError` or the concrete error classes instead.

- 164bb7f: Move `ioredis` from `dependencies` to `peerDependencies` with range `^5.0.0 || ^6.0.0`. zenvark only uses ioredis types and operates on the `Redis` instance you pass in, so the client you already depend on is the one that should be resolved. Consumers must now declare `ioredis` in their own `package.json`.

  zenvark's test suite runs against ioredis 6, and its types accept both the default and `resp3` reply-mapping clients. `redis-semaphore` is bumped to 5.8.0, which also accepts ioredis 6, so no peer conflicts remain.

### Minor Changes

- 164bb7f: Add a static `isInstance()` type guard to every error class (for example `CircuitOpenError.isInstance(err)`) and `ZenvarkError.isZenvarkError(err)` for matching any zenvark error. The guards check a shared `Symbol.for` brand plus the error `code`, so they keep working when the prototype chain cannot be trusted, such as with duplicate copies of zenvark in `node_modules` or errors crossing realms. `instanceof` keeps working for the single-copy case.

  Error codes are literal-typed per class and exposed as a static property, for example `CircuitOpenError.code`. After an `isInstance()` check, `err.code` and `err.details` are typed to that class.

### Patch Changes

- 164bb7f: Build with TypeScript 7 and test with Vitest 5. The shared `@lokalise/tsconfig` preset is updated to 5.0.0, which sets `rootDir` explicitly for the new TypeScript 7 defaults. Emitted JavaScript and declaration files are unchanged in layout; no runtime behaviour changes.

## 2.0.0

## 1.3.0

### Minor Changes

- c7bd976: Add `AdaptiveSemaphore` to zenvark core — an adaptive distributed semaphore coordinated via Redis, with AIMD capacity control, priority classes and crash-safe leases — plus optional `CircuitBreaker` integration (`semaphore` constructor option and `execute(fn, { lease })`) that gates protected calls through the semaphore without changing breaker accounting, and `PrometheusSemaphoreMetrics` in `@zenvark/prom` for its observability.

### Patch Changes

- c7bd976: Bump redis-semaphore to ^5.7.0 (adds AbortSignal support on acquire, required by the new `AdaptiveSemaphore`).

## 1.2.0

### Minor Changes

- 28de14c: Add Prometheus circuit state gauge metric

## 1.1.1

### Patch Changes

- 77054f5: Log internal errors to console.error by default instead of throwing

## 1.1.0

### Minor Changes

- 4b0f059: use duplicated redis connection for circuit

## 1.0.4

### Patch Changes

- 2855e72: call onError for stream write errors instead of throwing them

## 1.0.3

### Patch Changes

- 3382c42: fix redis key naming

## 1.0.2

### Patch Changes

- 9999866: adjust package json config

## 1.0.1

### Patch Changes

- f90a2ba: use space as indent style

## 1.0.0

### Major Changes

- 62282fd: Initial release
