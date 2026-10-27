# @zenvark/prom

## 3.1.0

### Minor Changes

- 56a3224: Add telemetry integrations for circuit breakers and adaptive semaphores. `registerZenvarkTelemetry()` registers integrations for every instance, and the new `telemetry` option of `CircuitBreaker` and `AdaptiveSemaphore` overrides them per instance (`integrations`) or turns them off (`isEnabled: false`). `zenvark` itself does not depend on any telemetry library.

  - `@zenvark/prom` adds `ZenvarkProm`, an integration that reports the same Prometheus metrics as `PrometheusBreakerMetrics` and `PrometheusSemaphoreMetrics`.
  - The new `@zenvark/otel` package provides `ZenvarkOtel`, an integration that emits OpenTelemetry spans for breaker calls, blocked calls, health checks, state changes and semaphore acquires. It requires Node.js 24 or later.

  Deprecated: the `metrics` option of `CircuitBreaker` and `AdaptiveSemaphore`, `BreakerMetricsRecorder`, `SemaphoreMetricsRecorder`, `PrometheusBreakerMetrics` and `PrometheusSemaphoreMetrics`. They keep working until the next major version; register `ZenvarkProm` instead.

## 3.0.0

### Patch Changes

- 164bb7f: Build with TypeScript 7 and test with Vitest 5. The shared `@lokalise/tsconfig` preset is updated to 5.0.0, which sets `rootDir` explicitly for the new TypeScript 7 defaults. Emitted JavaScript and declaration files are unchanged in layout; no runtime behaviour changes.
- Updated dependencies [164bb7f]
  - zenvark@3.0.0

## 2.0.0

### Major Changes

- 540bdbc: Migrate `@zenvark/prom` from `prom-client` to `@prometheus-io/client`, the package's new official home under the Prometheus org. Consumers must replace their `prom-client` dependency with `@prometheus-io/client` (same API surface — `Registry`, `Counter`, `Gauge`, `Histogram` — so no code changes are required beyond swapping the package).

### Patch Changes

- zenvark@2.0.0

## 1.3.0

### Minor Changes

- c7bd976: Add `AdaptiveSemaphore` to zenvark core — an adaptive distributed semaphore coordinated via Redis, with AIMD capacity control, priority classes and crash-safe leases — plus optional `CircuitBreaker` integration (`semaphore` constructor option and `execute(fn, { lease })`) that gates protected calls through the semaphore without changing breaker accounting, and `PrometheusSemaphoreMetrics` in `@zenvark/prom` for its observability.

## 1.2.0

### Minor Changes

- 28de14c: Add Prometheus circuit state gauge metric

## 1.1.1

## 1.1.0

## 1.0.4

## 1.0.3

## 1.0.2

### Patch Changes

- 9999866: adjust package json config

## 1.0.1

### Patch Changes

- f90a2ba: use space as indent style

## 1.0.0

### Major Changes

- 62282fd: Initial release

### Patch Changes

- Updated dependencies [62282fd]
  - zenvark@1.0.0
