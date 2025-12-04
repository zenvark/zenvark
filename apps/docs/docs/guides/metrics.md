---
sidebar_position: 2
---

# Metrics & Observability

Built-in Prometheus integration provides key metrics for monitoring the health and behavior of your circuit breakers.

## Prometheus Integration

The easiest way to add Prometheus metrics is using the `@zenvark/prom` package:

### Installation

```bash
npm install @zenvark/prom prom-client
```

### Configuration

```typescript
import { CircuitBreaker } from "zenvark";
import { PrometheusBreakerMetrics } from "@zenvark/prom";
import { register } from "prom-client";

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
import { register } from "prom-client";

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

## Custom Metrics Implementation

You can implement custom metrics by implementing the `BreakerMetrics` interface:

```typescript
import { BreakerMetrics, CallResult, HealthCheckResult } from "zenvark";

class CustomMetrics implements BreakerMetrics {
  recordCall(result: CallResult): void {
    // Your custom implementation
  }

  recordBlockedRequest(): void {
    // Your custom implementation
  }

  recordHealthCheck(result: HealthCheckResult): void {
    // Your custom implementation
  }
}

const circuitBreaker = new CircuitBreaker({
  // ...
  metrics: new CustomMetrics(),
});
```
