---
sidebar_position: 10
---

# Development

Tools and resources for developing with Zenvark.

## Interactive Terminal Simulator (TUI)

For local development and demos, this package includes an Ink-based terminal UI that simulates two distributed circuit breaker instances coordinating via Redis.

The simulator lets you trigger successes/failures, toggle health check outcomes, and observe leader election and state transitions in real time.

### Prerequisites

- Node.js 22.x or higher
- Docker (for Redis)

### Starting the Simulator

1. **Start Redis locally:**

```bash
cd apps/terminal-ui && npm run docker:start
```

This starts a Redis container on `localhost:6379` with a development password.

2. **Run the terminal simulator:**

```bash
npm run start
```

### Controls

| Key              | Action                      |
| ---------------- | --------------------------- |
| Tab / Shift+Tab  | Move focus between controls |
| Enter / Space    | Activate focused control    |
| q / Esc / Ctrl+C | Quit simulator              |

### Available Actions

#### Healthcheck Returns Toggle

Switch between **Success** and **Failure** to simulate dependency recovery/failure during health checks.

#### Circuit A/B Controls

- **Start/Stop**: Start or stop each circuit breaker instance
- **Trigger Success**: Record a successful call result
- **Trigger Failure**: Record a failed call result

### What You'll See

The simulator displays:

1. **Two Instances (A and B)**
   - Share the same `breaker_id` for coordination
   - Coordinate state via Redis Streams
   - Each has independent UI controls

2. **Leader/Follower Roles**
   - Observe leader election in action
   - See role changes when instances start/stop
   - Leader performs health checks

3. **Circuit State Transitions**
   - Watch circuits open after failures
   - Observe automatic recovery via health checks
   - See state synchronization between instances

4. **Health Check Behavior**
   - Idle probes when circuit is closed and inactive
   - Recovery checks with backoff when circuit is open
   - Health check results affect circuit state

### Cleanup

Stop the Redis container when done:

```bash
npm run docker:stop
```

## Development Notes

### Debugging

Enable detailed logging:

```typescript
const circuitBreaker = new CircuitBreaker({
  // ...
  onError: (err) => {
    console.error("CB Error:", err);
  },
  onStateChange: (state) => {
    console.log("State changed:", state);
  },
  onRoleChange: (role) => {
    console.log("Role changed:", role);
  },
});
```

### Redis Streams Inspection

View circuit breaker data in Redis:

```bash
# Connect to Redis CLI
redis-cli

# View circuit state
GET zenvark:my-service-api:state

# View call results stream
XREAD STREAMS zenvark:my-service-api:calls 0

# View state updates stream
XREAD STREAMS zenvark:my-service-api:updates 0

# View leader info
GET zenvark:my-service-api:leader
```

## Contributing

Contributions are welcome! Please see the [GitHub repository](https://github.com/zenvark/zenvark) for:

- Issue tracking
- Pull request guidelines
- Development setup
- Coding standards

## Resources

- [GitHub Repository](https://github.com/zenvark/zenvark)
- [npm Package](https://www.npmjs.com/package/zenvark)
- [Redis Streams Documentation](https://redis.io/docs/latest/develop/data-types/streams/)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
