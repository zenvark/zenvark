---
sidebar_position: 3
---

# Health Checks

Health checks allow the circuit breaker to monitor service health and manage state transitions automatically.

:::info
Only the **leader instance** runs health checks. Follower instances wait for state updates from the leader. This prevents duplicate health checks and reduces load on the protected service.
:::

## Recovery Health Checks

When the circuit opens due to failures, the leader instance automatically begins recovery health checks.

### Behavior

- **Trigger**: Starts automatically when the circuit transitions to OPEN state
- **Timing**: Uses the configured backoff strategy (e.g., exponential backoff)
- **Purpose**: Determine when the service has recovered
- **Result**: Circuit closes when a health check succeeds

### Backoff Strategy

Recovery health checks use a backoff strategy to control retry timing. See the [Backoff Strategies](../strategies/backoff-strategies.md) guide for available options.

```typescript
import { CircuitBreaker, ExponentialBackoff } from "zenvark";

const circuitBreaker = new CircuitBreaker({
  health: {
    // Start with 1s delay, double after each failure, max 30s
    backoff: new ExponentialBackoff({
      initialDelayMs: 1000,
      multiplier: 2,
      maxDelayMs: 30_000,
    }),
    async check(type: HealthCheckType, signal: AbortSignal) {
      await fetch("https://api.example.com/health", { signal });
    },
  },
});
```

## Idle Health Checks

Idle health checks are optional and provide proactive monitoring when the circuit is closed but inactive. They detect service degradation before the next request arrives.

### How It Works

Consider a circuit breaker with `idleProbeIntervalMs: 10000` (10 seconds):

| Time    | Event                  | Description                                         |
| ------- | ---------------------- | --------------------------------------------------- |
| **0s**  | Circuit breaker starts | Waiting for first activity                          |
| **5s**  | Call executed          | Idle timer starts (10s countdown)                   |
| **15s** | **Idle Probe #1**      | First health check runs (10s after call)            |
| **25s** | **Idle Probe #2**      | Second health check runs (10s after previous probe) |
| **30s** | Call executed          | Timer cancelled and restarted                       |
| **40s** | **Idle Probe #3**      | Health check resumes (10s after call at 30s)        |

**Key points:**

- The **first probe** runs after the circuit breaker starts or after the last call completes (not immediately)
- **Subsequent probes** run at fixed intervals while the circuit stays idle
- A new call **interrupts** the idle timer and restarts it from zero
- If a health check fails, the circuit opens immediately

### Enabling Idle Health Checks

Enable idle health checks by setting the `idleProbeIntervalMs` option:

```typescript
const circuitBreaker = new CircuitBreaker({
  health: {
    backoff: new ConstantBackoff({ delayMs: 5000 }),
    async check(type: HealthCheckType, signal: AbortSignal) {
      await fetch("https://api.example.com/health", { signal });
    },
    idleProbeIntervalMs: 30_000, // Check every 30 seconds when idle
  },
});
```

## Handling AbortSignal and Timeouts

The `signal` parameter in health checks allows Zenvark to cancel ongoing health checks when needed (e.g., when the circuit breaker stops). Always pass it to async operations:

```typescript
import { HealthCheckType } from "zenvark";

// ✅ Good: Signal passed to fetch
async check(type: HealthCheckType, signal: AbortSignal) {
  const response = await fetch("https://api.example.com/health", { signal });
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
}

// ❌ Bad: Signal ignored
async check(type: HealthCheckType, signal: AbortSignal) {
  const response = await fetch("https://api.example.com/health");
  // Health check won't be cancellable
}
```
