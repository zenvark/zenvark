# @zenvark/semaphore

An adaptive distributed semaphore, coordinated via Redis. Bounds the number of simultaneous operations across a whole fleet of processes against a shared external constraint whose true ceiling is unknown, variable, or shared with other consumers — the canonical example being a third-party API rate limit shared by one API key.

Where the [Zenvark Circuit Breaker](https://www.npmjs.com/package/zenvark) is reactive (it cuts callers off from a dependency that is already failing), the semaphore is proactive: it discovers how much concurrency the dependency actually tolerates and holds the fleet just under that ceiling.

## Features

- 🌐 **Distributed Leases** - One Redis-backed count of in-flight operations, enforced fleet-wide rather than per process
- 📈 **AIMD Adaptation** - Capacity converges toward the real ceiling from caller-reported outcomes; no rate number to keep in sync with provider contracts
- 🎟️ **Priority Classes** - Optional reserved capacity shares, so latency-sensitive callers are never fully crowded out by bulk callers
- 💓 **Crash-Safe Holds** - Leases carry a TTL and auto-renew while held; slots owned by crashed processes return to the pool within one TTL
- 🧩 **Composes with the Circuit Breaker** - Designed to guard the same call as a zenvark `CircuitBreaker` without the two distorting each other's signals
- 📊 **Prometheus Metrics** - Built-in observability with [@zenvark/prom](https://www.npmjs.com/package/@zenvark/prom)

## Installation

```bash
npm install @zenvark/semaphore ioredis
```

## Quick Start

```typescript
import { Redis } from "ioredis";
import { AdaptiveSemaphore, LeaseOutcome } from "@zenvark/semaphore";

const redis = new Redis("redis://localhost:6379");

const semaphore = new AdaptiveSemaphore({
  id: "my-provider-api",
  redis,
  initialLimit: 10,
  minLimit: 2,
  maxLimit: 1000,
  onError: (err) => console.error("Semaphore error:", err),
});

// No start step — construction is passive. The first acquire seeds the
// fleet-wide limit in Redis; everything else adapts from there.

// Wrapper form: acquires a slot, runs the callback, releases with the
// right outcome. `classifyError` decides which errors count as throttling.
const result = await semaphore.withLease(
  { timeoutMs: 30_000, classifyError: (err) => isRateLimitError(err) },
  () => callProvider(),
);

// On shutdown (optional): aborts any acquires still waiting for a slot.
// Held leases lapse by TTL; nothing else needs tearing down.
semaphore.dispose();
```

The explicit form gives full control over the release outcome:

```typescript
const lease = await semaphore.acquire({ timeoutMs: 10_000 });
try {
  const result = await callProvider();
  await lease.release(LeaseOutcome.SUCCESS);
  return result;
} catch (err) {
  await lease.release(
    isRateLimitError(err) ? LeaseOutcome.THROTTLED : LeaseOutcome.FAILURE,
  );
  throw err;
}
```

## How It Works

The semaphore maintains a single fleet-wide capacity `L`, the maximum number of concurrently held leases. `L` starts at `initialLimit` and moves within `[minLimit, maxLimit]` under AIMD (additive increase, multiplicative decrease) control, driven entirely by outcomes callers report on release:

- **On `THROTTLED`** (the remote constraint pushed back): `L` is multiplied by `decreaseFactor` (default 0.5), at most once per `cooldownMs` — a remote throttle typically fails many concurrent calls at once and must count as one event, not many.
- **On demand at the cap** (an acquire was denied) with no throttle in the window: `L` grows by `increaseStep` (default 1), at most once per `windowMs`. Capacity never inflates while traffic is quiet.
- **On `FAILURE`** (errored for unrelated reasons): neutral, no adaptation.

The steady state is a sawtooth just under the real ceiling. The library never inspects errors; mapping errors to `THROTTLED` is entirely the caller's classifier.

## Options

### Constructor

| Option          | Type                          | Default         | Description                                                                                                                                                 |
| --------------- | ----------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `string`                      | (required)      | Names one independently limited resource. All Redis keys live under `zenvark:${id}:*`. Granularity is your choice (per provider, per API key, per tenant…). |
| `redis`         | `Redis`                       | (required)      | An `ioredis` instance, used as-is (no `duplicate()`; the semaphore only issues request/response commands). Safe to share with a `CircuitBreaker`.           |
| `initialLimit`  | `number`                      | (required)      | Starting capacity. Pick a conservative value; AIMD converges from there.                                                                                    |
| `minLimit`      | `number`                      | `1`             | Floor for multiplicative decreases.                                                                                                                         |
| `maxLimit`      | `number`                      | (required)      | Hard ceiling for additive increases. A runaway guard, not a tuning knob.                                                                                    |
| `leaseTtlMs`    | `number`                      | `30_000`        | Lease TTL. Held leases auto-renew at 80% of the TTL; a crashed holder's slot returns within one TTL.                                                        |
| `aimd`          | `AimdOptions`                 | see below       | Adaptation constants. Consumers normally omit the whole block.                                                                                              |
| `classes`       | `Record<string, ClassConfig>` | `{}`            | Named priority classes, each with an optional `reservedShare` (0–1). See [Priority classes](#priority-classes).                                             |
| `onUnavailable` | `'throw'` \| fallback gate    | `'throw'`       | Behavior when Redis is unreachable: fail closed, or delegate to a caller-supplied fallback (e.g. a fixed in-process limit).                                 |
| `metrics`       | `SemaphoreMetricsRecorder`    | –               | Metrics hook; use `PrometheusSemaphoreMetrics` from `@zenvark/prom`.                                                                                        |
| `onError`       | `(err: Error) => void`        | `console.error` | All internal errors surface here, wrapped with context and `cause`.                                                                                         |
| `onLimitChange` | `(limit: number) => void`     | –               | Plain callback for logging limit changes, mirroring the breaker's `onStateChange`.                                                                          |

### `aimd` block

| Option           | Default  | Description                                                                                                         |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `decreaseFactor` | `0.5`    | Multiplier applied to `L` on a throttle. Soften to 0.7–0.8 if halving causes throughput collapse on bursty traffic. |
| `increaseStep`   | `1`      | Additive step when the window saw demand at the cap and no throttles.                                               |
| `windowMs`       | `5_000`  | Increase evaluation window: at most one increase per window.                                                        |
| `cooldownMs`     | `10_000` | Decrease cooldown: at most one decrease per cooldown, so one burst of correlated throttles counts once.             |

### `acquire(options)`

| Option      | Type          | Default    | Description                                                                                               |
| ----------- | ------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| `class`     | `string`      | –          | Priority class to acquire under. Must be one of the configured `classes` keys.                            |
| `timeoutMs` | `number`      | (required) | Maximum time to wait for a slot (jittered polling inside). On expiry, rejects with `AcquireTimeoutError`. |
| `signal`    | `AbortSignal` | –          | Optional cancellation for the wait.                                                                       |

Returns a `Lease` with `release(outcome: LeaseOutcome)`. `withLease(options, fn)` takes the same options plus `classifyError: (err: unknown) => boolean` (should this error count as `THROTTLED`?) and handles release for you.

Waiting is jittered polling, not FIFO — waiter fairness is a documented non-goal; put your fairness layer (e.g. a queue) upstream.

## Priority Classes

A class with a `reservedShare` gets a slice of capacity that other classes can never occupy. Every class is capped at `L` minus the sum of the _other_ classes' reserved slices, so the guarantee holds pairwise with any number of reserved classes:

```typescript
const semaphore = new AdaptiveSemaphore({
  id: "my-provider-api",
  redis,
  initialLimit: 20,
  maxLimit: 1000,
  classes: {
    interactive: { reservedShare: 0.25 }, // may use full L
    background: {}, // capped at L - ceil(0.25 * L)
  },
});

await semaphore.withLease(
  { class: "interactive", timeoutMs: 10_000, classifyError: isRateLimitError },
  () => callProvider(),
);
```

Reservation is one-directional by design: leases cannot be preempted, so the reserve is never lent out. The cost is that the reserved slice idles when its class has no traffic — the price of a hard latency floor for that class.

## Composing with CircuitBreaker

When both primitives guard the same call, acquire the lease **outside** and run the breaker **inside**:

```typescript
import { CircuitBreaker, CircuitState, CircuitOpenError } from "zenvark";

// Optional fast-path: skip the lease wait when the circuit is already open.
if (breaker.state === CircuitState.OPEN)
  throw new CircuitOpenError("my-provider-api");

const result = await semaphore.withLease(
  { class: "interactive", timeoutMs: 10_000, classifyError: isRateLimitError },
  () => breaker.execute(() => callProvider()),
);
```

This order is a contract, not a style choice: if the lease were acquired inside `execute`, every capacity timeout under saturation would be recorded as a breaker failure, and sustained demand above the limit would open the circuit — a self-inflicted outage caused by the limiter doing its job. With the lease outermost, capacity pressure and dependency health stay independent signals, and real provider errors still feed both primitives correctly on the way out.

## Failure Semantics

If Redis is unreachable, `onUnavailable` decides: `'throw'` fails closed, or a caller-supplied fallback gate (such as a fixed per-process limit) fails open. Every degraded-mode event is reported through `onError`. State is self-healing after recovery: stale leases expire by TTL and `L` resumes adapting from its persisted value.

## Non-Goals

- Not a rate limiter: concurrency only, no tokens per second or sliding windows.
- Not a queue and not FIFO-fair among waiters.
- No error inspection: outcome classification belongs to the caller.
- One Redis (or cluster with hash-tagged keys) per deployment — the same assumption the circuit breaker makes.

## Prerequisites

- Node.js 22.x or higher
- Redis 6.0 or higher

## License

MIT
