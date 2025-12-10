---
sidebar_position: 2
---

# Types & Errors

This page documents the types, enums, and error classes exported by Zenvark.

## Errors

### CircuitOpenError

Error thrown when attempting to execute a function while the circuit is open.

#### Import

```typescript
import { CircuitOpenError } from "zenvark";
```

#### Usage

```typescript
import { CircuitBreaker, CircuitOpenError } from "zenvark";

try {
  const result = await circuitBreaker.execute(async () => {
    return await fetch("https://api.example.com/data");
  });
} catch (err) {
  if (err instanceof CircuitOpenError) {
    // Circuit is open - request was blocked
    console.log("Circuit breaker is open, using fallback");
    return getFallbackData();
  }
  // Other error - the operation itself failed
  throw err;
}
```

#### Properties

- **`name`** `string` - Always `"CircuitOpenError"`
- **`message`** `string` - Error message describing that the circuit is open

#### Type Checking

The `instanceof` check works reliably across realms and module boundaries:

```typescript
if (err instanceof CircuitOpenError) {
  // Handle circuit open scenario
}
```

## Enums

### CircuitState

Represents the current state of the circuit breaker.

#### Import

```typescript
import { CircuitState } from "zenvark";
```

#### Values

- **`CircuitState.CLOSED`** - The circuit is closed and requests are allowed through
- **`CircuitState.OPEN`** - The circuit is open and requests are blocked

#### Usage

```typescript
import { CircuitBreaker, CircuitState } from "zenvark";

const circuitBreaker = new CircuitBreaker({
  // ...
  onStateChange: (state) => {
    if (state === CircuitState.OPEN) {
      console.log("Circuit opened - service is unhealthy");
    } else if (state === CircuitState.CLOSED) {
      console.log("Circuit closed - service recovered");
    }
  },
});

// Check current state
if (circuitBreaker.state === CircuitState.OPEN) {
  // Use fallback logic
}
```

See [Circuit States](../guides/circuit-states.md) for more information.

---

### CircuitRole

Represents the leader election role of a circuit breaker instance.

#### Import

```typescript
import { CircuitRole } from "zenvark";
```

#### Values

- **`CircuitRole.LEADER`** - This instance is the leader and performs health checks
- **`CircuitRole.FOLLOWER`** - This instance follows the leader's state updates

#### Usage

```typescript
import { CircuitBreaker, CircuitRole } from "zenvark";

const circuitBreaker = new CircuitBreaker({
  // ...
  onRoleChange: (role) => {
    if (role === CircuitRole.LEADER) {
      console.log("This instance became the leader");
    } else if (role === CircuitRole.FOLLOWER) {
      console.log("This instance is now a follower");
    }
  },
});

// Check current role
if (circuitBreaker.role === CircuitRole.LEADER) {
  // This instance is performing health checks
}
```

See [Architecture](../guides/architecture.md#leader-election) for more information.

---

### HealthCheckType

Indicates the reason for a health check execution.

#### Import

```typescript
import { HealthCheckType } from "zenvark";
```

#### Values

- **`HealthCheckType.RECOVERY`** - Health check while circuit is open, attempting to recover
- **`HealthCheckType.IDLE`** - Proactive health check while circuit is closed but idle

#### Usage

```typescript
import { CircuitBreaker, HealthCheckType } from "zenvark";

const circuitBreaker = new CircuitBreaker({
  // ...
  health: {
    backoff: new ConstantBackoff({ delayMs: 5000 }),
    async check(type: HealthCheckType, signal: AbortSignal) {
      if (type === HealthCheckType.RECOVERY) {
        // More thorough health check during recovery
        await fetch("https://api.example.com/health/deep", { signal });
      } else if (type === HealthCheckType.IDLE) {
        // Lightweight health check during idle periods
        await fetch("https://api.example.com/health", { signal });
      }
    },
  },
});
```

See [Health Checks](../guides/healthchecks.md) for more information.

## Interfaces

### BreakerStrategy

Interface for implementing custom breaker strategies.

```typescript
interface BreakerStrategy {
  shouldOpenCircuit(events: CallResultEvent[]): boolean;
}
```

See [Breaker Strategies](../strategies/breaker-strategies.md#custom-strategies) for implementation examples.

### BackoffStrategy

Interface for implementing custom backoff strategies.

```typescript
interface BackoffStrategy {
  getDelayMs(attempt: number): number;
}
```

See [Backoff Strategies](../strategies/backoff-strategies.md#custom-strategies) for implementation examples.

### BreakerMetrics

Interface for implementing custom metrics collection.

```typescript
interface BreakerMetrics {
  recordCall(result: CallResult): void;
  recordBlockedRequest(): void;
  recordHealthCheck(result: HealthCheckResult): void;
}
```

See [Metrics & Observability](../guides/metrics.md#custom-metrics-implementation) for implementation examples.

## Type Aliases

### CallResult

Represents the result of a protected call execution.

```typescript
type CallResult = {
  success: boolean;
  durationMs: number;
};
```

Used in custom metrics implementations to record call outcomes.

### HealthCheckResult

Represents the result of a health check execution.

```typescript
type HealthCheckResult = {
  type: HealthCheckType;
  success: boolean;
  durationMs: number;
};
```

Used in custom metrics implementations to record health check outcomes.