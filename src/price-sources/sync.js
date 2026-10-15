import { parseRouteKey } from '../pricing.js';
import { isDeepSeekRoute } from '../time-of-use.js';

export const emptyReport = () => ({
	updated: [],
	unmatched: [],
	unsupported: [],
	ambiguous: [],
	details: [],
});

export function syncPrices(config, catalog, adapter) {
	const pricing = { ...config.pricing },
		report = emptyReport(),
		now = Date.now();
	for (const [key, previous] of Object.entries(config.pricing)) {
		const route = parseRouteKey(key);
		const offer = route ? adapter.offer(route.model, catalog, now) : { status: 'unmatched' };
		if (!offer.rate || (isDeepSeekRoute(key) && previous.autoOffPeak === true && offer.peakBasis !== true)) {
			const status = offer.rate ? 'unsupported' : offer.status;
			report[status].push(key);
			report.details.push({ route: key, reason: offer.rate ? 'offPeakBasis' : (offer.reason ?? status) });
			continue;
		}
		const currency = previous.currency ?? 'USD',
			factor = currency === 'CNY' ? config.cnyPerUsd : 1;
		const next = { ...previous, currency, source: adapter.id };
		for (const [field, value] of Object.entries(offer.rate))
			next[field] = Number((value * factor).toPrecision(12));
		if (
			Object.values(offer.rate).some((value) => !Number.isFinite(value) || value < 0) ||
			Object.keys(offer.rate).some((field) => !Number.isFinite(next[field]))
		) {
			report.unsupported.push(key);
			report.details.push({ route: key, reason: 'invalidPrice' });
			continue;
		}
		pricing[key] = next;
		report.updated.push(key);
		if (offer.preservedFields?.length)
			report.details.push({ route: key, reason: 'cacheWriteAmbiguous', fields: offer.preservedFields });
	}
	return { config: { ...config, pricing }, report };
}
