---
sidebar_position: 1
---

# Architecture

This distributed circuit breaker leverages Redis for its core coordination mechanisms.

## Why Distributed?

When multiple instances of an application are running concurrently (whether they are part of a microservice, a monolith scaled horizontally, or any other distributed setup), a traditional in-memory circuit breaker on a single instance isn't enough.

If one instance detects a problem and opens its circuit, other instances, unaware of the issue, might continue to send requests to the failing dependency.

A distributed circuit breaker ensures that if any one instance detects a problem and opens the circuit, **all other instances become aware** of this state change and also open their circuits. This collective awareness prevents individual instances from continuing to hammer an unhealthy service, effectively stopping cascading failures and ensuring consistent resilience across all running instances of your application.

## Distributed Coordination

Zenvark uses Redis to coordinate state across all instances:

### Leader Election

- Uses Redis to elect a single leader instance
- The leader is responsible for circuit state decisions
- Prevents race conditions in state management
- Automatically handles leader failures and re-election
- Non-leader instances (followers) listen for state updates

### Event Streaming

- Call results (success/failure) from all instances are stored in Redis Streams
- Provides real-time coordination between instances
- Ensures all instances have visibility into the system's health
- Ordered event processing maintains consistency

### State Synchronization

- All instances subscribe to Redis Streams for real-time updates
- Circuit state changes initiated by the leader are broadcast immediately
- Ensures immediate and consistent behavior across all instances
- No polling required - updates are pushed in real-time

:::tip
For a deeper dive into how Redis Streams facilitate real-time data processing and coordination, refer to the [official Redis Streams documentation](https://redis.io/docs/latest/develop/data-types/streams/).
:::

### Step-by-Step Process

1. **Record Call Results**
   - Each application instance records the outcome (success or failure) of protected calls
   - Results are written to Redis Streams for coordination
   - All instances can see all call results

2. **Leader Evaluation**
   - The elected leader instance continuously processes call results
   - Evaluates results against the configured breaker strategy
   - Makes decisions on behalf of all instances

3. **Circuit Opens**
   - If the leader determines the failure threshold is breached
   - It broadcasts an "open circuit" command via Redis Streams
   - Command is received by all instances in real-time

4. **State Synchronization**
   - All instances receive the "open circuit" command
   - Each instance updates its local state to OPEN
   - All instances begin blocking requests to the unhealthy service

5. **Health Checks**
   - While the circuit is open, the leader runs periodic health checks
   - Uses the configured backoff strategy to prevent overload
   - Only the leader performs health checks (followers wait for updates)

6. **Circuit Closes**
   - When a health check passes, the leader broadcasts "close circuit"
   - All instances receive the update and transition to CLOSED
   - Normal operation resumes across all instances

## Key Design Principles

### 1. Single Source of Truth

Redis serves as the single source of truth for:

- Circuit state (OPEN/CLOSED)
- Leader election status
- Call result events
- Health check coordination

### 2. Eventually Consistent

- State changes propagate quickly but are eventually consistent
- All instances converge to the same state
- Network partitions are handled gracefully

### 3. Fail-Safe Defaults

- If coordination fails, circuit remains in its current state
- Error callbacks allow applications to handle failures
- No silent failures - errors are surfaced

### 4. Minimal Latency

- State checks use local cache
- No network calls during `execute()`
- Redis operations are asynchronous and non-blocking

### 5. Scalability

- Supports any number of application instances
- Redis Streams handle high throughput
- Leader election scales with instance count

## Performance Considerations

### Memory Usage

- Each circuit breaker maintains minimal state in memory
- Redis stores event history (configurable retention)
- Prometheus metrics are stored in-memory

### Network Overhead

- Call results are written to Redis asynchronously
- State updates pushed via Redis pub/sub
- Health checks only performed by leader

## Fault Tolerance

### Redis Failures

- Circuit breaker continues operating with last known state
- Errors surfaced via `onError` callback
- Recovery automatic when Redis reconnects

### Leader Failures

- New leader automatically elected
- Health checks resume under new leader
- No state is lost during transition

### Network Partitions

- Instances continue operating with cached state
- State reconciliation when partition heals
