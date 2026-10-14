import { matchModel, priceNumber } from './offers.js';

export const deepInfra = {
	id: 'api.deepinfra.com',
	url: 'https://api.deepinfra.com/models/list',
	validCatalog: (value) =>
		Array.isArray(value) && value.some((entry) => typeof entry?.model_name === 'string' && entry.pricing),
	offer(model, catalog, now = Date.now()) {
		const matched = matchModel(
			model,
			catalog
				.filter((entry) => typeof entry?.model_name === 'string')
				.map((entry) => ({ ...entry, id: entry.model_name })),
		);
		if (!matched.entry) return matched;
		const entry = matched.entry,
			cost = entry.pricing;
		if ((entry.deprecated != null && entry.deprecated <= now / 1000) || entry.private > 0)
			return { status: 'unsupported', reason: 'unavailableModel' };
		if (entry.type !== 'text-generation' || cost?.type !== 'tokens')
			return { status: 'unsupported', reason: 'nonTokenPricing' };
		const input = priceNumber(cost.cents_per_input_token),
			output = priceNumber(cost.cents_per_output_token);
		if (input === null || output === null) return { status: 'unsupported', reason: 'invalidPrice' };
		let discount = 0;
		if (cost.discount != null && (cost.discount_ends_at == null || cost.discount_ends_at > now / 1000)) {
			discount = priceNumber(cost.discount);
			if (discount === null || discount > 1) return { status: 'unsupported', reason: 'invalidPrice' };
		}
		const rate = { input: input * 10000 * (1 - discount), output: output * 10000 * (1 - discount) };
		for (const [source, target] of [
			['rate_per_input_token_cached', 'cacheRead'],
			['rate_per_input_token_cache_write', 'cacheWrite'],
		]) {
			if (cost[source] == null) continue;
			const multiplier = priceNumber(cost[source]);
			if (multiplier === null) return { status: 'unsupported', reason: 'invalidPrice' };
			rate[target] = rate.input * multiplier;
		}
		const writes = Object.values(cost.rate_per_explicit_cache_write_token ?? {});
		if (rate.cacheWrite === undefined && writes.length === 1) {
			const multiplier = priceNumber(writes[0]);
			if (multiplier === null) return { status: 'unsupported', reason: 'invalidPrice' };
			rate.cacheWrite = rate.input * multiplier;
		}
		return {
			rate,
			...(rate.cacheWrite === undefined && writes.length > 1 ? { preservedFields: ['cacheWrite'] } : {}),
		};
	},
};
