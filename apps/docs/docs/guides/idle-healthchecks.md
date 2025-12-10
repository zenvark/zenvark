---
sidebar_position: 3
---

# Idle Healthchecks

Idle healthchecks allow the circuit breaker to proactively monitor service health during periods of inactivity, even when the circuit is closed.

## Overview

When a circuit is closed but idle (no recent calls), idle healthchecks provide early detection of service degradation before the next request arrives.

### Benefits

- **Proactive monitoring**: Detect issues before they affect requests
- **Faster failover**: Circuit opens immediately when health degrades
- **Reduced latency**: First request doesn't wait for failure
- **Better user experience**: Prevents serving failed requests during degradation

## Configuration

Enable idle healthchecks by setting the `idleProbeIntervalMs` option:

```typescript
const circuitBreaker = new CircuitBreaker({
  health: {
    idleProbeIntervalMs: 30_000, // Check every 30 seconds when idle
  },
});
```

## Behavior

### Timing

1. **First probe**: Runs `idleProbeIntervalMs` after the last call result
2. **Subsequent probes**: Run every `idleProbeIntervalMs` while idle
3. **Cancellation**: Stops when a new call arrives

### Example Timeline

```
Time:     0s        30s       60s       90s      95s      125s
          |         |         |         |        |        |
Events:   Last      Idle      Idle      Idle     New      Idle
          Call      Probe     Probe     Probe    Call     Probe

          └─30s─────┘         │         │        Cancel   └─30s─
                    └─30s─────┘         │        Restart
                              └─30s─────┘        Timer
```

## Health Check Types

The health check function receives a `type` parameter indicating the reason for the check:

### recovery

Used when the circuit is **open** and attempting to recover:

- Circuit is in OPEN state
- Uses backoff strategy for delays
- Performed only by the leader instance

### idle

Used when the circuit is **closed** but idle:

- Circuit is in CLOSED state
- Uses fixed `idleProbeIntervalMs` interval
- Performed only by the leader instance

### Using the Type Parameter

You can route to different health endpoints based on the type:

```typescript
import { CircuitBreaker, HealthCheckType, ExponentialBackoff } from "zenvark";

const circuitBreaker = new CircuitBreaker({
  // ...
  health: {
    backoff: new ExponentialBackoff({ initialDelayMs: 1000, multiplier: 2 }),
    async check(type: HealthCheckType, signal: AbortSignal) {
      if (type === HealthCheckType.RECOVERY) {
        // More thorough check during recovery
        await fetch("https://api.example.com/health/deep", { signal });
      } else {
        // Lightweight check during idle
        await fetch("https://api.example.com/health", { signal });
      }
    },
    idleProbeIntervalMs: 30_000,
  },
});
```

## Leader-Only Behavior

:::info
Only the **leader instance** runs idle healthchecks. Follower instances wait for state updates from the leader.
:::

This design:

- Prevents duplicate health checks
- Reduces load on the protected service
- Centralizes health monitoring
- Ensures consistent behavior

## Disabling Idle Healthchecks

To disable idle healthchecks, simply omit the `idleProbeIntervalMs` option:

```typescript
const circuitBreaker = new CircuitBreaker({
  // ...
  health: {
    backoff: new ConstantBackoff({ delayMs: 5000 }),
    async check(type, signal) {
      // Only called during recovery (when circuit is OPEN)
      await healthCheck(signal);
    },
    // No idleProbeIntervalMs - idle checks disabled
  },
});
```
