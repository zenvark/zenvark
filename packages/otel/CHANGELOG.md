# @zenvark/otel

## 3.1.0

### Minor Changes

- 56a3224: Add telemetry integrations for circuit breakers and adaptive semaphores. `registerZenvarkTelemetry()` registers integrations for every instance, and the new `telemetry` option of `CircuitBreaker` and `AdaptiveSemaphore` overrides them per instance (`integrations`) or turns them off (`isEnabled: false`). `zenvark` itself does not depend on any telemetry library.

  - `@zenvark/prom` adds `ZenvarkProm`, an integration that reports the same Prometheus metrics as `PrometheusBreakerMetrics` and `PrometheusSemaphoreMetrics`.
  - The new `@zenvark/otel` package provides `ZenvarkOtel`, an integration that emits OpenTelemetry spans for breaker calls, blocked calls, health checks, state changes and semaphore acquires. It requires Node.js 24 or later.

  Deprecated: the `metrics` option of `CircuitBreaker` and `AdaptiveSemaphore`, `BreakerMetricsRecorder`, `SemaphoreMetricsRecorder`, `PrometheusBreakerMetrics` and `PrometheusSemaphoreMetrics`. They keep working until the next major version; register `ZenvarkProm` instead.
