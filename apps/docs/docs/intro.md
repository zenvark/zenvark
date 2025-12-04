---
sidebar_position: 1
slug: /
---

# Introduction

A robust distributed circuit breaker, coordinated via Redis, designed for high-availability applications.

Zenvark helps you build resilient systems by preventing cascading failures and gracefully handling degraded services.

## Why Distributed?

When multiple instances of an application are running concurrently (whether they are part of a microservice, a monolith scaled horizontally, or any other distributed setup), a traditional in-memory circuit breaker on a single instance isn't enough.

If one instance detects a problem and opens its circuit, other instances, unaware of the issue, might continue to send requests to the failing dependency.

A distributed circuit breaker ensures that if any one instance detects a problem and opens the circuit, **all other instances become aware** of this state change and also open their circuits. This collective awareness prevents individual instances from continuing to hammer an unhealthy service, effectively stopping cascading failures and ensuring consistent resilience across all running instances of your application.

## Key Features

- **Distributed Coordination**: Multiple instances coordinate circuit state using Redis, ensuring consistent behavior across your services
- **Multiple Breaker Strategies**: Choose from consecutive failures, sliding window, and time-based sampling to detect service unhealthiness
- **Flexible Backoff Strategies**: Configure constant or exponential backoff for health checks, preventing service overload during recovery
- **Leader Election**: Ensures a single instance is responsible for critical circuit state management and health checks, preventing race conditions
- **Event-Driven**: Real-time state coordination and event processing powered by Redis Streams
- **Prometheus Metrics**: Built-in observability with customizable labels for easy monitoring

## Prerequisites

- **Node.js**: 22.x or higher
- **Redis**: 6.0 or higher (Redis Streams support required)

## Next Steps

- [Get started with Zenvark](./getting-started.md)
- [Learn about the architecture](./guides/architecture.md)
- [Explore the API reference](./api/circuit-breaker.md)
