---
sidebar_position: 1
---

# Introduction

A robust distributed circuit breaker, coordinated via Redis, designed for high-availability applications.

Zenvark helps you build resilient systems by preventing cascading failures and gracefully handling degraded services.

## Why Distributed?

Unlike traditional in-memory circuit breakers, Zenvark coordinates state across all application instances. When one instance detects failures and opens the circuit, all other instances are immediately notified and also block requests, ensuring consistent protection across your entire distributed system.

Learn more about [distributed coordination and architecture](./guides/architecture.md).

## Key Features

- **Distributed Coordination**: Multiple instances coordinate circuit state using Redis, ensuring consistent behavior across your services
- **Multiple Breaker Strategies**: Choose from consecutive failures, sliding window, and time-based sampling to detect service unhealthiness
- **Flexible Backoff Strategies**: Configure constant or exponential backoff for health checks, preventing service overload during recovery
- **Leader Election**: Ensures a single instance is responsible for critical circuit state management and health checks, preventing race conditions
- **Event-Driven**: Real-time state coordination and event processing powered by Redis Streams
- **Prometheus Metrics**: Built-in observability with customizable labels for easy monitoring

## Next Steps

- [Get started with Zenvark](./getting-started.md)
- [Learn about the architecture](./guides/architecture.md)
- [Explore the API reference](./api/circuit-breaker.md)
