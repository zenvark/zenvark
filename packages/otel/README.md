# @zenvark/otel

OpenTelemetry tracing for the [Zenvark](https://www.npmjs.com/package/zenvark) circuit breaker and adaptive semaphore.

## Installation

```bash
npm install @zenvark/otel @opentelemetry/api
```

Requires Node.js 24 or later.

## Usage

Register the integration once at startup, before or after creating breakers:

```typescript
import { registerZenvarkTelemetry } from "zenvark";
import { ZenvarkOtel } from "@zenvark/otel";

registerZenvarkTelemetry(new ZenvarkOtel());
```

Every circuit breaker and semaphore in the process now emits spans. To override this for one breaker, use its `telemetry` option:

```typescript
new CircuitBreaker({
  // ...
  telemetry: { integrations: [new ZenvarkOtel({ tracer })] }, // or { isEnabled: false }
});
```

Spans are no-ops until the application registers an OpenTelemetry SDK (for example with `NodeSDK`). By default spans are created with the `zenvark` tracer of the global tracer provider; pass `{ tracer }` to use a specific one.

## Describing what a breaker protects

Zenvark knows what a breaker is called, not what it protects, so its spans carry no peer of their own. Pass `attributes` to add your own to every span, either fixed or resolved from the breaker or semaphore id:

```typescript
const HOSTS: Record<string, string | undefined> = {
  translations: "api.example.com",
  payments: "payments.example.net",
};

registerZenvarkTelemetry(
  new ZenvarkOtel({
    attributes: (id) => ({ "server.address": HOSTS[id] }),
  }),
);
```

`zenvark.call`, `zenvark.blocked` and `zenvark.healthcheck` are client spans, which OpenTelemetry's semantic conventions expect to carry `server.address`. Setting it lets a tracing backend attribute the call to the dependency it reaches, across every breaker regardless of the protocol the call itself uses. Zenvark's own `zenvark.*` attributes take precedence, so these cannot overwrite them, and are set first, so a low `attributeCountLimit` drops these rather than the breaker id and the call result.

## Spans

| Span                        | Created for                               | Attributes                                                                            | Parent                    |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
| `zenvark.call`              | each `execute` call that runs             | `zenvark.breaker.id`, `zenvark.call.result`                                           | the caller's active span  |
| `zenvark.blocked`           | each call rejected by an open circuit     | `zenvark.breaker.id`                                                                  | the caller's active span  |
| `zenvark.healthcheck`       | each health check attempt                 | `zenvark.breaker.id`, `zenvark.healthcheck.type`, `zenvark.healthcheck.result`        | none (starts a new trace) |
| `zenvark.state_change`      | each transition, on the leader only       | `zenvark.breaker.id`, `zenvark.circuit.state`                                         | none (starts a new trace) |
| `zenvark.semaphore.acquire` | each acquire that is granted or times out | `zenvark.semaphore.id`, `zenvark.semaphore.class`, `zenvark.semaphore.acquire.result` | the caller's active span  |

`zenvark.call` is the active span while your function runs, so spans it creates, such as outbound HTTP calls and their retries, nest under it. `zenvark.semaphore.acquire` covers the time spent waiting for a lease. Failed calls, blocked calls, failed health checks and timed out acquires have error status; thrown errors are recorded as exception events.

## Documentation

**Full documentation:** [https://zenvark.github.io/zenvark/docs/guides/metrics#opentelemetry](https://zenvark.github.io/zenvark/docs/guides/metrics#opentelemetry)

## License

MIT
