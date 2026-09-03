# zenvark

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
