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

## Type Aliases

### CallResultEvent

Represents a call execution event with timing and outcome information.

```typescript
type CallResultEvent = {
  id: string;         // Unique identifier for this call event (Redis stream ID)
  callResult: CallResult;  // The outcome of the call (SUCCESS or FAILURE)
  timestamp: number;  // Unix timestamp in milliseconds when the call occurred
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