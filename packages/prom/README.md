# @zenvark/prom

Prometheus metrics integration for the [Zenvark](https://www.npmjs.com/package/zenvark) circuit breaker and adaptive semaphore.

## Installation

```bash
npm install @zenvark/prom @prometheus-io/client
```

## Usage

Register `ZenvarkProm` once at startup. It records metrics for every circuit breaker and adaptive semaphore in the process:

```typescript
import { register } from "@prometheus-io/client";
import { registerZenvarkTelemetry } from "zenvark";
import { ZenvarkProm } from "@zenvark/prom";

registerZenvarkTelemetry(
  new ZenvarkProm({
    registry: register,
    customLabels: { service: "my-api", environment: "production" },
  }),
);
```

Register it before creating breakers and semaphores, so their counters appear in scrapes at 0 before the first event.

To use it for a single breaker or semaphore only, pass it in the `telemetry` option instead:

```typescript
new CircuitBreaker({
  // ...
  telemetry: { integrations: [new ZenvarkProm({ registry: register })] },
});
```

### Migrating from `PrometheusBreakerMetrics` and `PrometheusSemaphoreMetrics`

Both classes, and the `metrics` option they are passed to, are deprecated. Replace them with one registered `ZenvarkProm`; it reports the same metrics under the same names and labels. Do not use both for the same instance, or every metric is recorded twice.

## Available Metrics

### Circuit breaker

| Metric                                 | Type      | Description                                  | Labels                         |
| -------------------------------------- | --------- | -------------------------------------------- | ------------------------------ |
| `zenvark_call_duration_seconds`        | Histogram | Duration of protected calls                  | `breaker_id`, `result`         |
| `zenvark_blocked_requests_total`       | Counter   | Requests blocked by open circuit             | `breaker_id`                   |
| `zenvark_healthcheck_duration_seconds` | Histogram | Health check attempt duration                | `breaker_id`, `type`, `result` |
| `zenvark_state`                        | Gauge     | Circuit state (active state 1, all others 0) | `breaker_id`, `state`          |

### Semaphore

| Metric                                    | Type      | Description                                 | Labels                             |
| ----------------------------------------- | --------- | ------------------------------------------- | ---------------------------------- |
| `zenvark_semaphore_acquire_wait_seconds`  | Histogram | Time spent waiting for a lease              | `semaphore_id`, `class`, `result`  |
| `zenvark_semaphore_hold_duration_seconds` | Histogram | Time a lease was held                       | `semaphore_id`, `class`, `outcome` |
| `zenvark_semaphore_limit`                 | Gauge     | This process's view of the fleet-wide limit | `semaphore_id`                     |
| `zenvark_semaphore_throttle_events_total` | Counter   | Caller-reported throttle events             | `semaphore_id`                     |

The limit gauge is set on every process whose cached view changes, so a scrape of any instance reads the current fleet-wide limit. Sum or average across instances accordingly.

### Label Values

- `breaker_id` - Circuit breaker instance identifier
- `type` - Health check type: `recovery` or `idle`
- `result` - Breaker call outcome (`success` or `failure`), or semaphore acquire outcome (`acquired` or `timeout`)
- `state` - Circuit state: `closed` or `open`
- `semaphore_id` - Semaphore instance identifier
- `class` - Semaphore priority class (empty when acquired without a class)
- `outcome` - Lease release outcome: `success`, `throttled` or `failure`
- Custom labels - Additional key-value pairs from configuration

## Custom Labels

Add custom labels to all metrics:

```typescript
new ZenvarkProm({
  registry: register,
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
