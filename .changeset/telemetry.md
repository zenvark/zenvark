---
"zenvark": minor
"@zenvark/otel": minor
---

Add telemetry integrations. `registerTelemetry()` registers integrations for every circuit breaker, and the new `telemetry` option overrides them per breaker (`integrations`) or turns them off (`isEnabled: false`). The new `@zenvark/otel` package provides a `ZenvarkOtel` integration that emits spans for breaker calls, blocked calls, health checks and state changes. `zenvark` itself does not depend on OpenTelemetry.
