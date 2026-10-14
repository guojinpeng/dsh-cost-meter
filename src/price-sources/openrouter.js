import { matchModel, priceNumber } from './offers.js';

export const openRouter = {
	id: 'openrouter.ai',
	url: 'https://openrouter.ai/api/v1/models',
	validCatalog: (value) =>
		Array.isArray(value?.data) && value.data.some((entry) => typeof entry?.id === 'string' && entry.pricing),
	offer(model, catalog) {
		const matched = matchModel(
			model,
			catalog.data.filter((entry) => typeof entry?.id === 'string'),
		);
		if (!matched.entry) return matched;
		const entry = matched.entry,
			cost = entry.pricing;
		if (!cost) return { status: 'unsupported', reason: 'invalidPrice' };
		if (entry.architecture?.output_modalities && !entry.architecture.output_modalities.includes('text'))
			return { status: 'unsupported', reason: 'nonTokenPricing' };
		if (
			cost.overrides?.length ||
			(cost.internal_reasoning !== undefined && cost.internal_reasoning !== cost.completion)
		)
			return { status: 'unsupported', reason: 'conditionalPricing' };
		const rate = {};
		for (const [source, target] of [
			['prompt', 'input'],
			['completion', 'output'],
			['input_cache_read', 'cacheRead'],
			['input_cache_write', 'cacheWrite'],
		]) {
			if (cost[source] === undefined && target.startsWith('cache')) continue;
			const value = priceNumber(cost[source]);
			if (value === null) return { status: 'unsupported', reason: 'invalidPrice' };
			rate[target] = value * 1000000;
		}
		return {
			rate,
			...(cost.input_cache_write === undefined && cost.input_cache_write_1h !== undefined
				? { preservedFields: ['cacheWrite'] }
				: {}),
		};
	},
};
