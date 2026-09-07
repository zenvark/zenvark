---
sidebar_position: 2
---

# Enums & Errors

This page documents the enums and error classes exported by Zenvark.

## Errors

Every error Zenvark throws extends `ZenvarkError`, which itself extends `Error`. Each concrete class carries a stable `code` string and a typed `details` object, so handlers can branch on the code or inspect the context without parsing messages.

### ZenvarkError

Abstract base class for all Zenvark errors. Not thrown directly.

#### Properties

- **`name`** `string` - The concrete class name, for example `"CircuitOpenError"`
- **`message`** `string` - Human-readable description
- **`code`** `string` - Stable, literal-typed identifier. See the table below.
- **`details`** `object` - Structured context specific to the error class
- **`cause`** `unknown` - The underlying error, when one exists

#### Static methods

- **`ZenvarkError.isZenvarkError(value)`** - Type guard matching any Zenvark error
- **`<ErrorClass>.isInstance(value)`** - Type guard on each concrete class, for example `CircuitOpenError.isInstance(err)`
- **`<ErrorClass>.code`** - The class's code as a static property, for example `CircuitOpenError.code`

### Error classes

| Class                       | `code`                      | `details`                                                    | Thrown by                                                                                                                               |
| --------------------------- | --------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `CircuitOpenError`          | `CIRCUIT_IS_OPEN`           | `{ circuitId: string }`                                      | `CircuitBreaker.execute()` when the circuit is open. Also aborts a pending semaphore acquire if the circuit opens mid-wait.             |
| `AcquireTimeoutError`       | `SEMAPHORE_ACQUIRE_TIMEOUT` | `{ semaphoreId: string; timeoutMs: number; class?: string }` | `AdaptiveSemaphore.acquire()` and `withLease()` when no slot becomes free within `timeoutMs`. Also thrown in local-limit fallback mode. |
| `SemaphoreUnavailableError` | `SEMAPHORE_UNAVAILABLE`     | `{ semaphoreId: string }`, with the Redis error as `cause`   | `AdaptiveSemaphore.acquire()` when Redis is unreachable and `onUnavailable` is `'throw'`.                                               |
| `SemaphoreDisposedError`    | `SEMAPHORE_DISPOSED`        | `{ semaphoreId: string }`                                    | `AdaptiveSemaphore.acquire()` after `dispose()`. Also aborts acquires that were waiting when `dispose()` was called.                    |

### Checking for an error

Prefer the static `isInstance()` guard over `instanceof`. It narrows the type the same way, and it also matches errors whose prototype chain cannot be trusted: two copies of `zenvark` resolved in `node_modules`, or an error crossing a realm boundary such as a worker thread or VM context. It works by checking a shared `Symbol.for` brand together with the error `code`, so it does not depend on class identity.

```typescript
import { CircuitBreaker, CircuitOpenError } from "zenvark";

try {
  const result = await circuitBreaker.execute(async () => {
    return await fetch("https://api.example.com/data");
  });
} catch (err) {
  if (CircuitOpenError.isInstance(err)) {
    // Circuit is open - request was blocked
    console.log(`Circuit ${err.details.circuitId} is open, using fallback`);
    return getFallbackData();
  }
  // Other error - the operation itself failed
  throw err;
}
```

`instanceof` keeps working in the common single-copy case, and existing code that uses it does not need to change.

### Handling several errors

When one handler deals with several Zenvark errors, check each class with its `isInstance()` guard. Every branch narrows `err` to that class, so `err.details` has the exact shape for that error and `err.code` is its literal type.

```typescript
import {
  AcquireTimeoutError,
  SemaphoreDisposedError,
  SemaphoreUnavailableError,
} from "zenvark";

try {
  await semaphore.withLease({ timeoutMs: 2_000 }, doWork);
} catch (err) {
  if (AcquireTimeoutError.isInstance(err)) {
    // Saturated - shed load or retry with backoff
    metrics.timeout(err.details.class ?? "default", err.details.timeoutMs);
  } else if (SemaphoreUnavailableError.isInstance(err)) {
    // Redis is down - err.cause holds the connection error
    logger.error({ semaphoreId: err.details.semaphoreId, cause: err.cause });
  } else if (SemaphoreDisposedError.isInstance(err)) {
    // Programming error - the semaphore was disposed while in use
    throw err;
  } else {
    // Not a Zenvark error - the operation itself failed
    throw err;
  }
}
```

Use `ZenvarkError.isZenvarkError(err)` only when you do not care which error it is, for example to log `code` and `details` generically. After that guard `err.code` is a plain `string` and `err.details` is an untyped record.

### Logging

`code` and `details` are plain enumerable fields, so structured loggers pick them up without extra work:

```typescript
logger.warn({ code: err.code, ...err.details, err }, err.message);
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
  onStateChange: (state: CircuitState) => {
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
  onRoleChange: (role: CircuitRole) => {
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
import { BreakerMetricsRecorder, CallResult, RecordCallParams } from "zenvark";

class CustomMetrics implements BreakerMetricsRecorder {
  recordCall(params: RecordCallParams): void {
    if (params.result === CallResult.SUCCESS) {
      console.log(`Success in ${params.durationMs}ms`);
    } else if (params.result === CallResult.FAILURE) {
      console.log(`Failure in ${params.durationMs}ms`);
    }
  }
}
```
