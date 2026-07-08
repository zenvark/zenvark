---
"zenvark": minor
"@zenvark/prom": minor
---

Add `AdaptiveSemaphore` to zenvark core — an adaptive distributed semaphore coordinated via Redis, with AIMD capacity control, priority classes and crash-safe leases — plus optional `CircuitBreaker` integration (`semaphore` constructor option and `execute(fn, { lease })`) that gates protected calls through the semaphore without changing breaker accounting, and `PrometheusSemaphoreMetrics` in `@zenvark/prom` for its observability.
