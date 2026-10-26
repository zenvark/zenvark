# @zenvark/otel

OpenTelemetry tracing for the [Zenvark](https://www.npmjs.com/package/zenvark) circuit breaker.

## Installation

```bash
npm install @zenvark/otel @opentelemetry/api
```

## Usage

```typescript
import { CircuitBreaker, ConsecutiveBreaker, ConstantBackoff } from "zenvark";
import { OpenTelemetryBreakerTracer } from "@zenvark/otel";
import { Redis } from "ioredis";

const redis = new Redis("redis://localhost:6379");

const circuitBreaker = new CircuitBreaker({
  id: "my-service-api",
  redis,
  breaker: new ConsecutiveBreaker({ threshold: 5 }),
  health: {
    backoff: new ConstantBackoff({ delayMs: 5000 }),
    async check(type, signal) {
      const response = await fetch("https://api.example.com/health", {
        signal,
      });
      if (!response.ok) throw new Error("Health check failed");
    },
  },
  tracing: new OpenTelemetryBreakerTracer(),
});

await circuitBreaker.start();
```

Spans are no-ops until the application registers an OpenTelemetry SDK (for example with `NodeSDK`). By default spans are created with the `zenvark` tracer of the global tracer provider; pass `{ tracer }` to use a specific one:

```typescript
new OpenTelemetryBreakerTracer({ tracer: provider.getTracer("my-app") });
```

## Spans

| Span                   | Created for                           | Attributes                                                                     | Parent                    |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| `zenvark.call`         | each `execute` call that runs         | `zenvark.breaker.id`, `zenvark.call.result`                                    | the caller's active span  |
| `zenvark.blocked`      | each call rejected by an open circuit | `zenvark.breaker.id`                                                           | the caller's active span  |
| `zenvark.healthcheck`  | each health check attempt             | `zenvark.breaker.id`, `zenvark.healthcheck.type`, `zenvark.healthcheck.result` | none (starts a new trace) |
| `zenvark.state_change` | each transition, on the leader only   | `zenvark.breaker.id`, `zenvark.circuit.state`                                  | none (starts a new trace) |

`zenvark.call` is the active span while your function runs, so spans it creates, such as outbound HTTP calls and their retries, nest under it. Failed calls, blocked calls and failed health checks have error status; thrown errors are recorded as exception events.

## Documentation

**Full documentation:** [https://zenvark.github.io/zenvark/docs/guides/metrics#opentelemetry-tracing](https://zenvark.github.io/zenvark/docs/guides/metrics#opentelemetry-tracing)

## License

MIT
