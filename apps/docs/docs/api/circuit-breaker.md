---
sidebar_position: 1
---

# CircuitBreaker

The main class for creating and managing circuit breakers.

## Constructor

```typescript
new CircuitBreaker(options: CircuitBreakerOptions)
```

### CircuitBreakerOptions

Configuration object for the circuit breaker.

#### Required Options

- **`id`** `string`

  A unique identifier for the circuit breaker instance (e.g., `'my-payment-service-api'`). Used as a key prefix in Redis for coordination data and as the `breaker_id` label in Prometheus metrics.

- **`redis`** `Redis`

  An initialized ioredis client instance. This client is used for all distributed coordination, leader election, and event streaming.

- **`breaker`** `BreakerStrategy`

  The strategy that determines when the circuit should open due to failures. See [Breaker Strategies](../strategies/breaker-strategies.md) for available options.

- **`health`** `HealthConfig`

  Configuration for health checks while the circuit is in the `OPEN` state.
  - **`backoff`** `BackoffStrategy` - Strategy for delays between health check retries. See [Backoff Strategies](../strategies/backoff-strategies.md).
  - **`check`** `(type: HealthCheckType, signal: AbortSignal) => Promise<void>` - Async function that executes the health check. Must throw an `Error` on failure. The `signal` should be respected for early cancellation.
  - **`idleProbeIntervalMs`** `number` (optional) - Interval in milliseconds for idle health checks when circuit is closed and inactive.

#### Optional Options

- **`onError`** `(err: Error) => void`

  Callback for handling internal circuit breaker errors (e.g., Redis stream read failures, leader election issues). Highly recommended to prevent unhandled exceptions.

- **`onStateChange`** `(state: CircuitState) => void`

  Notified when the circuit transitions to a new state (`CircuitState.OPEN` or `CircuitState.CLOSED`).
  - Triggered for both self-initiated and cross-instance updates
  - Not called during initial state load on `start()`
  - Only called when state actually changes
  - Useful for logging, alerts, and custom metrics

- **`onRoleChange`** `(role: CircuitRole) => void`

  Notified when this instance's leader election role changes (`CircuitRole.LEADER` or `CircuitRole.FOLLOWER`).
  - Not called during initial role evaluation on `start()`
  - Only called when role actually changes
  - Useful for logging

- **`metrics`** `BreakerMetrics`

  Prometheus metrics configuration for built-in observability. See [Metrics & Observability](../guides/metrics.md).

## Methods

### start()

```typescript
start(): Promise<void>
```

Starts the circuit breaker and its internal coordination mechanisms, including:

- Redis stream subscriptions for distributed state coordination
- Leader election process
- Event processing for call results

**You must call this method before using `execute()`.**

### stop()

```typescript
stop(): Promise<void>
```

Stops the circuit breaker and cleans up all resources, including:

- Redis stream subscriptions
- Leader election cleanup
- Health check loop cancellation

**You should call this method during application shutdown.**

### execute()

```typescript
execute<T>(fn: () => Promise<T>): Promise<T>
```

Executes a function with circuit breaker protection.

#### Behavior

- If the circuit is `CLOSED`: Executes the function and records the result
- If the circuit is `OPEN`: Immediately throws a `CircuitOpenError` without executing the function

#### Parameters

- **`fn`** - The async function to execute with circuit breaker protection

#### Returns

The result of the executed function.

#### Throws

- `CircuitOpenError` - When the circuit is open
- Any error thrown by the provided function

:::warning
The `execute()` method does **not** perform any retry logic on failure. If retries are needed, you must implement them externally by wrapping your calls to `execute()`. See the [Best Practices](../guides/best-practices.md) guide for retry implementation patterns.
:::

## Properties

### state

```typescript
readonly state: CircuitState
```

Returns the current state of the circuit breaker.

**Possible values:**

- `CircuitState.CLOSED` - The circuit is closed, and requests are allowed
- `CircuitState.OPEN` - The circuit is open, and requests are blocked

### role

```typescript
readonly role: CircuitRole
```

Returns the current leader election role of this instance.

**Possible values:**

- `CircuitRole.LEADER` - This instance currently holds leadership and will perform leader-only duties
- `CircuitRole.FOLLOWER` - This instance listens for events posted by the leader
