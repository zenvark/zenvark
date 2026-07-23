---
sidebar_position: 5
---

# Adaptive Semaphore

The adaptive semaphore bounds the number of simultaneous operations across a fleet of processes against an external constraint whose real ceiling is unknown or variable — for example, a third-party API rate limit shared by one API key.

Where the circuit breaker is reactive (it cuts callers off from a dependency that is already failing), the semaphore is proactive: it adapts a fleet-wide concurrency limit to what the dependency can actually handle. The two work independently or [combined](#combining-with-the-circuit-breaker).

## Quick Start

```typescript
import { Redis } from "ioredis";
import { AdaptiveSemaphore, LeaseOutcome } from "zenvark";

const redis = new Redis("redis://localhost:6379");

const semaphore = new AdaptiveSemaphore({
  id: "my-provider-api",
  redis,
  initialLimit: 10,
  onError: (err) => console.error("Semaphore error:", err),
});

// No start step — construction is passive. The first acquire seeds the
// fleet-wide limit in Redis; everything else adapts from there.

// Wrapper form: acquires a slot, runs the callback, releases with the
// right outcome. `outcomeOnError` maps a thrown error to the outcome
// the lease is released with.
const result = await semaphore.withLease(
  {
    timeoutMs: 30_000,
    outcomeOnError: (err) =>
      isRateLimitError(err) ? LeaseOutcome.THROTTLED : LeaseOutcome.FAILURE,
  },
  () => callProvider(),
);

// On shutdown (optional): aborts any acquires still waiting for a slot.
// Held leases lapse by TTL; nothing else needs tearing down.
semaphore.dispose();
```

The explicit form gives you the lease directly:

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

The steady state is a sawtooth just under the real ceiling. The library never inspects errors; mapping errors to outcomes is entirely the caller's `outcomeOnError` classifier.

## Options

### Constructor

| Option          | Type                                   | Default         | Description                                                                                                                                                 |
| --------------- | -------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `string`                               | (required)      | Names one independently limited resource. All Redis keys live under `zenvark:${id}:*`. Granularity is your choice (per provider, per API key, per tenant…). |
| `redis`         | `Redis`                                | (required)      | An `ioredis` instance, used as-is (no `duplicate()`; the semaphore only issues request/response commands). Safe to share with a `CircuitBreaker`.           |
| `initialLimit`  | `number`                               | (required)      | Starting capacity. Pick a conservative value; AIMD converges from there.                                                                                    |
| `minLimit`      | `number`                               | `1`             | Floor for multiplicative decreases.                                                                                                                         |
| `maxLimit`      | `number`                               | `1000`          | Hard ceiling for additive increases. A runaway guard, not a tuning knob.                                                                                    |
| `leaseTtlMs`    | `number`                               | `30_000`        | Lease TTL. Held leases auto-renew at 80% of the TTL; a crashed holder's slot returns within one TTL.                                                        |
| `aimd`          | `AimdOptions`                          | see below       | Adaptation constants. Consumers normally omit the whole block.                                                                                              |
| `classes`       | `Record<string, SemaphoreClassConfig>` | `{}`            | Named priority classes, each with an optional `reservedShare` (0–1). See [Priority classes](#priority-classes).                                             |
| `onUnavailable` | `'throw'` \| `{ localLimit }`          | `'throw'`       | Behavior when Redis is unreachable: fail closed (rejects with `SemaphoreUnavailableError`), or fall back to a fixed per-process concurrency cap.            |
| `metrics`       | `SemaphoreMetricsRecorder`             | –               | Metrics hook; use `PrometheusSemaphoreMetrics` from `@zenvark/prom`.                                                                                        |
| `onError`       | `(err: Error) => void`                 | `console.error` | All internal errors surface here, wrapped with context and `cause`.                                                                                         |
| `onLimitChange` | `(limit: number) => void`              | –               | Plain callback for logging limit changes, mirroring the breaker's `onStateChange`.                                                                          |

### `aimd` block

| Option           | Default  | Description                                                                                                         |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `decreaseFactor` | `0.5`    | Multiplier applied to `L` on a throttle. Soften to 0.7–0.8 if halving causes throughput collapse on bursty traffic. |
| `increaseStep`   | `1`      | Additive step when the window saw demand at the cap and no throttles.                                               |
| `windowMs`       | `5_000`  | Increase evaluation window: at most one increase per window.                                                        |
| `cooldownMs`     | `10_000` | Decrease cooldown: at most one decrease per cooldown, so one burst of correlated throttles counts once.             |

### `acquire(options)`

| Option      | Type          | Default  | Description                                                                                               |
| ----------- | ------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `class`     | `string`      | –        | Priority class to acquire under. Must be one of the configured `classes` keys.                            |
| `timeoutMs` | `number`      | `10_000` | Maximum time to wait for a slot (jittered polling inside). On expiry, rejects with `AcquireTimeoutError`. |
| `signal`    | `AbortSignal` | –        | Optional cancellation for the wait.                                                                       |

Returns a `Lease` with an idempotent `release(outcome: LeaseOutcome)`. `withLease(options, fn)` takes the same options plus an optional `outcomeOnError: (err: unknown) => LeaseOutcome` — the outcome to release with when `fn` throws (`FAILURE` when omitted; `THROTTLED` feeds the AIMD decrease; `SUCCESS` releases the slot as if the call had succeeded).

Waiting is jittered polling, not FIFO — waiter fairness is a documented non-goal; put your fairness layer (e.g. a queue) upstream.

## Priority Classes

A class with a `reservedShare` gets a slice of capacity that other classes can never occupy. Every class is capped at `L` minus the sum of the _other_ classes' reserved slices, so the guarantee holds with any number of reserved classes:

```typescript
const semaphore = new AdaptiveSemaphore({
  id: "my-provider-api",
  redis,
  initialLimit: 20,
  classes: {
    interactive: { reservedShare: 0.25 }, // may use full L
    background: {}, // capped at L - ceil(0.25 * L)
  },
});

await semaphore.withLease({ class: "interactive", timeoutMs: 10_000 }, () =>
  callProvider(),
);
```

Leases cannot be preempted, so the reserve is never lent out — the reserved slice idles when its class has no traffic.

## Failure Semantics

If Redis is unreachable, `onUnavailable` decides: `'throw'` fails closed (the acquire rejects with `SemaphoreUnavailableError`), or `{ localLimit: number }` fails open with a fixed per-process cap. Every degraded-mode event is reported through `onError`. State self-heals after recovery: stale leases expire by TTL and `L` resumes adapting from its persisted value.

## Non-Goals

- Not a rate limiter: concurrency only, no tokens per second or sliding windows.
- Not a queue and not FIFO-fair among waiters.
- No error inspection: outcome classification belongs to the caller.
- One Redis (or cluster with hash-tagged keys) per deployment — the same assumption the circuit breaker makes.

## Combining with the Circuit Breaker

When both primitives guard the same call, pass the semaphore to the breaker at construction and keep calling `execute`:

```typescript
const semaphore = new AdaptiveSemaphore({
  id: "my-provider-api",
  redis,
  initialLimit: 10,
  classes: {
    interactive: { reservedShare: 0.25 },
    background: {},
  },
});

const circuitBreaker = new CircuitBreaker({
  id: "my-service-api",
  redis,
  breaker: new ConsecutiveBreaker({ threshold: 5 }),
  health,
  semaphore: {
    instance: semaphore, // the breaker never disposes it; lifecycle stays with you
    outcomeOnError: (err) =>
      isRateLimitError(err) ? LeaseOutcome.THROTTLED : LeaseOutcome.FAILURE,
  },
});

await circuitBreaker.start();

// Every execute is now gated through the semaphore. The optional second
// argument overrides the lease defaults per call.
const result = await circuitBreaker.execute(() => callProvider(), {
  lease: { class: "interactive" },
});
```

With a semaphore configured, `execute` guarantees:

- **An open circuit blocks before the lease.** Callers rejected with `CircuitOpenError` never wait for or consume a slot, and every one of them is counted in the blocked-requests metric — no manual `breaker.state` check needed.
- **Lease acquisition stays outside breaker accounting.** `AcquireTimeoutError` propagates to the caller without recording a breaker failure or affecting call-duration metrics, so saturation alone cannot open the circuit. If the circuit opens while a caller is waiting for a slot, the wait is aborted immediately with `CircuitOpenError` instead of running out its timeout.
- **Breaker accounting is unchanged.** Any error thrown by your function records as a breaker failure, exactly as without a semaphore. `outcomeOnError` decides only the lease outcome: `THROTTLED` (triggers the AIMD decrease) or `FAILURE` (no adaptation).

A breaker without the `semaphore` option behaves exactly as before, and the semaphore remains fully usable standalone.
