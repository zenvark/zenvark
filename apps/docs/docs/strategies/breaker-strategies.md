---
sidebar_position: 1
---

# Breaker Strategies

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

## ConsecutiveBreaker

Opens the circuit after a specified number of consecutive failures.

### Configuration

```typescript
new ConsecutiveBreaker({
  threshold: number;  // Number of consecutive failures required to open circuit
})
```

### Example

```typescript
import { CircuitBreaker, ConsecutiveBreaker } from "zenvark";

const circuitBreaker = new CircuitBreaker({
  breaker: new ConsecutiveBreaker({
    threshold: 3, // Open after 3 consecutive failures
  }),
});
```

### Use Cases

- Services with typically high reliability that shouldn't fail multiple times in a row
- When you want to react quickly to a series of immediate failures
- Testing and development environments

### Behavior

- Counts only consecutive failures
- A single success resets the failure counter
- Simple and predictable

## CountBreaker

Opens the circuit when the failure rate exceeds a threshold within a sliding window of recent calls.

### Configuration

```typescript
new CountBreaker({
  threshold: number;              // Failure rate threshold (0.0 to 1.0)
  size: number;                   // Number of recent calls to evaluate
  minimumNumberOfCalls?: number;  // Optional: Minimum calls before evaluation
})
```

### Example

```typescript
import { CountBreaker } from "zenvark";

const breaker = new CountBreaker({
  threshold: 0.5, // Open if 50% or more of recent calls failed
  size: 100, // Evaluate last 100 calls
  minimumNumberOfCalls: 10, // Require at least 10 calls before opening
});
```

### Use Cases

- High-traffic services with variable failure patterns
- When you need to tolerate occasional failures
- Services with expected intermittent issues

### Behavior

- Maintains a sliding window of the most recent `size` calls
- Calculates failure rate as: `failures / total calls`
- Opens circuit when failure rate exceeds threshold
- If `minimumNumberOfCalls` is set, circuit won't open until at least that many calls have been made

## SamplingBreaker

Opens the circuit when the failure rate exceeds a threshold within a time-based window.

### Configuration

```typescript
new SamplingBreaker({
  threshold: number;              // Failure rate threshold (0.0 to 1.0)
  duration: number;               // Time window in milliseconds
  minimumNumberOfCalls?: number;  // Optional: Minimum calls before evaluation
})
```

### Example

```typescript
import { SamplingBreaker } from "zenvark";

const breaker = new SamplingBreaker({
  threshold: 0.3, // Open if 30% of calls in window failed
  duration: 60000, // 60 second evaluation window
  minimumNumberOfCalls: 5, // Require at least 5 calls before opening
});
```

### Use Cases

- Services with time-sensitive operations
- When you need to evaluate failures over a specific time period
- Low to medium traffic services
- Services with expected traffic patterns

### Behavior

- Evaluates all calls within the last `duration` milliseconds
- Calculates failure rate as: `failures / total calls in window`
- Opens circuit when failure rate exceeds threshold
- If `minimumNumberOfCalls` is set, circuit won't open until at least that many calls have been made within the time window
- Automatically excludes calls older than the window

## Choosing a Strategy

| Strategy               | Best For                  | Traffic Volume | Response Speed |
| ---------------------- | ------------------------- | -------------- | -------------- |
| **ConsecutiveBreaker** | Highly reliable services  | Any            | Very Fast      |
| **CountBreaker**       | Variable failure patterns | High           | Fast           |
| **SamplingBreaker**    | Time-sensitive operations | Low-Medium     | Medium         |

### Decision Guide

Choose **ConsecutiveBreaker** when:

- Your service should rarely fail
- You want immediate response to multiple failures
- Simplicity is important

Choose **CountBreaker** when:

- You have high traffic volume
- Occasional failures are expected and acceptable
- You need to tolerate intermittent issues

Choose **SamplingBreaker** when:

- Time-based analysis is important
- Traffic is relatively low or predictable
- You want to evaluate service health over specific time periods

## Custom Strategies

You can implement your own breaker strategy by implementing the `BreakerStrategy` interface:

```typescript
import {
  type BreakerStrategy,
  type CallResultEvent,
  CircuitBreaker,
} from "zenvark";

class CustomBreaker implements BreakerStrategy {
  shouldOpenCircuit(events: CallResultEvent[]): boolean {
    // Your custom logic here
    return false;
  }
}

const circuitBreaker = new CircuitBreaker({
  // ...
  breaker: new CustomBreaker(),
});
```
