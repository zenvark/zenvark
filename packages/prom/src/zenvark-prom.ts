import type { Registry } from '@prometheus-io/client';
import type {
  AcquireEvent,
  BlockedRequestEvent,
  BreakerInitEvent,
  CallEndEvent,
  HealthCheckEndEvent,
  LimitChangeEvent,
  ReleaseEvent,
  RoleChangeEvent,
  SemaphoreInitEvent,
  StateChangeEvent,
  Telemetry,
  ThrottleEvent,
} from 'zenvark';
import { CircuitRole } from 'zenvark';
import { PrometheusBreakerMetrics } from './prometheus-breaker-metrics.ts';
import { PrometheusSemaphoreMetrics } from './prometheus-semaphore-metrics.ts';

export type ZenvarkPromOptions = {
  /**
   * Prometheus registry instance
   */
  registry: Registry;

  /**
   * Prefix for all metric names (default: 'zenvark')
   */
  prefix?: string;

  /**
   * Custom labels to add to all metrics
   */
  customLabels?: Record<string, string>;
};

/**
 * Telemetry integration recording circuit breaker and semaphore metrics in
 * a Prometheus registry. Reports the same metrics as the deprecated
 * `PrometheusBreakerMetrics` and `PrometheusSemaphoreMetrics`.
 */
export class ZenvarkProm implements Telemetry {
  private readonly breaker: PrometheusBreakerMetrics;
  private readonly semaphore: PrometheusSemaphoreMetrics;

  constructor(options: ZenvarkPromOptions) {
    this.breaker = new PrometheusBreakerMetrics(options);
    this.semaphore = new PrometheusSemaphoreMetrics(options);
  }

  onBreakerInit({ breakerId }: BreakerInitEvent): void {
    this.breaker.initialize(breakerId);
  }

  onCallEnd(event: CallEndEvent): void {
    this.breaker.recordCall(event);
  }

  onBlockedRequest(event: BlockedRequestEvent): void {
    this.breaker.recordBlockedRequest(event);
  }

  onHealthCheckEnd(event: HealthCheckEndEvent): void {
    this.breaker.recordHealthCheck(event);
  }

  onStateChange(event: StateChangeEvent): void {
    this.breaker.recordStateChange(event);
  }

  // The state gauge is reported by the leader only, so a scrape of any
  // other instance does not show a stale state
  onRoleChange({ breakerId, role, state }: RoleChangeEvent): void {
    if (role === CircuitRole.LEADER) {
      this.breaker.recordStateChange({ breakerId, state });
    } else {
      this.breaker.clearState(breakerId);
    }
  }

  onSemaphoreInit({ semaphoreId }: SemaphoreInitEvent): void {
    this.semaphore.initialize(semaphoreId);
  }

  onAcquire({ semaphoreId, ...event }: AcquireEvent): void {
    this.semaphore.recordAcquire({ id: semaphoreId, ...event });
  }

  onRelease({ semaphoreId, ...event }: ReleaseEvent): void {
    this.semaphore.recordRelease({ id: semaphoreId, ...event });
  }

  onLimitChange({ semaphoreId, ...event }: LimitChangeEvent): void {
    this.semaphore.recordLimitChange({ id: semaphoreId, ...event });
  }

  onThrottle({ semaphoreId }: ThrottleEvent): void {
    this.semaphore.recordThrottle({ id: semaphoreId });
  }
}
