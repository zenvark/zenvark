---
sidebar_position: 3
---

# Interfaces & Types

This page documents the interfaces and type aliases exported by Zenvark.

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

### Telemetry

Interface for telemetry integrations, registered globally with `registerZenvarkTelemetry()` or per instance with the `telemetry` option of `CircuitBreaker` and `AdaptiveSemaphore`. All methods are optional. `@zenvark/prom` and `@zenvark/otel` implement it for Prometheus and OpenTelemetry.

```typescript
interface Telemetry {
  // Circuit breaker
  executeCall?<T>(params: ExecuteCallParams<T>): Promise<T>;
  executeHealthCheck?(params: ExecuteHealthCheckParams): Promise<void>;
  onBreakerInit?(event: { breakerId: string }): void;
  onCallEnd?(event: CallEndEvent): void;
  onBlockedRequest?(event: { breakerId: string }): void;
  onHealthCheckEnd?(event: HealthCheckEndEvent): void; // not for cancelled checks
  onStateChange?(event: { breakerId: string; state: CircuitState }): void; // leader only
  onRoleChange?(event: RoleChangeEvent): void;

  // Adaptive semaphore
  onSemaphoreInit?(event: { semaphoreId: string }): void;
  onAcquire?(event: AcquireEvent): void;
  onRelease?(event: ReleaseEvent): void;
  onLimitChange?(event: LimitChangeEvent): void;
  onThrottle?(event: { semaphoreId: string }): void;
}

type ExecuteCallParams<T> = {
  breakerId: string;
  execute: () => Promise<T>;
};

type ExecuteHealthCheckParams = {
  breakerId: string;
  type: HealthCheckType;
  signal: AbortSignal; // aborted when the check is cancelled
  execute: () => Promise<void>;
};

type CallEndEvent = {
  breakerId: string;
  result: CallResult;
  durationMs: number;
};
type HealthCheckEndEvent = {
  breakerId: string;
  type: HealthCheckType;
  result: CallResult;
  durationMs: number;
};
type RoleChangeEvent = {
  breakerId: string;
  role: CircuitRole;
  state: CircuitState;
};

type AcquireEvent = {
  semaphoreId: string;
  class?: string;
  result: AcquireResult;
  waitMs: number;
};
type ReleaseEvent = {
  semaphoreId: string;
  class?: string;
  outcome: LeaseOutcome;
  heldMs: number;
};
type LimitChangeEvent = {
  semaphoreId: string;
  limit: number;
  direction: LimitChangeDirection;
};
```

`executeCall` and `executeHealthCheck` should call `execute` synchronously (before any `await`), so the work starts inside the integration's context. The breaker settles with the work's own result as soon as it is known, without waiting for the integration: the work runs exactly once even if `execute` is not called or called twice, and a rejection other than the work's own error is reported through `onError`. Errors thrown by `on*` methods are reported through `onError` too.

See [Custom Telemetry Integration](../guides/metrics.md#custom-telemetry-integration) for an example.

### TelemetryOptions

Per-instance telemetry settings, passed as the `telemetry` option of `CircuitBreaker` or `AdaptiveSemaphore`.

```typescript
type TelemetryOptions = {
  isEnabled?: boolean; // false disables all integrations for this instance
  integrations?: Telemetry | Telemetry[]; // replaces the global integrations
};
```

See [Telemetry](../guides/metrics.md#telemetry) for usage.

### BreakerMetricsRecorder (deprecated)

Interface behind the deprecated `metrics` option. Implement `Telemetry` instead; see [Migrating from `metrics`](../guides/metrics.md#migrating-from-metrics).

```typescript
interface BreakerMetricsRecorder {
  initialize?(breakerId: string): void;
  recordCall(params: RecordCallParams): void;
  recordBlockedRequest(params: RecordBlockedRequestParams): void;
  recordHealthCheck(params: RecordHealthCheckParams): void;
  recordStateChange?(params: RecordStateChangeParams): void;
  clearState?(breakerId: string): void;
}
```

## Type Aliases

### CallResultEvent

Represents a call execution event with timing and outcome information.

```typescript
type CallResultEvent = {
  id: string; // Unique identifier for this call event (Redis stream ID)
  callResult: CallResult; // The outcome of the call (SUCCESS or FAILURE)
  timestamp: number; // Unix timestamp in milliseconds when the call occurred
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
