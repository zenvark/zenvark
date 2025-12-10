---
sidebar_position: 2
---

# Circuit States

The circuit breaker operates in two states, managing the flow of requests to protect your services.

## CLOSED State

The circuit is **closed** when the protected service is healthy and requests are allowed to pass through.

### Behavior

- All requests are executed normally
- Call results (success/failure) are recorded
- Breaker strategy continuously evaluates recent results
- If failure threshold is exceeded, circuit opens

### Characteristics

- **Default state**: Circuits start in the CLOSED state
- **Normal operation**: Services operate as if no circuit breaker exists
- **Monitoring**: All calls are recorded for evaluation
- **Low overhead**: Minimal performance impact

## OPEN State

The circuit is **open** when the protected service is unhealthy and requests are blocked.

### Behavior

- All requests are immediately blocked
- `CircuitOpenError` is thrown without executing the operation
- Leader instance performs periodic health checks
- Circuit closes when a health check succeeds

### Characteristics

- **Fast fail**: Requests fail immediately without attempting the operation
- **Reduced load**: Protected service is given time to recover
- **Health monitoring**: Leader continuously checks service health
- **Automatic recovery**: Circuit closes when service recovers

## State Transitions

### CLOSED → OPEN

The circuit opens when the breaker strategy determines the failure threshold has been exceeded.

**Actions:**

1. Leader evaluates call results against breaker strategy
2. Leader broadcasts "open circuit" command via Redis
3. All instances receive update and transition to OPEN
4. Leader begins health check loop with backoff

### OPEN → CLOSED

The circuit closes when a health check succeeds, indicating the service has recovered.

**Actions:**

1. Leader's health check passes
2. Leader broadcasts "close circuit" command via Redis
3. All instances receive update and transition to CLOSED
4. Normal request processing resumes

## Monitoring State Changes

### Using Callbacks

```typescript
import { CircuitBreaker, CircuitState } from "zenvark";

const circuitBreaker = new CircuitBreaker({
  // ...
  onStateChange: (state) => {
    if (state === CircuitState.OPEN) {
      console.error("Circuit opened - service degraded");
    } else {
      console.info("Circuit closed - service recovered");
    }
  },
});
```

### Checking Current State

```typescript
import { CircuitState } from "zenvark";

// Read-only property
const currentState = circuitBreaker.state;

if (currentState === CircuitState.OPEN) {
  // Use fallback, cached data, or default response
  return getCachedData();
}
```
