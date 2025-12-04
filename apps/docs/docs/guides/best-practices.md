---
sidebar_position: 5
---

# Best Practices

Guidelines and recommendations for using Zenvark effectively in production environments.

## Circuit Breaker Naming

Use descriptive, unique IDs that reflect the protected resource.

### Good Examples ✅

```typescript
// Specific and descriptive
new CircuitBreaker({ id: "payment-gateway-stripe", ... })
new CircuitBreaker({ id: "user-service-api", ... })
new CircuitBreaker({ id: "inventory-database", ... })
new CircuitBreaker({ id: "email-provider-sendgrid", ... })
```

### Bad Examples ❌

```typescript
// Too generic
new CircuitBreaker({ id: "api", ... })
new CircuitBreaker({ id: "service", ... })
new CircuitBreaker({ id: "circuit-1", ... })
```

### Naming Conventions

- Include the service or resource being protected
- Be specific about which instance (e.g., provider name)
- Use consistent naming across your application
- Avoid numbers or generic identifiers

## Error Handling

Always provide an error handler to prevent unhandled exceptions from internal circuit breaker operations.

### Required Error Handler

```typescript
const circuitBreaker = new CircuitBreaker({
	// ...
	onError: (err) => {
		logger.error("Circuit breaker internal error", {
			breakerId: circuitBreaker.id,
			error: err.message,
			stack: err.stack,
		});
	},
});
```

## Health Check Implementation

Keep health checks simple, focused, and reliable.

### Good Health Checks ✅

```typescript
// Simple HTTP endpoint check
async check(type: HealthCheckType, signal: AbortSignal) {
  const response = await fetch("/health", { signal });
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
}
```

### Bad Health Checks ❌

```typescript
// ❌ Complex logic with side effects
async check(type: HealthCheckType, signal: AbortSignal) {
  const user = await createTestUser();
  const order = await processTestOrder(user);
  await deleteTestData(user, order);
  if (!order.success) throw new Error("Health check failed");
}
```

### Health Check Guidelines

1. **Keep it simple**: Check only what's necessary
2. **Respect the signal**: Always pass `AbortSignal` to async operations
3. **Throw errors**: Always throw `Error` objects on failure
4. **Avoid side effects**: Don't modify data or state
5. **Set timeouts**: Prevent hanging health checks
6. **Be consistent**: Return quickly and predictably

## Resource Management

Always clean up resources properly during application lifecycle.

### Proper Lifecycle Management

```typescript
import { CircuitBreaker } from "zenvark";
import { Redis } from "ioredis";

// Initialize resources
const redis = new Redis("redis://localhost:6379");
const circuitBreaker = new CircuitBreaker({ redis, ... });

// Start the circuit breaker
await circuitBreaker.start();

// Application logic...

// Clean shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");

  // Stop circuit breaker first
  await circuitBreaker.stop();

  // Then close Redis connection
  await redis.quit();

  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  await circuitBreaker.stop();
  await redis.quit();
  process.exit(0);
});
```

### Multiple Circuit Breakers

```typescript
const breakers = [
  new CircuitBreaker({ id: "service-a", ... }),
  new CircuitBreaker({ id: "service-b", ... }),
  new CircuitBreaker({ id: "service-c", ... }),
];

// Start all
await Promise.all(breakers.map(cb => cb.start()));

// Clean shutdown
process.on("SIGTERM", async () => {
  await Promise.all(breakers.map(cb => cb.stop()));
  process.exit(0);
});
```
