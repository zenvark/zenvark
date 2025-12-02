# @zenvark/prom

Prometheus metrics integration for [Zenvark Circuit Breaker](https://github.com/zenvark/zenvark).

## Installation

```bash
npm install @zenvark/prom prom-client zenvark
```

## Usage

```typescript
import { Redis } from "ioredis";
import { CircuitBreaker, ConsecutiveBreaker, ConstantBackoff } from "zenvark";
import { PrometheusBreakerMetrics } from "@zenvark/prom";
import { register } from "prom-client";

const redis = new Redis("redis://localhost:6379");

const circuitBreaker = new CircuitBreaker({
	id: "my-service-api",
	redis,
	breaker: new ConsecutiveBreaker({ threshold: 5 }),
	health: {
		backoff: new ConstantBackoff({ delayMs: 5000 }),
		async check() {
			const response = await fetch("https://api.example.com/health");
			if (!response.ok) throw new Error("Health check failed");
		},
	},
	metrics: new PrometheusBreakerMetrics({
		register, // Prometheus registry instance
		customLabels: { service: "my-api", environment: "production" },
	}),
});

await circuitBreaker.start();
```

## Available Metrics

| Metric                                 | Type      | Description                      | Labels                         |
| -------------------------------------- | --------- | -------------------------------- | ------------------------------ |
| `zenvark_call_duration_seconds`        | Histogram | Duration of protected calls      | `breaker_id`, `result`         |
| `zenvark_blocked_requests_total`       | Counter   | Requests blocked by open circuit | `breaker_id`                   |
| `zenvark_healthcheck_duration_seconds` | Histogram | Health check attempt duration    | `breaker_id`, `type`, `result` |

## Label Values

- `breaker_id`: The unique identifier for the circuit breaker instance (as defined in the `id` configuration).
- `type`: The type of health check performed:
  - `recovery`: Health checks while circuit is OPEN
  - `idle`: Periodic health checks while circuit is CLOSED and idle
- `result`: Indicates the outcome:
  - `success`: Call or health check succeeded
  - `failure`: Call or health check failed
- **Custom labels**: Any additional key-value pairs provided in the `customLabels` configuration

## Custom Labels

You can add custom labels to all metrics for better organization and filtering:

```typescript
const metrics = new PrometheusBreakerMetrics({
	register,
	customLabels: {
		service: "payment-service",
		environment: "production",
		region: "us-east-1",
	},
});
```

## Multiple Circuit Breakers

When using multiple circuit breakers in the same application, they will all register metrics to the same Prometheus registry. Each breaker is distinguished by its `breaker_id` label:

```typescript
import { register } from "prom-client";

const apiBreaker = new CircuitBreaker({
	id: "external-api",
	metrics: new PrometheusBreakerMetrics({ register }),
	// ...
});

const dbBreaker = new CircuitBreaker({
	id: "database",
	metrics: new PrometheusBreakerMetrics({ register }),
	// ...
});
```

## Exposing Metrics Endpoint

To expose metrics for Prometheus to scrape:

```typescript
import express from "express";
import { register } from "prom-client";

const app = express();

app.get("/metrics", async (req, res) => {
	res.set("Content-Type", register.contentType);
	res.end(await register.metrics());
});

app.listen(3000);
```

## Example Queries

### Request Success Rate

```promql
rate(zenvark_call_duration_seconds_count{result="success"}[5m])
/ rate(zenvark_call_duration_seconds_count[5m])
```

### Blocked Requests Rate

```promql
rate(zenvark_blocked_requests_total[5m])
```

### Health Check Success Rate

```promql
rate(zenvark_healthcheck_duration_seconds_count{result="success"}[5m])
/ rate(zenvark_healthcheck_duration_seconds_count[5m])
```

### P95 Call Duration

```promql
histogram_quantile(0.95, rate(zenvark_call_duration_seconds_bucket[5m]))
```

## Documentation

For more information about the Zenvark Circuit Breaker, visit the [main repository](https://github.com/zenvark/zenvark#readme).

## License

MIT
