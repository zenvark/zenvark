import {
	Counter,
	type CounterConfiguration,
	Histogram,
	type HistogramConfiguration,
	type Registry,
} from 'prom-client';

const getTypeParam = (obj: unknown): string | undefined => {
	if (
		typeof obj === 'object' &&
		obj !== null &&
		'type' in obj &&
		typeof obj.type === 'string'
	) {
		return obj.type;
	}
};

const isCounter = (metric: unknown): metric is Counter => {
	return metric instanceof Counter || getTypeParam(metric) === 'counter';
};

export const getOrCreateCounter = <TLabels extends string>(
	register: Registry,
	config: CounterConfiguration<TLabels>,
): Counter<TLabels> => {
	const existingMetric = register.getSingleMetric(config.name);

	return isCounter(existingMetric) ? existingMetric : new Counter(config);
};

const isHistogram = (metric: unknown): metric is Histogram => {
	return metric instanceof Histogram || getTypeParam(metric) === 'histogram';
};

export const getOrCreateHistogram = <TLabels extends string>(
	register: Registry,
	config: HistogramConfiguration<TLabels>,
): Histogram<TLabels> => {
	const existingMetric = register.getSingleMetric(config.name);

	return isHistogram(existingMetric) ? existingMetric : new Histogram(config);
};
