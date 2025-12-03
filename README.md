# zenvark

A robust distributed circuit breaker, coordinated via Redis, designed for high-availability applications.
This library helps you build resilient systems by preventing cascading failures and gracefully handling degraded services.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Features](#features)
- [Quick Start](#quick-start)
- [CircuitBreaker API Reference](#circuitbreaker-api-reference)
- [Breaker Strategies](#breaker-strategies)
  - [ConsecutiveBreaker](#consecutivebreaker)
  - [CountBreaker](#countbreaker)
  - [SamplingBreaker](#samplingbreaker)
- [Backoff Strategies](#backoff-strategies)
  - [ConstantBackoff](#constantbackoff)
  - [ExponentialBackoff](#exponentialbackoff)
- [Idle Healthchecks](#idle-healthchecks)
- [Circuit States](#circuit-states)
- [Architecture](#architecture)
  - [Why Distributed?](#why-distributed)
  - [Distributed Coordination](#distributed-coordination)
  - [Event Processing Flow](#event-processing-flow)
- [Metrics & Observability](#metrics--observability)
  - [Prometheus Integration](#prometheus-integration)
- [Best Practices](#best-practices)

## Prerequisites

- **Node.js**: 22.x or higher
- **Redis**: 6.0 or higher (Redis Streams support required)

## Features

- **Distributed Coordination**: Multiple instances coordinate circuit state using Redis, ensuring consistent behavior across your services.
- **Multiple Breaker Strategies**: Choose from consecutive failures, sliding window, and time-based sampling to detect service unhealthiness.
- **Flexible Backoff Strategies**: Configure constant or exponential backoff for health checks, preventing service overload during recovery.
- **Leader Election**: Ensures a single instance is responsible for critical circuit state management and health checks, preventing race conditions.
- **Event-Driven**: Real-time state coordination and event processing powered by Redis Streams.
- **Prometheus Metrics**: Built-in observability with customizable labels for easy monitoring.

## Quick Start

```typescript
import { Redis } from "ioredis";
import { register } from "prom-client";
import {
	CircuitBreaker,
	ConsecutiveBreaker,
	ConstantBackoff,
	CircuitOpenError,
	HealthCheckType,
} from "zenvark";
import { PrometheusBreakerMetrics } from "@zenvark/prom";

const redis = new Redis("redis://localhost:6379");

const circuitBreaker = new CircuitBreaker({
	id: "my-service-api", // Unique ID for this circuit breaker
	redis,
	breaker: new ConsecutiveBreaker({ threshold: 5 }), // Open after 5 consecutive failures
	health: {
		backoff: new ConstantBackoff({ delayMs: 5000 }), // Wait 5 seconds between health checks
		async check(type: HealthCheckType, signal: AbortSignal) {
			// Your health check logic
			const response = await fetch("https://api.example.com/health", {
				signal,
			});
			if (!response.ok) throw new Error("Health check failed");
		},
		idleProbeIntervalMs: 30_000, // Run first probe 30s after last call, then every 30s while idle
	},
	onError(err: Error) {
		// Handle or log internal circuit breaker errors here to prevent unhandled exceptions.
		console.error("Circuit Breaker Internal Error:", err);
	},
	onRoleChange(role) {
		// Observe leader election role changes: 'leader' | 'follower'
		console.log("Circuit role changed to", role);
	},
	onStateChange(state) {
		// Observe state transitions across the cluster: 'open' | 'closed'
		console.log("Circuit state changed to", state);
	},
	metrics: new PrometheusBreakerMetrics({
		register, // Prometheus registry instance
		customLabels: { service: "my-api" }, // Add custom labels to your metrics
	}),
});

// Start the circuit breaker and its internal coordination mechanisms
await circuitBreaker.start();

// Execute operations protected by the circuit breaker
try {
	const result = await circuitBreaker.execute(async () => {
		// Your potentially failing operation
		return await fetch("http://api.example.com/data");
	});
	console.log("Success:", result);
} catch (err) {
	// `instanceof` for CircuitOpenError works reliably across realms
	if (err instanceof CircuitOpenError) {
		// Circuit is currently open – skipping request
	} else {
		// Underlying operation failed
	}
}

// Clean up resources when your application shuts down
await circuitBreaker.stop();
```

## CircuitBreaker API Reference

### Constructor

`new CircuitBreaker(options: CircuitBreakerOptions)`

The `CircuitBreakerOptions` object is where you configure your distributed circuit breaker's core behavior and integration points.

- `id`: **(Required)** A unique identifier for the circuit breaker instance (e.g., `'my-payment-service-api'`). Used as a key prefix in Redis for coordination data and as the `breaker_id` label in [Prometheus metrics](#prometheus-integration).
- `redis`: **(Required)** An initialized ioredis client instance. This client is used for all distributed coordination, leader election, and event streaming.
- `breaker`: **(Required)** The strategy that determines when the circuit should open due to failures. Refer to the [Breaker Strategies](#breaker-strategies) section for available options and their configurations.
- `health`: **(Required)** An object configuring how the circuit breaker performs health checks while the circuit is in the `OPEN` state.
  - `backoff`: **(Required)** The backoff strategy to use between health check retries. This introduces delays to prevent overwhelming a recovering dependency. Refer to the [Backoff Strategies](#backoff-strategies) section for available options and their configurations.
  - `check(type: HealthCheckType, signal: AbortSignal)`: **(Required)** An asynchronous function that executes the actual health check against your protected dependency. It **must throw an `Error`** on failure. The provided `AbortSignal` should be respected by your function for early cancellation during graceful shutdowns. The `type` argument will be either `recovery` (when probing while OPEN) or `idle` (when probing during inactivity while CLOSED), which can be used for routing to different health endpoints if desired.
- `onError(err: Error)`: **(Optional)** A callback for handling internal circuit breaker errors (e.g., Redis stream read failures, leader election issues). Highly recommended to provide this callback to prevent unhandled exceptions and maintain application stability.
- `onStateChange(state: CircuitState)`: **(Optional)** Notified whenever the circuit transitions to a new state (`open` or `closed`).
  - Triggered for both self-initiated and cross-instance updates via Redis Streams.
  - Not called during the initial state load on `start()`; only future changes trigger it.
  - Called only when the state actually changes (no duplicate notifications for the same state).
  - Useful for logging, alerts, and custom metrics.
- `onRoleChange(role: CircuitRole)`: **(Optional)** Notified whenever this instance's leader election role changes (`leader` or `follower`).
  - Not called during the initial role evaluation on `start()` unless it changes.
  - Called only when the role actually changes (no duplicate notifications for the same role).
  - Useful for logging.
- `metrics`: **(Optional)** An object for Prometheus metrics configuration, enabling built-in observability.
  - `register`: **(Required)** An instance of Prometheus `Registry`. The circuit breaker registers its metrics here for Prometheus to scrape.
  - `customLabels`: **(Optional)** An object of additional key-value labels (e.g., `{ service: 'my-api' }`) to attach to all generated metrics.

### Methods

#### `start(): Promise<void>`

This method starts the circuit breaker and its internal coordination mechanisms, including Redis stream subscriptions for distributed state coordination, the leader election process, and event processing for call results.

**You must call this method before using `execute()`.**

#### `stop(): Promise<void>`

This method stops the circuit breaker and cleans up all resources, including Redis stream subscriptions, leader election cleanup, and health check loop cancellation.

**You should call this method during application shutdown.**

#### `execute<T>(fn: () => Promise<T>): Promise<T>`

This method executes a function with circuit breaker protection.

**Behavior:**

- If the circuit is `CLOSED`: It executes the function and records the result.
- If the circuit is `OPEN`: It immediately throws a `CircuitOpenError` without executing the function.

**Parameters:**

- `fn`: The async function to execute with circuit breaker protection.

**Returns:** The result of the executed function.

**Throws:**

- `CircuitOpenError`: When the circuit is open.
- Any error thrown by the provided function.

> ⚠️ **Note:** The `execute()` method does **not** perform any retry logic on failure.
> If retries are needed, you must implement them externally by wrapping your calls to `execute()`.
> Native retry support will be added in a future release.

### Properties

#### `state: CircuitState`

This is a **read-only property** that returns the current state of the circuit breaker.

**Possible values:**

- `CircuitState.CLOSED`: The circuit is closed, and requests are allowed.
- `CircuitState.OPEN`: The circuit is open, and requests are blocked.

#### `role: CircuitRole`

This is a **read-only property** that returns the current leader election role of this instance.

**Possible values:**

- `CircuitRole.LEADER`: This instance currently holds leadership and will perform leader-only duties.
- `CircuitRole.FOLLOWER`: This instance is listens for events posted by the leader.

## Breaker Strategies

Circuit breakers use configurable strategies to determine when to open the circuit and block further calls to a failing dependency.
All strategies implement the `BreakerStrategy` interface:

```typescript
export interface BreakerStrategy {
	/**
	 * Check whether the circuit should open based on recent call results.
	 * @param events Array of CallResultEvent (ordered from oldest to newest)
	 * @returns boolean indicating if circuit should open
	 */
	shouldOpenCircuit(events: CallResultEvent[]): boolean;
}
```

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
	minimumNumberOfCalls: 10, // (Optional) Require at least 10 calls before evaluating
});
```

### SamplingBreaker

Opens the circuit when failure rate exceeds a threshold within a time-based window.

```typescript
import { SamplingBreaker } from "zenvark";

const breaker = new SamplingBreaker({
	threshold: 0.3, // Open if 30% of events in window failed
	duration: 60000, // 60 second evaluation window
	minimumNumberOfCalls: 5, // (Optional) Require at least 5 events before evaluating
});
```

## Backoff Strategies

Backoff strategies control how long the leader instance waits between health check attempts while the circuit is open.
This prevents hammering an unhealthy service and gives it time to recover.

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

> Note: The first health check (attempt = 1) is also delayed.

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
	maxDelayMs: 30000, // (Optional) Cap delays at 30 seconds
});
```

## Idle Healthchecks

You can configure the circuit breaker to perform periodic healthchecks while it is idle.
The first probe runs after the configured delay since the last call result,
and then repeats at the same interval until a new call arrives (which cancels the idle loop) or leadership is lost.

```ts
const circuitBreaker = new CircuitBreaker({
	// ...
	health: {
		backoff: new ConstantBackoff({ delayMs: 5000 }),
		async check(type: HealthCheckType, signal: AbortSignal) {
			/* ... */
		},
		idleProbeIntervalMs: 30_000, // Run probe 30s after last call; next probe scheduled after each run
	},
});
```

Behavior:

- Only the leader instance runs the idle healthcheck loop.
- After the last call result, the leader schedules a repeating healthcheck loop that runs every `idleProbeIntervalMs`.
- While no new calls arrive, the healthcheck runs on that interval continuously.
- If a healthcheck fails, the circuit transitions to OPEN and the regular backoff-based healthcheck loop begins to probe for recovery.
- Once a new call result is received, the idle healthcheck loop is immediately cancelled, pausing healthchecks until the circuit becomes idle again.

## Circuit States

The circuit breaker has two states:

- **`CLOSED`**: Requests are allowed to pass through to the protected dependency.
- **`OPEN`**: Requests to the protected dependency are immediately blocked to prevent further load. While open, the leader instance periodically runs health checks.

## Architecture

This distributed circuit breaker leverages Redis for its core coordination mechanisms.

### Why Distributed?

When multiple instances of an application are running concurrently (whether they are part of a microservice, a monolith scaled horizontally, or any other distributed setup), a traditional in-memory circuit breaker on a single instance isn't enough.
If one instance detects a problem and opens its circuit, other instances, unaware of the issue, might continue to send requests to the failing dependency.
A distributed circuit breaker ensures that if any one instance detects a problem and opens the circuit, all other instances become aware of this state change and also open their circuits.
This collective awareness prevents individual instances from continuing to hammer an unhealthy service, effectively stopping cascading failures and ensuring consistent resilience across all running instances of your application.

### Distributed Coordination

- **Leader Election**: Uses Redis to elect a single leader instance responsible for circuit state decisions
- **Event Streaming**: Call results (success/failure) from all instances are stored in Redis Streams for real-time coordination
- **State Synchronization**: All instances subscribe to Redis Streams to receive real-time updates on circuit state changes initiated by the leader, ensuring immediate and consistent behavior across your distributed application.

> **Further Reading**: For a deeper dive into how Redis Streams facilitate real-time data processing and coordination, refer to the [official Redis Streams documentation](https://redis.io/docs/latest/develop/data-types/streams/).

### Event Processing Flow

Here's a step-by-step overview of how the distributed circuit breaker operates:

1. **Record Call Results**: Each instance of your application records the outcome (success or failure) of protected calls into Redis Streams.
2. **Leader Evaluation**: The elected leader instance continuously processes these call results, evaluating them against the configured breaker strategy.
3. **Circuit Opens**: If the leader determines that the failure threshold has been breached, it broadcasts a command to open the circuit.
4. **State Synchronization**: All instances immediately receive this "open circuit" command via Redis Streams and begin blocking requests to the unhealthy dependency.
5. **Health Checks**: While the circuit is open, the leader instance starts running periodic health checks against the dependency, using the configured backoff strategy.
6. **Circuit Closes**: When a health check passes, the leader broadcasts a "close circuit" command. All instances receive this update, and normal operation (allowing requests) resumes.

## Metrics & Observability

Built-in Prometheus integration provides key metrics for monitoring the health and behavior of your circuit breakers.

### Prometheus Integration

The easiest way to add Prometheus metrics is using the `@zenvark/prom` package:

```bash
npm install @zenvark/prom prom-client
```

```typescript
import { CircuitBreaker } from "zenvark";
import { PrometheusBreakerMetrics } from "@zenvark/prom";
import { register } from "prom-client";

const metrics = new PrometheusBreakerMetrics({
	register,
	customLabels: { service: "my-api" },
});

const circuitBreaker = new CircuitBreaker({
	id: "my-service-api",
	// ... other config
	metrics,
});
```

**Available Metrics:**

| Metric                                 | Type      | Description                      | Labels                         |
| -------------------------------------- | --------- | -------------------------------- | ------------------------------ |
| `zenvark_call_duration_seconds`        | Histogram | Duration of protected calls      | `breaker_id`, `result`         |
| `zenvark_blocked_requests_total`       | Counter   | Requests blocked by open circuit | `breaker_id`                   |
| `zenvark_healthcheck_duration_seconds` | Histogram | Health check attempt duration    | `breaker_id`, `type`, `result` |

**Label Values:**

- `breaker_id`: The unique identifier for the circuit breaker instance (as defined by your id configuration).
- `type`: The type of health check performed (`recovery` or `idle`).
- `result`: Indicates the outcome of a call or health check (`success` or `failure`).
- `Custom labels`: Any additional key-value pairs provided in the `metrics.customLabels` configuration

## Best Practices

### 1. Circuit Breaker Naming

Use descriptive, unique IDs that reflect the protected resource:

```typescript
// ✅ Good
const circuitBreaker = new CircuitBreaker({
	id: "payment-gateway-stripe",
	// ...
});

// ❌ Bad
const circuitBreaker = new CircuitBreaker({
	id: "api",
	// ...
});
```

### 2. Error Handling

Always provide an error handler to prevent unhandled exceptions:

```typescript
const circuitBreaker = new CircuitBreaker({
	// ...
	onError: (err) => {
		logger.error("Circuit breaker error", err);
	},
});
```

### 3. Health Check Implementation

Keep health checks simple and focused:

```typescript
// ✅ Good - Simple, focused health check
async check(type: HealthCheckType, signal: AbortSignal) {
	const response = await fetch('/health', { signal })
	if (!response.ok) {
		throw new Error(`Health check failed: ${response.status}`)
	}
}

// ❌ Bad - Complex health check with side effects
async check(type: HealthCheckType, signal: AbortSignal) {
	const user = await createTestUser()
	const result = await processPayment(user, 1.00)
	await deleteTestUser(user)
	if (!result.success) throw new Error('Health check failed')
}
```

### 4. Resource Management

Always clean up resources:

```typescript
// Proper lifecycle management
const circuitBreaker = new CircuitBreaker(config);

// Start the circuit breaker
await circuitBreaker.start();

// Application logic...

// Clean shutdown
process.on("SIGTERM", async () => {
	await circuitBreaker.stop();
	process.exit(0);
});
```

## Development

### Interactive Terminal Simulator (TUI)

For local development and demos, this package includes a small Ink-based terminal UI that simulates two distributed circuit breaker instances coordinating via Redis.
It lets you trigger successes/failures, toggle health check outcomes, and observe leader election and state transitions in real time.

Start Redis locally:

```bash
npm run docker:start:dev
```

Run the terminal simulator:

```bash
npm run start:terminal-ui
```

Controls in the UI:

- Tab / Shift+Tab: move focus between controls
- Enter / Space: activate focused control
- q / Esc / Ctrl+C: quit
- Healthcheck returns: switch between Success and Failure to simulate dependency recovery/failure
- Circuit A/B → Start/Stop: start or stop each instance
- Circuit A/B → Trigger Success/Failure: emit call results to drive the breaker

What you’ll see:

- Two instances (A and B) sharing the same breaker id coordinate via Redis
- Leader/Follower role changes
- Circuit state transitions (OPEN/CLOSED)
- Idle probes and recovery backoff when open

Notes:

- This simulator is for development only. It uses a hardcoded Redis password and connects to `localhost:6379`.

Cleanup:

```bash
npm run docker:stop:dev
```
