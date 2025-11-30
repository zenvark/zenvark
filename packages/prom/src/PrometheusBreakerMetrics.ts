import type { Counter, Histogram, Registry } from 'prom-client';
import type {
	BreakerMetricsRecorder,
	RecordBlockedRequestParams,
	RecordCallParams,
	RecordHealthCheckParams,
} from 'zenvark';
import {
	getOrCreateCounter,
	getOrCreateHistogram,
} from './getOrCreateMetric.ts';

export type PrometheusBreakerMetricsOptions = {
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

export class PrometheusBreakerMetrics implements BreakerMetricsRecorder {
	private readonly customLabels: Record<string, string>;

	private readonly callDurationHistogram: Histogram<string>;
	private readonly blockedRequestsCounter: Counter<string>;
	private readonly healthcheckDurationHistogram: Histogram<string>;

	constructor(options: PrometheusBreakerMetricsOptions) {
		const prefix = options.prefix ?? 'zenvark';
		this.customLabels = options.customLabels ?? {};

		const customLabelNames = Object.keys(this.customLabels);

		this.callDurationHistogram = getOrCreateHistogram(options.registry, {
			name: `${prefix}_call_duration_seconds`,
			help: 'Duration of calls executed by the circuit breaker in seconds.',
			labelNames: ['breaker_id', 'result', ...customLabelNames],
			buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
			registers: [options.registry],
		});

		this.blockedRequestsCounter = getOrCreateCounter(options.registry, {
			name: `${prefix}_blocked_requests_total`,
			help: 'Total number of requests blocked by the circuit breaker due to open state.',
			labelNames: ['breaker_id', ...customLabelNames],
			registers: [options.registry],
		});

		this.healthcheckDurationHistogram = getOrCreateHistogram(options.registry, {
			name: `${prefix}_healthcheck_duration_seconds`,
			help: 'Duration of health check attempts executed by the circuit breaker in seconds.',
			labelNames: ['breaker_id', 'type', 'result', ...customLabelNames],
			buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
			registers: [options.registry],
		});
	}

	/**
	 * Initialize metrics for a circuit breaker.
	 * Sets the blocked requests counter to 0 so the metric appears in scrapes immediately.
	 */
	initialize(breakerId: string): void {
		const labels = this.getLabels(breakerId);

		this.blockedRequestsCounter.inc(labels, 0);
	}

	private getLabels(
		breakerId: string,
		additionalLabels: Record<string, string> = {},
	): Record<string, string> {
		return {
			...this.customLabels,
			breaker_id: breakerId,
			...additionalLabels,
		};
	}

	/**
	 * Record a successful or failed call
	 */
	recordCall(params: RecordCallParams): void {
		const labels = this.getLabels(params.breakerId, {
			result: params.result,
		});

		this.callDurationHistogram.observe(labels, params.durationMs / 1000);
	}

	/**
	 * Record a blocked request when circuit is open
	 */
	recordBlockedRequest(params: RecordBlockedRequestParams): void {
		const labels = this.getLabels(params.breakerId);

		this.blockedRequestsCounter.inc(labels, 1);
	}

	/**
	 * Record healthcheck attempt
	 */
	recordHealthCheck(params: RecordHealthCheckParams): void {
		const labels = this.getLabels(params.breakerId, {
			type: params.type,
			result: params.result,
		});

		this.healthcheckDurationHistogram.observe(labels, params.durationMs / 1000);
	}
}
