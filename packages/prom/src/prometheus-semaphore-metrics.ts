import type { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type {
  RecordAcquireParams,
  RecordLimitChangeParams,
  RecordReleaseParams,
  RecordThrottleParams,
  SemaphoreMetricsRecorder,
} from 'zenvark';
import {
  getOrCreateCounter,
  getOrCreateGauge,
  getOrCreateHistogram,
} from './get-or-create-metric.ts';

export type PrometheusSemaphoreMetricsOptions = {
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

export class PrometheusSemaphoreMetrics implements SemaphoreMetricsRecorder {
  private readonly customLabels: Record<string, string>;

  private readonly acquireWaitHistogram: Histogram<string>;
  private readonly holdDurationHistogram: Histogram<string>;
  private readonly limitGauge: Gauge<string>;
  private readonly throttleEventsCounter: Counter<string>;

  constructor(options: PrometheusSemaphoreMetricsOptions) {
    const prefix = options.prefix ?? 'zenvark';
    this.customLabels = options.customLabels ?? {};

    const customLabelNames = Object.keys(this.customLabels);

    this.acquireWaitHistogram = getOrCreateHistogram(options.registry, {
      name: `${prefix}_semaphore_acquire_wait_seconds`,
      help: 'Time spent waiting for a semaphore lease in seconds, by acquire result.',
      labelNames: ['semaphore_id', 'class', 'result', ...customLabelNames],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [options.registry],
    });

    this.holdDurationHistogram = getOrCreateHistogram(options.registry, {
      name: `${prefix}_semaphore_hold_duration_seconds`,
      help: 'Time a semaphore lease was held in seconds, by release outcome.',
      labelNames: ['semaphore_id', 'class', 'outcome', ...customLabelNames],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
      registers: [options.registry],
    });

    this.limitGauge = getOrCreateGauge(options.registry, {
      name: `${prefix}_semaphore_limit`,
      help: "This process's cached view of the fleet-wide semaphore limit.",
      labelNames: ['semaphore_id', ...customLabelNames],
      registers: [options.registry],
    });

    this.throttleEventsCounter = getOrCreateCounter(options.registry, {
      name: `${prefix}_semaphore_throttle_events_total`,
      help: 'Total number of THROTTLED releases reported by callers.',
      labelNames: ['semaphore_id', ...customLabelNames],
      registers: [options.registry],
    });
  }

  /**
   * Initialize metrics for a semaphore.
   * Sets the throttle counter to 0 so the metric appears in scrapes immediately.
   */
  initialize(id: string): void {
    const labels = this.getLabels(id);

    this.throttleEventsCounter.inc(labels, 0);
  }

  private getLabels(
    semaphoreId: string,
    additionalLabels: Record<string, string> = {},
  ): Record<string, string> {
    return {
      ...this.customLabels,
      semaphore_id: semaphoreId,
      ...additionalLabels,
    };
  }

  /**
   * Record the outcome of an acquire attempt and the time spent waiting
   */
  recordAcquire(params: RecordAcquireParams): void {
    const labels = this.getLabels(params.id, {
      class: params.class ?? '',
      result: params.result,
    });

    this.acquireWaitHistogram.observe(labels, params.waitMs / 1000);
  }

  /**
   * Record a lease release with its outcome and hold duration
   */
  recordRelease(params: RecordReleaseParams): void {
    const labels = this.getLabels(params.id, {
      class: params.class ?? '',
      outcome: params.outcome,
    });

    this.holdDurationHistogram.observe(labels, params.heldMs / 1000);
  }

  /**
   * Record a change of the cached fleet-wide limit
   */
  recordLimitChange(params: RecordLimitChangeParams): void {
    const labels = this.getLabels(params.id);

    this.limitGauge.set(labels, params.limit);
  }

  /**
   * Record a caller-reported throttle event
   */
  recordThrottle(params: RecordThrottleParams): void {
    const labels = this.getLabels(params.id);

    this.throttleEventsCounter.inc(labels, 1);
  }
}
