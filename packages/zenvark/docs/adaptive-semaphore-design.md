# Zenvark adaptive semaphore — design

Zenvark ships two distributed resilience primitives. The circuit breaker is reactive: it cuts callers off from a dependency that is already failing. The adaptive semaphore is proactive: it bounds the number of simultaneous operations across a fleet of processes against an external constraint whose real ceiling is unknown or variable — for example, a third-party API rate limit shared by one API key.

The semaphore knows nothing about HTTP, providers, or queues. It manages three things:

1. **Leases** — a Redis-backed count of in-flight operations per domain, so the bound holds fleet-wide, not per process.
2. **Adaptation** — an AIMD controller (additive increase, multiplicative decrease) that moves capacity toward the real ceiling based on outcomes the caller reports.
3. **Priority classes** — optional reserved shares of capacity, so latency-sensitive callers are never fully crowded out by bulk callers.

The semaphore and the `CircuitBreaker` often guard the same call, so the breaker has built-in support for it — see "Composing with CircuitBreaker".

## Referenced art

- [Netflix/concurrency-limits](https://github.com/Netflix/concurrency-limits) — the reference implementation of adaptive concurrency limits. Java, in-process only. The AIMD rules here follow its guidance, notably "increase only when the limit is binding".
- [swarthy/redis-semaphore](https://github.com/swarthy/redis-semaphore) — TypeScript distributed semaphore on Redis with lease TTLs and auto-refresh. Used unmodified as the gate — see "Gate implementation".

## Concepts

- **Id** — names one limited resource, like a breaker id. All keys live under `zenvark:${id}:*`. Granularity is the consumer's choice (per provider, per API key, per tenant…).
- **Capacity `L`** — the current maximum number of live leases. Starts at `initialLimit`, moves within `[minLimit, maxLimit]` under AIMD control. `maxLimit` is a runaway guard, not a tuning knob.
- **Lease** — one held slot. Carries a TTL and auto-renews while held, so slots owned by crashed processes return within one TTL. Released explicitly with an outcome.
- **Outcome** — reported by the caller on release: `SUCCESS`, `THROTTLED` (the remote pushed back; the caller decides what maps to this — the library never inspects errors), or `FAILURE` (errored for unrelated reasons; neutral for adaptation).
- **Class** — a named priority tier with an optional `reservedShare`. Every class is capped at `L` minus the sum of the _other_ classes' reserved slices, so the guarantee holds with any number of reserved classes. With one reserved class: it may use full `L`, everyone else is capped at `L` minus its slice. Leases cannot be preempted, so the reserve is never lent out.

## Contract and conventions

- **Connection.** The constructor takes an `ioredis` instance and uses it directly — no `duplicate()`. The semaphore only issues request/response commands, so it is safe on a shared connection.
- **No lifecycle.** Construction is passive; there is no `start`/`stop`. The first acquire seeds `zenvark:${id}:limit` with `SET NX` (every process may try, one wins). The local view of `L` is a read-through cache refreshed on acquire, so no background timer exists. `dispose()` is optional and idempotent: it aborts pending acquires; held leases stop renewing and lapse by TTL.
- **Errors.** Internal errors surface through `onError?: (err: Error) => void`, wrapped with context and `cause`, falling back to `console.error` — same convention as the breaker.
- **Metrics.** A `SemaphoreMetricsRecorder` interface, implemented by `PrometheusSemaphoreMetrics` in `@zenvark/prom`:
  - `initialize?(id)` — called once at construction.
  - `recordAcquire({ id, class, result: 'acquired' | 'timeout', waitMs })`
  - `recordRelease({ id, class, outcome, heldMs })`
  - `recordLimitChange({ id, limit, direction: 'increase' | 'decrease' | 'init' })` — fired whenever this node's cached view of `L` changes, whether it applied the change or observed it on refresh. With per-process registries, this keeps every instance's gauge current within one refresh interval.
  - `recordThrottle({ id })` — every observed throttle, including those suppressed by the cooldown.
- **State.** `getState()` returns `{ limit, inflight, inflightByClass }` — `limit` is the cached fleet-wide value; the inflight counts are per-process (fleet-wide per-class counts are not readable from Redis; sum per-instance gauges at query time instead). `onLimitChange?` is a plain callback for logging, like the breaker's `onStateChange`.

## API

```ts
import { AdaptiveSemaphore, LeaseOutcome } from "zenvark";
import { PrometheusSemaphoreMetrics } from "@zenvark/prom";

const semaphore = new AdaptiveSemaphore({
  id: "my-provider-api", // keys live at zenvark:my-provider-api:*
  redis, // shared ioredis instance, used as-is
  initialLimit: 10,
  minLimit: 2,
  maxLimit: 1000,
  leaseTtlMs: 30_000, // auto-refresh at 80%
  aimd: {
    // defaults shown; normally omit the whole block
    decreaseFactor: 0.5,
    increaseStep: 1,
    windowMs: 5_000, // increase evaluation window
    cooldownMs: 10_000, // decrease cooldown
  },
  classes: {
    interactive: { reservedShare: 0.25 },
    background: {}, // capped at L - ceil(0.25 * L)
  },
  onUnavailable: "throw", // or { localLimit: 25 } — fixed per-process fallback cap
  metrics: prometheusSemaphoreMetrics,
  onError: (err) => logger.error(err),
});
// no start step; on shutdown, semaphore.dispose() aborts waiting acquires

// explicit form
const lease = await semaphore.acquire({
  class: "interactive",
  timeoutMs: 10_000, // max wait for a slot
  signal: abortSignal, // optional cancellation
});
try {
  const result = await callProvider();
  await lease.release(LeaseOutcome.SUCCESS);
  return result;
} catch (err) {
  await lease.release(
    isRateLimitSignal(err) ? LeaseOutcome.THROTTLED : LeaseOutcome.FAILURE,
  );
  throw err;
}

// or the wrapper, which handles release and maps errors via a classifier
const result = await semaphore.withLease(
  { class: "background", timeoutMs: 60_000, classifyError: isRateLimitSignal },
  () => callProvider(),
);
```

- `acquire` rejects with `AcquireTimeoutError` when `timeoutMs` elapses, and with `SemaphoreDisposedError` after `dispose()`.
- `withLease` is single-attempt: an acquire timeout is not retried internally; retry policy belongs to the caller. `classifyError` is optional — when omitted, every thrown error releases as `FAILURE`.
- `Lease.release(outcome)` is idempotent: only the first call has an effect.
- Held leases keep renewing until released, so long-running operations are safe.
- Waiting is jittered polling (~100–500 ms), not FIFO. Waiter fairness is a non-goal; put a fairness layer (e.g. a job queue) upstream if you need one.

## Adaptation rules (AIMD)

- **Decrease**: on `THROTTLED`, `L := max(minLimit, floor(L × decreaseFactor))`, at most once per `cooldownMs`. A remote throttle typically fails many concurrent calls at once; the cooldown makes that count as one event.
- **Increase**: `L := min(maxLimit, L + increaseStep)`, at most once per `windowMs`, and only if the window saw demand at the cap (at least one denied acquire) and no throttles. The demand guard keeps `L` from inflating while traffic is quiet.
- Steady state is a sawtooth just under the real ceiling. If halving causes throughput collapse on bursty traffic, soften `decreaseFactor` to 0.7–0.8.

The evaluation window is time-based. A pluggable strategy interface (for Vegas- or gradient-style controllers) is deferred — see "Future work".

## Gate implementation: redis-semaphore, unmodified

The gate is `swarthy/redis-semaphore`, used through its published API — no fork, no custom Lua:

- **Check-then-add acquire.** Its acquire script trims expired leases, checks `zcard < limit`, and only then adds the lease. Denied waiters never enter the sorted set — they sleep client-side and retry. This makes class caps safe: waiters cannot hold capacity.
- **Class caps need no script changes.** `limit` is an argument on every acquire/refresh call, so instances pointed at the same key can count the same lease set against different thresholds. An instance for class `c` uses `limit = L − Σ ceil(shareᵢ × L)` over every reserved class `i ≠ c`.
- **Dynamic capacity is idiomatic.** The library constructs one instance per held lease, so the current cap — computed from the cached `L` — is passed at construction. Slightly stale views of `L` are fine; the controller converges regardless.
- **Lease lifecycle matches.** Auto-refresh at 80% of the TTL (timer `unref()`d), crash reclaim via expiry trimming, `AbortSignal` support on acquire (landed in 5.7.0, hence `redis-semaphore >= 5.7.0`). `retryInterval` is per-instance and randomized at construction (100–500 ms) for jitter.

Accepted caveats:

- Lease scores use client clocks, not Redis `TIME`. The failure mode is inter-node skew exceeding the lease TTL; with NTP and a ~30 s TTL there is ample headroom.
- No FIFO ordering among waiters (by design here anyway).
- redis-semaphore adds its own `semaphore:` key prefix, so the gate's sorted set for id `my-provider-api` lives at `semaphore:zenvark:my-provider-api` while the controller keys sit at `zenvark:my-provider-api:*`. Cosmetic, but worth knowing when inspecting Redis.

## Controller state: plain Redis commands, no Lua

Per id `K`, alongside the gate's sorted set:

- `zenvark:K:limit` — integer, the current `L`. Held in a read-through cache: an acquire re-reads it when the cached value is stale, and a denied acquire always re-reads. Active domains stay fresh with no background timer; an idle domain's stale cache is harmless because nothing is acquiring.
- `zenvark:K:cooldown` — marker with `PX = cooldownMs`. A `THROTTLED` outcome attempts `SET NX PX`; only the winner applies the decrease (read, clamp, write). One decrease per cooldown, fleet-wide.
- `zenvark:K:throttled` / `zenvark:K:demand` — markers with `PX = windowMs`. `throttled` is set on any throttle outcome; `demand` on any denied acquire (direct evidence the limit is binding).
- `zenvark:K:increase` — the increase claim. On release, if `demand` exists and `throttled` does not, the process attempts `SET NX PX = windowMs`; only the winner applies the `INCR` (clamped to `maxLimit`). This key is what enforces "at most once per window" — without it, under sustained saturation every release would increment.

The residual races (an `INCR` landing between another process's read and write, a clamp applied non-atomically) are off-by-one and self-correcting: AIMD is a feedback loop, so `L` tolerates transiently inconsistent views. This is also why no leader is needed, unlike circuit state, which must flip atomically for the whole fleet.

## Composing with CircuitBreaker

The breaker owns the composition: pass the semaphore at construction and call `execute` as usual.

```ts
const semaphore = new AdaptiveSemaphore({
  id: "my-provider-api",
  redis,
  classes,
  metrics: semaphoreMetrics,
  onError,
});
const breaker = new CircuitBreaker({
  id: "my-service-api",
  redis,
  breaker: strategy,
  health,
  metrics: breakerMetrics,
  onError,
  semaphore: {
    instance: semaphore, // lifecycle stays with the caller; the breaker never disposes it
    timeoutMs: 10_000, // default max wait for a slot
    classifyError: isRateLimitSignal, // default THROTTLED-vs-FAILURE mapping
  },
});

// lease options may be overridden per call
const result = await breaker.execute(() => callProvider(), {
  lease: { class: "interactive" },
});
```

The integration is built in because neither external nesting order works:

- **Lease outside, breaker inside** wastes capacity when the circuit is open: callers queue for a slot, consume it, and only then hit `CircuitOpenError`. The usual workaround — a manual `breaker.state === OPEN` check before acquiring — skips `execute`, so blocked requests never reach the blocked-requests metric.
- **Breaker outside, lease inside** records every `AcquireTimeoutError` as a breaker failure, so sustained demand above the limit opens the circuit, and lease wait time pollutes the call-duration histogram.

With a configured semaphore, `execute` sequences the call itself:

1. **Open check before the lease.** An open circuit rejects with `CircuitOpenError` and records a blocked request — no slot is waited for or consumed.
2. **Lease acquisition, outside breaker accounting.** `AcquireTimeoutError` propagates without touching the breaker's call results or duration metrics. If the circuit opens mid-wait, the breaker aborts the pending acquire and the caller gets `CircuitOpenError` immediately, also counted as a blocked request.
3. **Re-check after the lease.** If the circuit opened during the wait but the acquire won the race, the lease is released as `FAILURE` and `CircuitOpenError` is thrown.
4. **The call, with unchanged breaker accounting.** Any error thrown by `fn` records as a breaker failure, exactly as without a semaphore. `classifyError` decides only the lease outcome: `THROTTLED` (feeds the AIMD decrease) or `FAILURE` (neutral).

The constructor's `semaphore` block carries the defaults (`timeoutMs`, `class`, `classifyError`); `execute`'s second argument overrides them per call (`{ lease: { timeoutMs?, class?, classifyError?, signal? } }`). Once a semaphore is configured, every `execute` is gated; passing `lease` options without a configured semaphore is an error.

Both primitives stay fully usable standalone. Their ids need not match: a breaker typically guards a dependency (a downstream service), a semaphore a quota (an API key or tenant). Both live under the `zenvark:` namespace on the same Redis.

## Failure semantics

When Redis is unreachable, `onUnavailable` decides: `'throw'` fails closed (the acquire rejects with `SemaphoreUnavailableError`, carrying the Redis error as `cause`), or `{ localLimit: number }` fails open with a fixed per-process cap. Every degraded-mode event is reported through `onError`. State self-heals after recovery: stale leases expire by TTL and `L` resumes adapting from its persisted value.

## Non-goals

- Not a rate limiter: concurrency only, no tokens per second or sliding windows.
- Not a queue, and not FIFO-fair among waiters.
- Not built on the breaker's machinery: no leader election, no Redis Streams, no shared call-result events.
- No multi-node Redis consensus (no Redlock); one Redis (or cluster with hash-tagged keys) per deployment, same assumption as the breaker.
- No error inspection: mapping errors to `THROTTLED` is the caller's classifier.

## Test coverage

The suite runs against real Redis via the repo's docker-compose setup (no mocked stores) and covers:

- Convergence: against a simulated remote with a hidden ceiling, `L` converges to a band under the ceiling, recovers after drops, and does not inflate when idle.
- Lease reclaim: a holder that stops heartbeating returns its capacity within one TTL.
- Cooldown: N concurrent `THROTTLED` outcomes in one window produce exactly one decrease.
- Classes: reserved share holds under full background saturation; the reserve stays held back when the reserved class is idle; a reserved class can use its full cap when others are idle; with two reserved classes, neither can eat the other's slice.
- Breaker integration: calls are gated and released with the right outcome, acquire timeouts never appear in the breaker's call results, an open circuit blocks before touching the semaphore, a mid-wait open aborts the pending acquire, and per-call lease overrides reach the semaphore.
