# zenvark

A robust distributed circuit breaker, coordinated via Redis, designed for high-availability applications. This library helps you build resilient systems by preventing cascading failures and gracefully handling degraded services.

## Features

- **Distributed Coordination**: Multiple instances coordinate circuit state using Redis, ensuring consistent behavior across your services.
- **Multiple Breaker Strategies**: Choose from consecutive failures, sliding window, and time-based sampling to detect service unhealthiness.
- **Flexible Backoff Strategies**: Configure constant or exponential backoff for health checks, preventing service overload during recovery.
- **Leader Election**: Ensures a single instance is responsible for critical circuit state management and health checks, preventing race conditions.
- **Event-Driven**: Real-time state coordination and event processing powered by Redis Streams.
- **Prometheus Metrics**: Built-in observability with customizable labels for easy monitoring.

## Prerequisites

- **Node.js**: 22.x or higher
- **Redis**: 6.0 or higher (Redis Streams support required)

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
	HealthCheckTypeEnum,
} from "zenvark";

const redis = new Redis("redis://localhost:6379");

const circuitBreaker = new CircuitBreaker({
	id: "my-service-api", // Unique ID for this circuit breaker
	redis,
	breaker: new ConsecutiveBreaker({ threshold: 5 }), // Open after 5 consecutive failures
	health: {
		backoff: new ConstantBackoff({ delayMs: 5000 }), // Wait 5 seconds between health checks
		async check(type: HealthCheckTypeEnum, signal: AbortSignal) {
			// Your health check logic
			const response = await fetch("https://api.example.com/health", {
				signal,
			});
			if (!response.ok) throw new Error("Health check failed");
		},
		idleProbeIntervalMs: 30_000, // Run first probe 30s after last call
	},
	onError(err: Error) {
		console.error("Circuit Breaker Internal Error:", err);
	},
	onStateChange(state) {
		console.log("Circuit state changed to", state);
	},
});

// Start the circuit breaker
await circuitBreaker.start();

// Execute operations protected by the circuit breaker
try {
	const result = await circuitBreaker.execute(async () => {
		return await fetch("http://api.example.com/data");
	});
	console.log("Success:", result);
} catch (err) {
	if (err instanceof CircuitOpenError) {
		// Circuit is currently open – skipping request
	} else {
		// Underlying operation failed
	}
}

// Clean up resources when your application shuts down
await circuitBreaker.stop();
```

## Breaker Strategies

### ConsecutiveBreaker

Opens the circuit after a specified number of consecutive failures.

```typescript
import { ConsecutiveBreaker } from "zenvark";

const breaker = new ConsecutiveBreaker({
	threshold: 3, // Open after 3 consecutive failures
});
```

### CountBreaker

Opens the circuit when failure rate exceeds a threshold within a sliding window of recent calls.

```typescript
import { CountBreaker } from "zenvark";

const breaker = new CountBreaker({
	threshold: 0.5, // Open if 50% or more of recent calls failed
	size: 100, // Number of recent calls to evaluate
	minimumNumberOfCalls: 10, // Require at least 10 calls before evaluating
});
```

### SamplingBreaker

Opens the circuit when failure rate exceeds a threshold within a time-based window.

```typescript
import { SamplingBreaker } from "zenvark";

const breaker = new SamplingBreaker({
	threshold: 0.3, // Open if 30% of events in window failed
	duration: 60000, // 60 second evaluation window
	minimumNumberOfCalls: 5, // Require at least 5 events before evaluating
});
```

## Backoff Strategies

### ConstantBackoff

Applies a fixed delay between health check attempts.

```typescript
import { ConstantBackoff } from "zenvark";

const backoff = new ConstantBackoff({
	delayMs: 5000, // Waits 5 seconds between each attempt
});
```

### ExponentialBackoff

Increases the delay between health checks exponentially.

```typescript
import { ExponentialBackoff } from "zenvark";

const backoff = new ExponentialBackoff({
	initialDelayMs: 1000, // Delay for the first attempt
	multiplier: 2, // Each delay is multiplied by this factor
	maxDelayMs: 30000, // Cap delays at 30 seconds
});
```

## Prometheus Integration

Add metrics using the `@zenvark/prom` package:

```bash
npm install @zenvark/prom prom-client
```

```typescript
import { PrometheusBreakerMetrics } from "@zenvark/prom";
import { register } from "prom-client";

const circuitBreaker = new CircuitBreaker({
	id: "my-service-api",
	// ... other config
	metrics: new PrometheusBreakerMetrics({
		register,
		customLabels: { service: "my-api" },
	}),
});
```

## Documentation

For comprehensive documentation including:

- Complete API reference
- Architecture details
- Distributed coordination
- Best practices
- More examples

Visit the [main repository](https://github.com/zenvark/zenvark#readme).

## License

MIT
