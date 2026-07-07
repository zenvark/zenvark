# @zenvark/semaphore — adaptive distributed semaphore, design

Status: Proposed (supersedes the 2026-07-03 draft that placed this in polyglot-service as `@lokalise/adaptive-semaphore`; the target home is now the zenvark monorepo)
Date: 2026-07-07

## Purpose

Zenvark today ships one distributed resilience primitive: a Redis-coordinated circuit breaker, which is reactive — it cuts callers off from a dependency that is already failing. This package adds the complementary proactive primitive: a distributed semaphore whose capacity adapts to feedback. It bounds the number of simultaneous operations across a whole fleet of processes against a shared external constraint whose true ceiling is unknown, variable, or shared with other consumers — the canonical example being a third-party API rate limit shared by one API key.

The library is deliberately abstract: it knows nothing about HTTP, LLM providers, queues, or translation. It manages three things and only three things:

1. **Leases** — a Redis-backed count of in-flight operations per domain, so the bound holds fleet-wide, not per process.
2. **Adaptation** — an AIMD controller (additive increase, multiplicative decrease) that moves the capacity toward the real ceiling based on outcome signals the caller reports.
3. **Priority classes** — optional reserved shares of capacity, so a latency-sensitive class of callers is never fully crowded out by bulk callers.

The first consumer is polyglot-service's provider concurrency limiter (see `apps/polyglot-service/docs/adr/0001-priority-tiers-and-provider-concurrency.md`, Decision §3). There the semaphore and the zenvark `CircuitBreaker` guard the same provider call, so clean composition with the breaker is a first-class design requirement, not an afterthought — see "Composing with CircuitBreaker" below.

## Why a zenvark package

- **The dependencies are already zenvark's dependencies.** The gate engine chosen below is `swarthy/redis-semaphore`, which zenvark already depends on (it uses its `Mutex` for leader election), over the same officially supported client, `ioredis`. Adding this package introduces zero new third-party runtime dependencies to the monorepo.
- **The conventions carry over one-to-one.** Callback-based error reporting (`onError`), a metrics-recorder interface with a Prometheus implementation in `@zenvark/prom`, `ObjectValues`-style constant objects, and the repo's tooling (turbo, biome, changesets, real-Redis docker-compose tests) are all exactly what this design needs.
- **A sibling package, not a breaker feature.** The two primitives use deliberately different coordination models: the breaker is leader-elected, replicating state through Redis Streams with background readers and a duplicated connection per instance; the semaphore is leaderless and symmetric — plain Redis commands, no background readers, decisions coordinated by TTL markers any process can win. They share conventions and infrastructure, not runtime machinery, so neither's complexity leaks into the other.

### Prior art, and why this is still a new implementation

Surveyed 2026-07-03:

- [Netflix/concurrency-limits](https://github.com/Netflix/concurrency-limits) — the reference implementation of adaptive concurrency limits (AIMD, Vegas, Gradient). Java, in-process only, no JS port. We borrow its AIMD rules, notably "increase only when utilization is high".
- [gadget-inc/aimd-bucket](https://github.com/gadget-inc/aimd-bucket) — TypeScript AIMD, built for discovering unknown remote API limits. Rate-based (tokens/sec) rather than concurrency-based, and strictly in-process: a fleet of replicas each converges independently and collectively overshoots. We borrow its outcome-reporting API shape.
- [swarthy/redis-semaphore](https://github.com/swarthy/redis-semaphore) — TypeScript distributed semaphore on Redis with Lua-atomic operations, lease TTLs, and auto-refresh. **Chosen as the gate engine** after a source-level evaluation (v5.7.0, Feb 2026; ~350k weekly downloads; already a zenvark dependency). No adaptation and no classes, but both compose on top of it without modification — see "Gate implementation" below.
- [FluxNinja Aperture](https://github.com/fluxninja/aperture) — full adaptive load-management platform; requires running the Aperture Agent as infrastructure, last released January 2024, company acquired with uncertain trajectory. Too heavy and too risky as a dependency.

No existing TypeScript library combines distributed state, concurrency leases, AIMD adaptation, and priority classes. With the gate delegated to redis-semaphore, the novel surface shrinks to the AIMD controller and class-cap arithmetic — plain TypeScript over standard Redis commands, **no custom Lua at all**.

## Concepts

- **Id** — names one independently limited resource, exactly like a breaker id. All keys live under `zenvark:${id}:*`, the same namespace scheme the breaker uses. The library does not interpret the id; granularity is the consumer's choice (in polyglot, breakers are per provider engine while semaphore domains are per `{engine, tenant}` API key — related but not identical ids).
- **Capacity `L`** — the current maximum number of live leases in a domain. Starts at `initialLimit`, moves within `[minLimit, maxLimit]` under AIMD control. `maxLimit` is a runaway guard, not a tuning knob.
- **Lease** — one held slot. Carries a TTL and is auto-renewed by a heartbeat while held, so slots owned by crashed processes return to the pool within one TTL. Released explicitly with an outcome.
- **Outcome** — caller-reported signal on release, a `LeaseOutcome` constant object mirroring zenvark's `CallResult` style: `SUCCESS`, `THROTTLED` (the remote constraint pushed back — the caller decides what maps to this; the library never inspects errors), or `FAILURE` (errored for unrelated reasons; neutral for adaptation).
- **Class** — a named priority tier with an optional `reservedShare`. Every class is capped at `L` minus the sum of the _other_ classes' reserved slices — a class's own reserve never counts against itself, and no class's cap includes another class's slice, so the guarantee holds pairwise with any number of reserved classes. With a single reserved class this degenerates to the familiar shape: the reserved class may use full `L`, everyone else is capped at `L` minus its slice. Reservation is one-directional by design: leases cannot be preempted, so lending the reserve out would break its guarantee.

## Zenvark-native contract

- **Connection handling.** The constructor takes an `ioredis` instance and uses it directly. Unlike `CircuitBreaker`, it does **not** `duplicate()` the connection: the semaphore issues only request/response commands (no blocking reads, no subscriptions), so it is safe on the caller's shared connection. Consumers pass the same instance to both primitives.
- **Lifecycle: none.** Unlike the breaker — which owns a duplicated connection, background stream readers, and leader election, and needs its `AbstractLifecycleManager` state machine to start and unwind them safely — the semaphore owns no connection, no background loops, and no election, so there is nothing a lifecycle would protect. Construction is passive. The first acquire in a process seeds `zenvark:${id}:limit` with `SET NX initialLimit` (idempotent; every process may attempt it, one wins), and the local view of `L` is a read-through cache refreshed on acquire (see Controller state), so no background timer exists either. The only teardown concern is waiters: an optional, idempotent `dispose()` aborts pending acquires (each in-flight acquire holds an internal `AbortController`, combined with any caller-provided signal). Any lease still held simply stops renewing and lapses by TTL, which is the honest behavior during shutdown (graceful shutdown drains in-flight work first, so held leases at `dispose()` time are the crash case the TTL already covers).
- **Error reporting.** All internal errors surface through `onError?: (err: Error) => void`, wrapped with a context message and `cause`, falling back to `console.error` — identical to the breaker's convention.
- **Metrics.** A `SemaphoreMetricsRecorder` interface in this package, implemented by a new `PrometheusSemaphoreMetrics` in `@zenvark/prom` alongside `PrometheusBreakerMetrics`:
  - `initialize?(id)` — called once at construction.
  - `recordAcquire({ id, class, result: 'acquired' | 'timeout', waitMs })`
  - `recordRelease({ id, class, outcome, heldMs })`
  - `recordLimitChange({ id, limit, direction: 'increase' | 'decrease' | 'init' })` — invoked whenever this node's locally cached view of `L` changes, whether the node applied the change itself or observed it on a cache refresh (`direction` reflects the observed transition). A winner-only gauge would go stale on every other instance with per-process Prometheus registries; this way all instances' gauges converge within one cache-refresh interval.
  - `recordThrottle({ id })` — every observed throttle outcome, including those suppressed by the cooldown (this is the dedicated rate-limit-event metric polyglot currently lacks).
- `getState()` exposes `{ limit, inflight, inflightByClass }` for consumer-side gauges — `limit` is the locally cached fleet-wide value; `inflight` and `inflightByClass` count leases held by _this process_ (the gate's lease set keys entries by opaque identifiers, so fleet-wide per-class counts are not readable from Redis). Fleet totals are obtained by summing the per-instance gauges at query time (PromQL `sum()`), the standard pattern for per-process registries. `onLimitChange?` is available as a plain callback for logging, mirroring the breaker's `onStateChange`.

## API sketch

```ts
import { AdaptiveSemaphore, LeaseOutcome } from "@zenvark/semaphore";
import { PrometheusSemaphoreMetrics } from "@zenvark/prom";

const semaphore = new AdaptiveSemaphore({
  id: "openai:expert", // domain; keys live at zenvark:openai:expert:*
  redis, // shared ioredis instance, used as-is
  initialLimit: 10,
  minLimit: 2,
  maxLimit: 1000,
  leaseTtlMs: 30_000, // redis-semaphore lockTimeout; auto-refresh at 80%
  aimd: {
    // defaults shown; consumers normally omit the whole block
    decreaseFactor: 0.5,
    increaseStep: 1,
    windowMs: 5_000, // increase evaluation window (demand + no throttle)
    cooldownMs: 10_000,
  },
  classes: {
    interactive: { reservedShare: 0.25 },
    background: {}, // capped at L - ceil(0.25 * L)
  },
  onUnavailable: "throw", // or a fallback gate (e.g. a fixed local in-process limit)
  metrics: prometheusSemaphoreMetrics,
  onError: (err) => logger.error(err),
});
// no start step — construction is passive; on shutdown, semaphore.dispose() aborts waiting acquires

// explicit form
const lease = await semaphore.acquire({
  class: "interactive",
  timeoutMs: 10_000, // max wait for a slot; jittered polling inside
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

- `acquire` rejects with `AcquireTimeoutError` when `timeoutMs` elapses — a typed error the caller maps to its own retry semantics (a queue backoff, a 503, etc.).
- Long-held leases (streams) keep renewing until released; the heartbeat runs on a timer owned by the lease.
- Waiting is jittered polling (~100–500 ms), not FIFO. Documented non-goal: waiter fairness. The consumer is expected to have its own fairness layer upstream (in polyglot's case, BullMQ groups).

## Adaptation rules (AIMD)

- **Decrease** (multiplicative): on a `THROTTLED` outcome, `L := max(minLimit, floor(L × decreaseFactor))` — default factor 0.5 — applied at most once per `cooldownMs` (default 10 000 ms), because a remote throttle typically fails many concurrent calls at once and must count as one event, not `L` events.
- **Increase** (additive): `L := min(maxLimit, L + increaseStep)` — default step 1 — at most once per evaluation window (`windowMs`), and only if the window saw _demand at the cap_ (at least one denied acquire) and no throttle events. This demand guard serves the same purpose as Netflix's utilization threshold (increase only when the limit is actually binding), prevents `L` from inflating during quiet periods, and is directly observable from acquire outcomes without sampling in-flight counts.
- The resulting steady state is a sawtooth just under the real ceiling. If oscillation is observed (halving causes throughput collapse on bursty traffic), soften `decreaseFactor` to 0.7–0.8 per common AIMD guidance.

The AIMD constants are an options object with defaults, not a required configuration surface. A pluggable adaptation-strategy interface mirroring zenvark's `BreakerStrategy` (so a Vegas- or gradient-style controller could slot in later) is listed under Open questions; v1 ships AIMD only, and the coordination markers below are specified for AIMD semantics.

## Gate implementation: redis-semaphore, unmodified

Source-level evaluation (2026-07-03) of `swarthy/redis-semaphore` confirmed it provides the entire gate with its published API — no fork, no subclass, no custom Lua. It is already in the monorepo's dependency tree (zenvark core uses its `Mutex` for leader election), so its semantics are familiar to the maintainers:

- **Check-then-add acquire.** Its acquire script trims expired leases (`zremrangebyscore`), checks `zcard < limit`, and only then `zadd`s the lease. Denied waiters never enter the sorted set — they sleep client-side (`retryInterval`) and retry. This is the property that makes class caps safe: waiters cannot squat capacity.
- **Class caps need no script changes.** `limit` is passed as an argument on every acquire/refresh call, so two instances pointed at the _same key_ with different limits count the same lease set against different thresholds. An instance for class `c` uses `limit = L − Σ ceil(shareᵢ × L)` summed over every reserved class `i ≠ c` — for the single-reserved-class case that is `L` for the reserved class and `L − ceil(share × L)` for everyone else. The reservation falls out of the unmodified script.
- **Dynamic capacity is idiomatic.** The library's intended pattern is one instance per held lease (each carries its own UUID identifier and refresh timer). Since an instance is constructed per operation anyway, the current cap — computed from the locally cached `L` — is simply passed at construction. Slightly stale local views of `L` are fine; the controller converges regardless.
- **Lease lifecycle matches the spec.** Auto-refresh at 80% of `lockTimeout` (the timer is `unref()`d), `onLockLost` callback if a lease disappears mid-hold, crash reclaim via expiry trimming on every acquire/refresh, `acquireTimeout` + `AbortSignal` support (`AbortSignal` on acquire landed in 5.7.0, so this package requires `redis-semaphore >= 5.7.0`), typed `TimeoutError`. Jitter: `retryInterval` is per-instance, so it is randomized at construction (e.g. 100–500 ms).

Inherited caveats, accepted and documented:

- Lease scores use **client clocks** (`Date.now()`), not Redis `TIME`. The library's documented edge case is inter-node skew exceeding `lockTimeout`; with NTP and a ~30 s lease TTL there are three orders of magnitude of headroom.
- Waiting is fixed-interval polling per waiter (which is what this design wanted anyway); there is no FIFO ordering among waiters.
- redis-semaphore applies its own `semaphore:` key prefix, so the gate's sorted set for id `openai:expert` lives at `semaphore:zenvark:openai:expert` while the controller keys below sit at `zenvark:openai:expert:*`. Cosmetic, but worth documenting for anyone inspecting Redis.

## Controller state: plain Redis commands, no Lua

Per id `K` (alongside the gate's sorted set):

- `zenvark:K:limit` — integer, the current `L`. Processes hold it in a read-through cache: an acquire re-reads it when the cached value is older than the refresh interval, and a denied acquire always re-reads. Active domains stay fresh with no background timer; an idle domain's cache may go stale, which is harmless because nothing is acquiring.
- `zenvark:K:cooldown` — marker with `PX = cooldownMs`. A `THROTTLED` outcome attempts `SET ... NX PX`; only the winner applies the multiplicative decrease (read, clamp, write). One halving per window, fleet-wide, with no script.
- `zenvark:K:throttled` / `zenvark:K:demand` — markers with `PX = windowMs`. `throttled` is set on any throttle outcome; `demand` is set whenever an acquire is denied — a denied acquire is direct evidence the current limit is binding, a cleaner utilization signal than sampling the in-flight count.
- `zenvark:K:increase` — the increase claim, mirroring the decrease cooldown. On release, if `demand` exists and `throttled` does not, the process attempts `SET ... NX PX = windowMs` on this key; only the winner applies the `INCR` (clamped to `maxLimit`). This marker is what actually enforces "at most once per window": the demand/throttled pair alone cannot, because under sustained saturation new denials keep refreshing `demand` and every release would otherwise increment — `L` would climb once per release instead of once per window.

The residual races (an `INCR` landing between another process's read and write of the decrease, a clamp applied non-atomically) are off-by-one and self-correcting — AIMD is a feedback loop, not an accounting system. This is the deliberate trade for writing zero Lua. Note this is also why the semaphore needs no leader: unlike circuit state, which must flip atomically for the whole fleet, `L` tolerates transiently inconsistent local views.

## Composing with CircuitBreaker

The intended shape for a consumer protecting one downstream resource with both primitives:

```ts
// setup: same redis instance, same error handler, metrics from @zenvark/prom
const breaker = new CircuitBreaker({
  id: "openai",
  redis,
  breaker: strategy,
  health,
  metrics: breakerMetrics,
  onError,
});
const semaphore = new AdaptiveSemaphore({
  id: "openai:expert",
  redis,
  classes,
  metrics: semaphoreMetrics,
  onError,
});

// per call: lease outside, breaker inside
if (breaker.state === CircuitState.OPEN) throw new CircuitOpenError("openai"); // optional fast-path, skips the lease wait
const result = await semaphore.withLease(
  { class: tier, timeoutMs: tierBudget, classifyError: isRateLimitSignal },
  () => breaker.execute(() => callProvider()),
);
```

The nesting order is a deliberate contract, not a style choice:

- **`AcquireTimeoutError` must never pass through `breaker.execute`.** If the lease were acquired inside the breaker, every capacity timeout under saturation would be recorded as a breaker failure, and sustained demand above the limit would open the circuit — a self-inflicted outage caused by the limiter doing its job. With the lease outermost, capacity pressure and dependency health stay independent signals.
- **Provider errors feed both primitives correctly on the way out.** A real failure propagates through `execute` (breaker records `FAILURE`) and then through `withLease`, where the consumer's classifier maps rate-limit signals to `THROTTLED` (feeding the AIMD decrease) and everything else to `FAILURE` (neutral for adaptation).
- **`CircuitOpenError` needs no special handling.** When the circuit opens mid-hold, `execute` throws immediately; the classifier does not recognize it as a throttle, so the lease releases as `FAILURE` — neutral, exactly right. The optional state pre-check above only exists to avoid waiting `timeoutMs` for a lease that will be thrown away; it reads the breaker's local state view and costs nothing.
- **Ids are cousins, not twins.** The breaker guards a dependency (per provider engine); the semaphore guards a quota (per API key). Both live under the `zenvark:` namespace, on the same Redis, reported through the same `onError` and the same `@zenvark/prom` registry — one resilience layer in configuration and operation, two independently correct primitives underneath.

No code dependency between the two packages is needed for any of this; the composition is structural (`execute` is just a thunk to `withLease`). Whether the breaker should additionally grow an error filter (so consumers who insist on breaker-outermost nesting can exclude typed errors from failure accounting) is left as an open question for zenvark core — this design does not require it.

In polyglot-service, this whole section reduces to the `ProviderConcurrencyLimiter` adapter: it owns domain-id construction (`{engine, tenant}`), the 429/`RESOURCE_EXHAUSTED`/529 classifier, the tier-to-class mapping, and DI wiring (`createAiCircuit` stays as-is; a sibling `createProviderSemaphore` factory passes `dependencies.redis`, the shared Bugsnag `onError` handler, and a `PrometheusSemaphoreMetrics` instance). That adapter plus the `classes` block above is the entire polyglot-side configuration surface.

## Failure semantics

If Redis is unreachable, behavior is the consumer's choice via `onUnavailable`: `'throw'` (fail closed) or a caller-supplied fallback gate (e.g. a fixed per-process limit — polyglot passes its legacy `*_MAX_CONCURRENCY` values here, fail-open). Every degraded-mode event is reported through `onError`, so it is visible in the same channel as breaker errors. Lease state is self-healing after recovery: stale leases expire by TTL, and `L` resumes adapting from its persisted value.

## Non-goals

- Not a rate limiter: no tokens per second, no sliding windows. Concurrency only; Little's law connects the two for callers that think in rates.
- Not a queue and not FIFO-fair among waiters.
- Not a `CircuitBreaker` feature: no leader election, no Redis Streams, no shared call-result events. The breaker's `SUCCESS`/`FAILURE` stream cannot carry the semaphore's signals anyway (`THROTTLED` is a third outcome, and demand — denied acquires — only exists at the gate).
- No multi-node Redis consensus (no Redlock); one Redis (or cluster with hash-tagged keys) per deployment, the same assumption the breaker and BullMQ already make.
- No error inspection: mapping errors to `THROTTLED` is entirely the caller's classifier.

## Testing strategy

- Unit and integration tests against real Redis via the zenvark repo's existing docker-compose setup (no mocked stores, matching both repos' testing philosophy).
- Convergence tests: a simulated remote with a hidden concurrency ceiling (and abrupt ceiling changes); assert `L` converges to a band under the ceiling, recovers after drops, and does not inflate when idle.
- Lease-reclaim tests: kill a holder (drop heartbeats), assert capacity returns within one TTL.
- Cooldown tests: N concurrent `THROTTLED` outcomes in one window produce exactly one halving.
- Class tests: reserved share is honored under full background saturation; the reserve stays held back when the reserved class is idle (unreserved classes remain capped at `L` minus the slice — deliberately not work-conserving, per the one-directional reservation); a reserved class can use its full cap when other classes are idle; with two reserved classes, neither can eat the other's slice.
- Composition test: semaphore wrapping a real `CircuitBreaker` — assert acquire timeouts never appear in the breaker's call results, and an opened circuit does not distort adaptation.
- Time control via injected clock/sleep to keep tests deterministic.

## Packaging

- Location: `packages/semaphore` in the zenvark monorepo, published as `@zenvark/semaphore`; the `SemaphoreMetricsRecorder` Prometheus implementation lands in `packages/prom` (`@zenvark/prom`). Versioned by the zenvark repo's existing changesets pipeline.
- Runtime dependencies: `redis-semaphore` (`>= 5.7.0`, for `AbortSignal` on acquire) and `ioredis`, matching zenvark core's dependency style (regular dependencies, deduped by the package manager).
- Internal code sharing: none needed. The lifecycle-free design (see "Zenvark-native contract") removes any dependency on zenvark core's unexported `AbstractLifecycleManager`; the only overlapping utility is the signal-aware `delay` helper (~10 lines), which this package writes inline rather than sharing.
- polyglot-service consequences: the `packages/adaptive-semaphore` package referenced by ADR 0001 was never created, so this is an ADR text change only; polyglot adds `@zenvark/semaphore` as a dependency, and `ProviderConcurrencyLimiter` becomes the thin adapter described above. ADR 0001 §3 needs three updates to match this design: the package references, the placement wording (lease-outside nesting, not inside `execute`), and the adapt-up trigger (denied-acquire demand signal instead of ">80% of `L` in use").

## Open questions

- Should the success evaluation window be time-based (e.g. 5 s) or count-based (e.g. every 50 releases)? Time-based is proposed; count-based adapts faster under high throughput.
- Whether `withLease` should own retry-on-timeout or stay single-attempt (proposed: single-attempt; retries belong to the caller's layer).
- Whether per-class wait-timeout defaults belong in the class config rather than per-acquire call.
- Whether to define a pluggable adaptation-strategy interface mirroring `BreakerStrategy` now or wait for a second controller to exist (proposed: wait; the marker keys are AIMD-shaped).
- Whether zenvark core should gain an error filter on `execute` so typed errors can be excluded from failure accounting (not needed by this design, but it would make the composition robust against consumers nesting the other way).
- Multi-domain hierarchies (e.g. a provider-wide cap above per-tenant caps) — out of scope for v1, worth a design note if a real need appears.
