# @zenvark/otel

OpenTelemetry tracing for the [Zenvark](https://www.npmjs.com/package/zenvark) circuit breaker.

## Installation

```bash
npm install @zenvark/otel @opentelemetry/api
```

## Usage

Register the integration once at startup, before or after creating breakers:

```typescript
import { registerTelemetry } from "zenvark";
import { OpenTelemetry } from "@zenvark/otel";

registerTelemetry(new OpenTelemetry());
```

Every circuit breaker in the process now emits spans. To override this for one breaker, use its `telemetry` option:

```typescript
new CircuitBreaker({
  // ...
  telemetry: { integrations: [new OpenTelemetry({ tracer })] }, // or { isEnabled: false }
});
```

Spans are no-ops until the application registers an OpenTelemetry SDK (for example with `NodeSDK`). By default spans are created with the `zenvark` tracer of the global tracer provider; pass `{ tracer }` to use a specific one.

## Spans

| Span                   | Created for                           | Attributes                                                                     | Parent                    |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| `zenvark.call`         | each `execute` call that runs         | `zenvark.breaker.id`, `zenvark.call.result`                                    | the caller's active span  |
| `zenvark.blocked`      | each call rejected by an open circuit | `zenvark.breaker.id`                                                           | the caller's active span  |
| `zenvark.healthcheck`  | each health check attempt             | `zenvark.breaker.id`, `zenvark.healthcheck.type`, `zenvark.healthcheck.result` | none (starts a new trace) |
| `zenvark.state_change` | each transition, on the leader only   | `zenvark.breaker.id`, `zenvark.circuit.state`                                  | none (starts a new trace) |

`zenvark.call` is the active span while your function runs, so spans it creates, such as outbound HTTP calls and their retries, nest under it. Failed calls, blocked calls and failed health checks have error status; thrown errors are recorded as exception events.

## Documentation

**Full documentation:** [https://zenvark.github.io/zenvark/docs/guides/metrics#opentelemetry](https://zenvark.github.io/zenvark/docs/guides/metrics#opentelemetry)

## License

MIT
