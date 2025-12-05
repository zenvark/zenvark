# zenvark

A robust distributed circuit breaker, coordinated via Redis, designed for high-availability applications.

## Features

- **Distributed Coordination** - Multiple instances coordinate via Redis Streams
- **Multiple Breaker Strategies** - Consecutive, count-based, and time-based sampling
- **Flexible Backoff Strategies** - Constant or exponential delays
- **Leader Election** - Single instance manages health checks and state transitions
- **Event-Driven** - Real-time coordination powered by Redis Streams
- **Prometheus Metrics** - Built-in observability with [@zenvark/prom](https://www.npmjs.com/package/@zenvark/prom)

## Installation

```bash
npm install zenvark ioredis
```

## Quick Start

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
      const response = await fetch("https://api.example.com/health", { signal });
      if (!response.ok) throw new Error("Health check failed");
    },
  },
  onError: (err) => console.error("Circuit Breaker Error:", err),
});

await circuitBreaker.start();

try {
  const result = await circuitBreaker.execute(async () => {
    return await fetch("https://api.example.com/data");
  });
  console.log("Success:", result);
} catch (err) {
  if (err instanceof CircuitOpenError) {
    console.log("Circuit is open - request blocked");
  }
}

await circuitBreaker.stop();
```

## Prerequisites

- Node.js 22.x or higher
- Redis 6.0 or higher (Redis Streams support required)
-
## Documentation

**Full documentation:** [https://zenvark.github.io/zenvark/](https://zenvark.github.io/zenvark/)

- [Getting Started](https://zenvark.github.io/zenvark/docs/getting-started)
- [API Reference](https://zenvark.github.io/zenvark/docs/api/circuit-breaker)
- [Breaker Strategies](https://zenvark.github.io/zenvark/docs/strategies/breaker-strategies)
- [Backoff Strategies](https://zenvark.github.io/zenvark/docs/strategies/backoff-strategies)
- [Architecture](https://zenvark.github.io/zenvark/docs/guides/architecture)
- [Best Practices](https://zenvark.github.io/zenvark/docs/guides/best-practices)

## License

MIT
