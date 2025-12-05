# @zenvark/prom

Prometheus metrics integration for [Zenvark Circuit Breaker](https://github.com/zenvark/zenvark).

## Installation

```bash
npm install @zenvark/prom prom-client
```

## Usage

```typescript
import { CircuitBreaker, ConsecutiveBreaker, ConstantBackoff } from "zenvark";
import { PrometheusBreakerMetrics } from "@zenvark/prom";
import { register } from "prom-client";
import { Redis } from "ioredis";

const redis = new Redis("redis://localhost:6379");

const circuitBreaker = new CircuitBreaker({
  id: "my-service-api",
  redis,
  breaker: new ConsecutiveBreaker({ threshold: 5 }),
  health: {
    backoff: new ConstantBackoff({ delayMs: 5000 }),
    async check(type, signal) {
      const response = await fetch("https://api.example.com/health", { signal });
      if (!response.ok) throw new Error("Health check failed");
    },
  },
  metrics: new PrometheusBreakerMetrics({
    register,
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

### Label Values

- `breaker_id` - Circuit breaker instance identifier
- `type` - Health check type: `recovery` or `idle`
- `result` - Outcome: `success` or `failure`
- Custom labels - Additional key-value pairs from configuration

## Custom Labels

Add custom labels to all metrics:

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

## Documentation

**Full documentation:** [https://zenvark.github.io/zenvark/docs/guides/metrics](https://zenvark.github.io/zenvark/docs/guides/metrics)

For comprehensive information about Zenvark Circuit Breaker:
- [Main Documentation](https://zenvark.github.io/zenvark/)
- [Metrics & Observability Guide](https://zenvark.github.io/zenvark/docs/guides/metrics)
- [GitHub Repository](https://github.com/zenvark/zenvark)

## License

MIT
