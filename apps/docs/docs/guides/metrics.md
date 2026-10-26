---
sidebar_position: 4
---

# Metrics & Observability

Built-in Prometheus integration provides key metrics for monitoring the health and behavior of your circuit breakers.

## Prometheus Integration

The easiest way to add Prometheus metrics is using the `@zenvark/prom` package:

### Installation

```bash
npm install @zenvark/prom @prometheus-io/client
```

### Configuration

```typescript
import { CircuitBreaker } from "zenvark";
import { PrometheusBreakerMetrics } from "@zenvark/prom";
import { register } from "@prometheus-io/client";

const metrics = new PrometheusBreakerMetrics({
  register,
  customLabels: { service: "my-api" },
});

const circuitBreaker = new CircuitBreaker({
  id: "my-service-api",
  // ... other config
  metrics,
});
```

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

Additional key-value pairs provided in the metrics configuration:

```typescript
const metrics = new PrometheusBreakerMetrics({
  register,
  customLabels: {
    service: "my-api",
    environment: "production",
    region: "us-east-1",
  },
});
```

## OpenTelemetry Tracing

The `@zenvark/otel` package creates circuit breaker spans through `@opentelemetry/api`. The core `zenvark` package does not depend on OpenTelemetry.

### Installation

```bash
npm install @zenvark/otel @opentelemetry/api
```

### Configuration

```typescript
import { CircuitBreaker } from "zenvark";
import { OpenTelemetryBreakerTracer } from "@zenvark/otel";

const circuitBreaker = new CircuitBreaker({
  id: "my-service-api",
  // ... other config
  tracing: new OpenTelemetryBreakerTracer(),
});
```

Without a registered OpenTelemetry SDK the spans are no-ops. Once the application registers one (for example with `NodeSDK`), they are exported with no extra configuration. To use a specific tracer instead of the global one, pass it as `new OpenTelemetryBreakerTracer({ tracer })`.

### Spans

| Span                   | Created for                           | Attributes                                                                     | Parent                    |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| `zenvark.call`         | each `execute` call that runs         | `zenvark.breaker.id`, `zenvark.call.result`                                    | the caller's active span  |
| `zenvark.blocked`      | each call rejected by an open circuit | `zenvark.breaker.id`                                                           | the caller's active span  |
| `zenvark.healthcheck`  | each health check attempt             | `zenvark.breaker.id`, `zenvark.healthcheck.type`, `zenvark.healthcheck.result` | none (starts a new trace) |
| `zenvark.state_change` | each transition, on the leader only   | `zenvark.breaker.id`, `zenvark.circuit.state`                                  | none (starts a new trace) |

`zenvark.call` is the active span while your function runs, so spans it creates, such as outbound HTTP calls and their retries, nest under it. Failed calls, blocked calls and failed health checks have error status; thrown errors are recorded as exception events. Cancelled health checks have no result.

### Custom Tracing Implementation

To use another tracing system, implement the `BreakerTracer` interface:

```typescript
import type {
  BreakerTracer,
  TraceCallParams,
  TraceHealthCheckParams,
} from "zenvark";

class CustomTracer implements BreakerTracer {
  async traceCall<T>({ breakerId, execute }: TraceCallParams<T>): Promise<T> {
    // Start a span, run `execute` inside it, end the span
    return await execute();
  }

  async traceHealthCheck({ execute }: TraceHealthCheckParams): Promise<void> {
    await execute();
  }
}
```

## Custom Metrics Implementation

You can implement custom metrics by implementing the `BreakerMetricsRecorder` interface:

```typescript
import { BreakerMetricsRecorder, CallResult, HealthCheckResult } from "zenvark";

class CustomMetrics implements BreakerMetricsRecorder {
  initialize?(breakerId: string): void {
    // Optional: Initialize metrics with breaker ID
  }

  recordCall(params: RecordCallParams): void {
    // Your custom implementation
  }

  recordBlockedRequest(params: RecordBlockedRequestParams): void {
    // Your custom implementation
  }

  recordHealthCheck(params: RecordHealthCheckParams): void {
    // Your custom implementation
  }
}

const circuitBreaker = new CircuitBreaker({
  // ...
  metrics: new CustomMetrics(),
});
```
