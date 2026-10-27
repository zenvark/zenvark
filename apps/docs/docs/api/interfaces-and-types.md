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

### Telemetry

Interface for telemetry integrations, registered globally with `registerTelemetry()` or per breaker with the `telemetry` option. All methods are optional. `@zenvark/otel` implements it for OpenTelemetry.

```typescript
interface Telemetry {
  executeCall?<T>(params: ExecuteCallParams<T>): Promise<T>;
  executeHealthCheck?(params: ExecuteHealthCheckParams): Promise<void>;
  onBlockedRequest?(event: BlockedRequestEvent): void;
  onStateChange?(event: StateChangeEvent): void; // leader only
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

type BlockedRequestEvent = { breakerId: string };
type StateChangeEvent = { breakerId: string; state: CircuitState };
```

`executeCall` and `executeHealthCheck` must call `execute` exactly once and settle with its result or rethrow its error.

### TelemetryOptions

Per-breaker telemetry settings, passed as the `telemetry` option.

```typescript
type TelemetryOptions = {
  isEnabled?: boolean; // false disables all integrations for this breaker
  integrations?: Telemetry | Telemetry[]; // replaces the global integrations
};
```

See [Telemetry](../guides/metrics.md#telemetry) for usage.

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
