# Zenvark

Distributed resilience primitives, coordinated via Redis, designed for high-availability applications:

- A **circuit breaker** — reactive; cuts callers off from a dependency that is already failing.
- An **adaptive semaphore** — proactive; adapts a fleet-wide concurrency limit to what the dependency can actually handle.

They work independently or combined, with the breaker gating every call through the semaphore.

## Features

### Circuit breaker

- 🌐 **Distributed Coordination** - Multiple instances coordinate via Redis Streams
- ⚙️ **Multiple Breaker Strategies** - Consecutive, count-based, and time-based sampling
- ⏱️ **Flexible Backoff Strategies** - Constant or exponential delays
- 👑 **Leader Election** - Single instance manages health checks and state transitions
- ⚡ **Event-Driven** - Real-time coordination powered by Redis Streams

### Adaptive semaphore

- 🌐 **Distributed Leases** - One Redis-backed count of in-flight operations, enforced fleet-wide rather than per process
- 📈 **AIMD Adaptation** - Capacity converges toward the real ceiling based on caller-reported outcomes; no fixed rate limit to configure
- 🎟️ **Priority Classes** - Optional reserved capacity shares, so latency-sensitive callers are never fully crowded out by bulk callers
- 💓 **Crash-Safe Holds** - Leases carry a TTL and auto-renew while held; slots owned by crashed processes return to the pool within one TTL
- 🧩 **Built-in Breaker Integration** - Pass the semaphore to a `CircuitBreaker` and every `execute` call is gated

Both primitives report through **Prometheus metrics** via [@zenvark/prom](https://www.npmjs.com/package/@zenvark/prom).

## Installation

```bash
npm install zenvark ioredis
```

## Quick Start: Circuit Breaker

```typescript
import { Redis } from "ioredis";
import {
  CircuitBreaker,
  ConsecutiveBreaker,
  ConstantBackoff,
  CircuitOpenError,
} from "zenvark";

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
  onError: (err) => console.error("Circuit breaker error:", err),
});

await circuitBreaker.start();

try {
  const result = await circuitBreaker.execute(async () => {
    return await fetch("https://api.example.com/data");
  });
  console.log("Success:", result);
} catch (err) {
  if (CircuitOpenError.isInstance(err)) {
    console.log("Circuit is open - request blocked");
  }
}

await circuitBreaker.stop();
```

## Adaptive Semaphore

The breaker can gate every `execute` call through an `AdaptiveSemaphore` — a fleet-wide concurrency limit, coordinated via Redis, that converges to what the dependency can actually handle. It also works standalone. Usage, options, and how adaptation works are covered in the [Adaptive Semaphore guide](https://zenvark.github.io/zenvark/docs/guides/adaptive-semaphore).

## Error Handling

Every error Zenvark throws extends `ZenvarkError` and carries a stable `code` plus a typed `details` object. Use the static `isInstance()` guard on each class; it narrows like `instanceof` and also matches across realms and duplicate package copies.

| Class                       | `code`                      | Thrown when                                              |
| --------------------------- | --------------------------- | -------------------------------------------------------- |
| `CircuitOpenError`          | `CIRCUIT_IS_OPEN`           | `execute()` is called while the circuit is open          |
| `AcquireTimeoutError`       | `SEMAPHORE_ACQUIRE_TIMEOUT` | No semaphore slot became free within `timeoutMs`         |
| `SemaphoreUnavailableError` | `SEMAPHORE_UNAVAILABLE`     | Redis is unreachable and `onUnavailable` is `'throw'`    |
| `SemaphoreDisposedError`    | `SEMAPHORE_DISPOSED`        | `acquire()` is called on, or interrupted by, `dispose()` |

Full reference, including `details` shapes and a `switch` over `code`: [Enums & Errors](https://zenvark.github.io/zenvark/docs/api/enums-and-errors#errors).

## Error Handling

Every error Zenvark throws extends `ZenvarkError` and carries a stable `code` plus a typed `details` object. Use the static `isInstance()` guard on each class; it narrows like `instanceof` and also matches across realms and duplicate package copies.

| Class                       | `code`                      | Thrown when                                              |
| --------------------------- | --------------------------- | -------------------------------------------------------- |
| `CircuitOpenError`          | `CIRCUIT_IS_OPEN`           | `execute()` is called while the circuit is open          |
| `AcquireTimeoutError`       | `SEMAPHORE_ACQUIRE_TIMEOUT` | No semaphore slot became free within `timeoutMs`         |
| `SemaphoreUnavailableError` | `SEMAPHORE_UNAVAILABLE`     | Redis is unreachable and `onUnavailable` is `'throw'`    |
| `SemaphoreDisposedError`    | `SEMAPHORE_DISPOSED`        | `acquire()` is called on, or interrupted by, `dispose()` |

Full reference, including `details` shapes and a `switch` over `code`: [Enums & Errors](https://zenvark.github.io/zenvark/docs/api/enums-and-errors#errors).

## Prerequisites

- Node.js 22.x or higher
- Redis 6.0 or higher (Redis Streams support required)
- ioredis 5.x or 6.x, installed alongside zenvark as a peer dependency

## Documentation

**Full documentation:** [https://zenvark.github.io/zenvark/](https://zenvark.github.io/zenvark/)

- [Getting Started](https://zenvark.github.io/zenvark/docs/getting-started)
- [API Reference](https://zenvark.github.io/zenvark/docs/api/circuit-breaker)
- [Breaker Strategies](https://zenvark.github.io/zenvark/docs/strategies/breaker-strategies)
- [Backoff Strategies](https://zenvark.github.io/zenvark/docs/strategies/backoff-strategies)
- [Architecture](https://zenvark.github.io/zenvark/docs/guides/architecture)
- [Adaptive Semaphore](https://zenvark.github.io/zenvark/docs/guides/adaptive-semaphore)
- [Semaphore Design](https://zenvark.github.io/zenvark/docs/guides/semaphore-design)
- [Best Practices](https://zenvark.github.io/zenvark/docs/guides/best-practices)

## License

MIT
