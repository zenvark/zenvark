---
"zenvark": minor
"@zenvark/otel": minor
---

Add a `tracing` option to `CircuitBreaker` that takes a `BreakerTracer`, and a new `@zenvark/otel` package whose `OpenTelemetryBreakerTracer` emits OpenTelemetry spans for breaker calls, blocked calls, health checks and state changes. `zenvark` itself does not depend on OpenTelemetry.
