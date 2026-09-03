# @zenvark/prom

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
