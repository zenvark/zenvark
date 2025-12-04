---
sidebar_position: 2
---

# Backoff Strategies

Backoff strategies control how long the leader instance waits between health check attempts while the circuit is open. This prevents hammering an unhealthy service and gives it time to recover.

Backoff strategies are stateless and immutable. They implement the following interface:

```typescript
export interface BackoffStrategy {
	/**
	 * Calculates the delay in milliseconds before the specified attempt.
	 *
	 * @param attempt - The attempt number, starting from 1.
	 * @returns The delay in milliseconds to wait before this attempt.
	 */
	getDelayMs(attempt: number): number;
}
```

:::info
The first health check (attempt = 1) is also delayed.
:::

## ConstantBackoff

Applies a fixed delay between health check attempts.

### Configuration

```typescript
new ConstantBackoff({
  delayMs: number;  // Fixed delay in milliseconds
})
```

### Example

```typescript
import { ConstantBackoff } from "zenvark";

const backoff = new ConstantBackoff({
	delayMs: 5000, // Wait 5 seconds between each attempt
});
```

### Use Cases

- When you want predictable, regular health check intervals
- Services that recover quickly or need consistent monitoring
- Development and testing environments
- When exponential growth is not desired

### Behavior

Every health check attempt waits the same amount of time:

```
Attempt 1: 5000ms delay
Attempt 2: 5000ms delay
Attempt 3: 5000ms delay
...
```

## ExponentialBackoff

Increases the delay between health checks exponentially, with an optional maximum cap.

### Configuration

```typescript
new ExponentialBackoff({
  initialDelayMs: number;  // Delay for the first attempt
  multiplier: number;      // Factor to multiply delay by each attempt
  maxDelayMs?: number;     // Optional: Maximum delay cap
})
```

### Example

```typescript
import { ExponentialBackoff } from "zenvark";

const backoff = new ExponentialBackoff({
	initialDelayMs: 1000, // Start with 1 second
	multiplier: 2, // Double the delay each time
	maxDelayMs: 30000, // Cap at 30 seconds
});
```

### Use Cases

- Services that need time to recover from serious issues
- When you want to reduce load on failing services over time
- Production environments with external dependencies
- Services with long recovery periods

### Behavior

Delay grows exponentially with each attempt:

**Without maxDelayMs:**

```
Attempt 1: 1000ms delay
Attempt 2: 2000ms delay
Attempt 3: 4000ms delay
Attempt 4: 8000ms delay
Attempt 5: 16000ms delay
...
```

**With maxDelayMs: 10000:**

```
Attempt 1: 1000ms delay
Attempt 2: 2000ms delay
Attempt 3: 4000ms delay
Attempt 4: 8000ms delay
Attempt 5: 10000ms delay - capped
Attempt 6: 10000ms delay - capped
...
```

## Choosing a Strategy

| Strategy               | Best For           | Recovery Time | Resource Impact |
| ---------------------- | ------------------ | ------------- | --------------- |
| **ConstantBackoff**    | Predictable checks | Fast          | Higher          |
| **ExponentialBackoff** | Gradual recovery   | Variable      | Lower           |

### Decision Guide

Choose **ConstantBackoff** when:

- You need predictable health check intervals
- Services typically recover quickly
- You're in a development/testing environment
- Load on the failing service is not a concern

Choose **ExponentialBackoff** when:

- Services may take significant time to recover
- You want to reduce load on failing services
- You're in a production environment
- You want to avoid overwhelming a recovering service

## Custom Strategies

You can implement your own backoff strategy by implementing the `BackoffStrategy` interface:

```typescript
import { BackoffStrategy } from "zenvark";

class FibonacciBackoff implements BackoffStrategy {
	constructor(private baseDelayMs: number) {}

	getDelayMs(attempt: number): number {
		return this.fibonacci(attempt) * this.baseDelayMs;
	}

	private fibonacci(n: number): number {
		if (n <= 1) return 1;
		let a = 1,
			b = 1;
		for (let i = 2; i < n; i++) {
			[a, b] = [b, a + b];
		}
		return b;
	}
}

const circuitBreaker = new CircuitBreaker({
	// ...
	health: {
		backoff: new FibonacciBackoff(1000),
		// ...
	},
});
```
