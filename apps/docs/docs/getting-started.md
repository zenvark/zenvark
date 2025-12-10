---
sidebar_position: 2
---

# Getting Started

This guide will help you get started with Zenvark in your application.

## Prerequisites

- **Node.js**: 22.x or higher
- **Redis**: 6.0 or higher
  - Redis Streams support required (available in Redis 5.0+, but 6.0+ recommended)

## Installation

Install Zenvark and its dependencies:

```bash
npm install zenvark ioredis
```

For Prometheus metrics support:

```bash
npm install @zenvark/prom prom-client
```

## Quick Start

Here's a complete example showing how to set up and use a circuit breaker:

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
  onError: (err: Error) => {
    // Handle or log internal circuit breaker errors here to prevent unhandled exceptions.
    console.error("Circuit breaker error:", err);
  },
  onRoleChange: (role) => {
    // Observe leader election role changes: 'leader' | 'follower'
    console.log("Circuit role changed to", role);
  },
  onStateChange: (state) => {
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
    return await fetch("https://api.example.com/data");
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

## Basic Usage Pattern

### 1. Create and Configure

Create a circuit breaker instance with your desired configuration:

```typescript
const circuitBreaker = new CircuitBreaker({
  id: "my-service-api",
  redis,
  breaker: new ConsecutiveBreaker({ threshold: 5 }),
  health: {
    backoff: new ConstantBackoff({ delayMs: 5000 }),
    async check(type, signal) {
      // Health check implementation
    },
  },
});
```

### 2. Start

Start the circuit breaker before using it:

```typescript
await circuitBreaker.start();
```

### 3. Execute Protected Operations

Wrap your operations with the circuit breaker:

```typescript
try {
  const result = await circuitBreaker.execute(async () => {
    return await callExternalService();
  });
} catch (err) {
  if (err instanceof CircuitOpenError) {
    // Handle blocked requests
  } else {
    // Handle operation failures
  }
}
```

### 4. Stop

Clean up when shutting down:

```typescript
await circuitBreaker.stop();
```

## Next Steps

- [Explore different breaker strategies](./strategies/breaker-strategies.md)
- [Learn about backoff strategies](./strategies/backoff-strategies.md)
- [Read the full API reference](./api/circuit-breaker.md)
- [Understand the architecture](./guides/architecture.md)
