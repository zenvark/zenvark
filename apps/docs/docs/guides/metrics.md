---
sidebar_position: 4
---

# Metrics & Observability

Circuit breakers and adaptive semaphores report what they do to **telemetry integrations**: Prometheus metrics through `@zenvark/prom`, OpenTelemetry spans through `@zenvark/otel`, or your own. The core `zenvark` package does not depend on any telemetry library.

## Telemetry

Register integrations once at startup. Every circuit breaker and semaphore in the process uses them, including ones created before the registration:

```typescript
import { register } from "@prometheus-io/client";
import { registerZenvarkTelemetry } from "zenvark";
import { ZenvarkOtel } from "@zenvark/otel";
import { ZenvarkProm } from "@zenvark/prom";

registerZenvarkTelemetry(
  new ZenvarkProm({ registry: register }),
  new ZenvarkOtel(),
);
```

Override the integrations for a single breaker or semaphore with its `telemetry` option:

```typescript
// Replace the global integrations for this breaker
new CircuitBreaker({
  // ...
  telemetry: { integrations: [new ZenvarkOtel({ tracer })] },
});

// Disable telemetry for this semaphore
new AdaptiveSemaphore({
  // ...
  telemetry: { isEnabled: false },
});
```

Register integrations before creating breakers and semaphores: `onBreakerInit` and `onSemaphoreInit` fire on creation, so an integration registered later does not receive them for existing instances. For `ZenvarkProm` this only means the blocked-requests counter appears on first use instead of at 0.

When several integrations are registered, the first one's wrapper is the outermost. A telemetry integration cannot break calls: errors it throws are reported through the instance's `onError` callback.

## Prometheus

### Installation

```bash
npm install @zenvark/prom @prometheus-io/client
```

### Configuration

```typescript
import { register } from "@prometheus-io/client";
import { registerZenvarkTelemetry } from "zenvark";
import { ZenvarkProm } from "@zenvark/prom";

registerZenvarkTelemetry(
  new ZenvarkProm({
    registry: register,
    customLabels: { service: "my-api" },
  }),
);
```

`ZenvarkProm` records both circuit breaker and semaphore metrics.

### Exposing Metrics

```typescript
import express from "express";
import { register } from "@prometheus-io/client";

const app = express();

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.listen(9090);
```

## Available Metrics

### Call Duration

**Name:** `zenvark_call_duration_seconds`

**Type:** Histogram

**Description:** Duration of protected calls in seconds

**Labels:**

- `breaker_id` - The unique identifier for the circuit breaker
- `result` - The outcome of the call (`success` or `failure`)
- Custom labels (if configured)

**Example:**

```
zenvark_call_duration_seconds_bucket{breaker_id="payment-api",result="success",service="my-api",le="0.005"} 45
zenvark_call_duration_seconds_bucket{breaker_id="payment-api",result="success",service="my-api",le="0.01"} 78
zenvark_call_duration_seconds_sum{breaker_id="payment-api",result="success",service="my-api"} 12.5
zenvark_call_duration_seconds_count{breaker_id="payment-api",result="success",service="my-api"} 100
```

### Blocked Requests

**Name:** `zenvark_blocked_requests_total`

**Type:** Counter

**Description:** Total number of requests blocked by the circuit breaker when the circuit is open

**Labels:**

- `breaker_id` - The unique identifier for the circuit breaker
- Custom labels (if configured)

**Example:**

```
zenvark_blocked_requests_total{breaker_id="payment-api",service="my-api"} 42
```

### Health Check Duration

**Name:** `zenvark_healthcheck_duration_seconds`

**Type:** Histogram

**Description:** Duration of health check attempts in seconds

**Labels:**

- `breaker_id` - The unique identifier for the circuit breaker
- `type` - The type of health check (`recovery` or `idle`)
- `result` - The outcome of the health check (`success` or `failure`)
- Custom labels (if configured)

**Example:**

```
zenvark_healthcheck_duration_seconds_bucket{breaker_id="payment-api",type="recovery",result="success",service="my-api",le="0.1"} 5
zenvark_healthcheck_duration_seconds_sum{breaker_id="payment-api",type="recovery",result="success",service="my-api"} 0.45
zenvark_healthcheck_duration_seconds_count{breaker_id="payment-api",type="recovery",result="success",service="my-api"} 5
```

## Label Values

### breaker_id

The unique identifier for the circuit breaker instance as defined in the configuration.

```typescript
const circuitBreaker = new CircuitBreaker({
  id: "payment-gateway-stripe", // This becomes the breaker_id label
  // ...
});
```

### result

Indicates the outcome of a call or health check:

- `success` - Operation completed successfully
- `failure` - Operation failed

### type

The type of health check performed:

- `recovery` - Health check while circuit is open, attempting to recover
- `idle` - Proactive health check while circuit is closed and idle

### Custom Labels

Additional key-value pairs provided in the `ZenvarkProm` configuration:

```typescript
new ZenvarkProm({
  registry: register,
  customLabels: {
    service: "my-api",
    environment: "production",
    region: "us-east-1",
  },
});
```

For semaphore metrics, see the [@zenvark/prom README](https://www.npmjs.com/package/@zenvark/prom).

## OpenTelemetry

The `@zenvark/otel` package creates spans through `@opentelemetry/api`. It requires Node.js 24 or later.

```bash
npm install @zenvark/otel @opentelemetry/api
```

Without a registered OpenTelemetry SDK the spans are no-ops. Once the application registers one (for example with `NodeSDK`), they are exported with no extra configuration. To use a specific tracer instead of the global one, pass it as `new ZenvarkOtel({ tracer })`.

| Span                        | Created for                               | Attributes                                                                            | Parent                    |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
| `zenvark.call`              | each `execute` call that runs             | `zenvark.breaker.id`, `zenvark.call.result`                                           | the caller's active span  |
| `zenvark.blocked`           | each call rejected by an open circuit     | `zenvark.breaker.id`                                                                  | the caller's active span  |
| `zenvark.healthcheck`       | each health check attempt                 | `zenvark.breaker.id`, `zenvark.healthcheck.type`, `zenvark.healthcheck.result`        | none (starts a new trace) |
| `zenvark.state_change`      | each transition, on the leader only       | `zenvark.breaker.id`, `zenvark.circuit.state`                                         | none (starts a new trace) |
| `zenvark.semaphore.acquire` | each acquire that is granted or times out | `zenvark.semaphore.id`, `zenvark.semaphore.class`, `zenvark.semaphore.acquire.result` | the caller's active span  |

`zenvark.call` is the active span while your function runs, so spans it creates, such as outbound HTTP calls and their retries, nest under it. `zenvark.semaphore.acquire` covers the time spent waiting for a lease. Failed calls, blocked calls, failed health checks and timed out acquires have error status; thrown errors are recorded as exception events. Cancelled health checks have no result.

## Custom Telemetry Integration

To integrate another telemetry system, implement the `Telemetry` interface. All methods are optional; implement only the ones you need:

```typescript
import { registerZenvarkTelemetry, type Telemetry } from "zenvark";

const logging: Telemetry = {
  onCallEnd({ breakerId, result, durationMs }) {
    console.log(breakerId, result, "in", durationMs, "ms");
  },
  onStateChange({ breakerId, state }) {
    console.log(breakerId, "is now", state);
  },
  onAcquire({ semaphoreId, result, waitMs }) {
    console.log(semaphoreId, result, "after", waitMs, "ms");
  },
};

registerZenvarkTelemetry(logging);
```

| Method                              | Called when                                                     |
| ----------------------------------- | --------------------------------------------------------------- |
| `executeCall`, `executeHealthCheck` | wrapping a protected call or health check, to set up context    |
| `onBreakerInit`                     | a circuit breaker is created                                    |
| `onCallEnd`                         | a protected call completes, with its result and duration        |
| `onBlockedRequest`                  | a request is blocked by an open circuit                         |
| `onHealthCheckEnd`                  | a health check completes (not for cancelled checks)             |
| `onStateChange`                     | the circuit changes state, on the leader only                   |
| `onRoleChange`                      | this instance becomes the leader or stops being it              |
| `onSemaphoreInit`                   | a semaphore is created                                          |
| `onAcquire`                         | an acquire is granted or times out, with the time spent waiting |
| `onRelease`                         | a lease is released, with its outcome and hold duration         |
| `onLimitChange`                     | this process's view of the fleet-wide limit changes             |
| `onThrottle`                        | a lease is released as `THROTTLED`                              |

Durations are measured by zenvark, so every integration reports the same numbers.

`executeCall` and `executeHealthCheck` should call `execute` synchronously (before any `await`), so the work starts inside the integration's context. The breaker settles with the work's own result as soon as it is known, without waiting for the integration: the work runs exactly once even if `execute` is not called or called twice, and a rejection other than the work's own error is reported through `onError`.

## Migrating from `metrics`

The `metrics` option of `CircuitBreaker` and `AdaptiveSemaphore`, `PrometheusBreakerMetrics` and `PrometheusSemaphoreMetrics` are deprecated. They keep working until the next major version.

Replace them with one `ZenvarkProm`, registered globally. It reports the same metrics under the same names and labels:

```typescript
// Before
new CircuitBreaker({
  // ...
  metrics: new PrometheusBreakerMetrics({ registry: register }),
});
new AdaptiveSemaphore({
  // ...
  metrics: new PrometheusSemaphoreMetrics({ registry: register }),
});

// After
registerZenvarkTelemetry(new ZenvarkProm({ registry: register }));
```

Do not use both for the same instance: every metric would be recorded twice.

A custom `BreakerMetricsRecorder` or `SemaphoreMetricsRecorder` maps onto `Telemetry` events with the same data:

| Deprecated recorder method            | Telemetry event                                  |
| ------------------------------------- | ------------------------------------------------ |
| `initialize`                          | `onBreakerInit` / `onSemaphoreInit`              |
| `recordCall`                          | `onCallEnd`                                      |
| `recordBlockedRequest`                | `onBlockedRequest`                               |
| `recordHealthCheck`                   | `onHealthCheckEnd`                               |
| `recordStateChange`, `clearState`     | `onStateChange` and `onRoleChange`               |
| `recordAcquire`, `recordRelease`      | `onAcquire`, `onRelease` (`id` is `semaphoreId`) |
| `recordLimitChange`, `recordThrottle` | `onLimitChange`, `onThrottle`                    |
