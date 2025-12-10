---
sidebar_position: 2
---

# Types & Errors

This page documents the types, enums, and error classes exported by Zenvark.

## Errors

### CircuitOpenError

Error thrown when attempting to execute a function while the circuit is open.

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

---

### CallResult

Represents the outcome of a protected call execution.

#### Values

- **`CallResult.SUCCESS`** - The call completed successfully
- **`CallResult.FAILURE`** - The call failed

#### Usage

```typescript
import { CircuitBreaker, CallResult } from "zenvark";

const circuitBreaker = new CircuitBreaker({
  // ...
  metrics: {
    recordCall(params) {
      if (params.result === CallResult.SUCCESS) {
        console.log(`Success in ${params.durationMs}ms`);
      } else {
        console.log(`Failure in ${params.durationMs}ms`);
      }
    },
  },
});
```

## Interfaces & types

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

### BreakerMetricsRecorder

Interface for implementing custom metrics collection.

```typescript
interface BreakerMetricsRecorder {
  initialize?(breakerId: string): void;
  recordCall(params: RecordCallParams): void;
  recordBlockedRequest(params: RecordBlockedRequestParams): void;
  recordHealthCheck(params: RecordHealthCheckParams): void;
}
```

See [Metrics & Observability](../guides/metrics.md#custom-metrics-implementation) for implementation examples.

### CallResultEvent

Represents a call execution event with timing and outcome information.

```typescript
type CallResultEvent = {
  id: string;
  callResult: CallResult;
  timestamp: number;
};
```

Used in breaker strategies to evaluate call history and determine if the circuit should open.

### RecordCallParams

Parameters for recording a call execution.

```typescript
type RecordCallParams = {
  breakerId: string;
  result: CallResult;
  durationMs: number;
};
```

Used by `BreakerMetricsRecorder.recordCall()` to record successful or failed calls.

### RecordBlockedRequestParams

Parameters for recording a blocked request.

```typescript
type RecordBlockedRequestParams = {
  breakerId: string;
};
```

Used by `BreakerMetricsRecorder.recordBlockedRequest()` when requests are blocked due to an open circuit.

### RecordHealthCheckParams

Parameters for recording a health check execution.

```typescript
type RecordHealthCheckParams = {
  breakerId: string;
  type: HealthCheckType;
  result: CallResult;
  durationMs: number;
};
```

Used by `BreakerMetricsRecorder.recordHealthCheck()` to record health check attempts.
