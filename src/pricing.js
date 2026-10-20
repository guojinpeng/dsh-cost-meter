import { PEAK_RULE_IDS, peakRule, pricePeriod } from './time-of-use.js';
import { PRICE_SOURCES } from './price-sources.js';

export const RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'];
export const zeroRate = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** Wire fields of a priced period. */
const FIELDS = ['input', 'output', 'read', 'write'];
/** Period keys a route reports money and tokens for. */
const PERIODS = ['peak', 'offPeak', 'fixed', 'unknown'];
const zeroFields = () => ({ input: 0, output: 0, read: 0, write: 0 });
const roundFields = (fields) =>
	Object.fromEntries(FIELDS.map((field) => [field, Math.round(fields[field])]));
export const newRate = () => ({ ...zeroRate(), currency: 'USD', autoOffPeak: false });

export function convertRateCurrency(rate, currency, cnyPerUsd) {
	const previous = rate.currency ?? 'USD';
	const factor = previous === currency ? 1 : currency === 'CNY' ? cnyPerUsd : 1 / cnyPerUsd;
	return {
		...rate,
		currency,
		...Object.fromEntries(RATE_KEYS.map((key) => [key, Number((rate[key] * factor).toPrecision(12))])),
	};
}

export function normalizeRate(entry) {
	if (!entry || typeof entry !== 'object') return null;
	if (
		!['input', 'output'].every(
			(key) => typeof entry[key] === 'number' && Number.isFinite(entry[key]) && entry[key] >= 0,
		)
	)
		return null;
	return {
		...Object.fromEntries(
			RATE_KEYS.map((key) => [key, Number.isFinite(entry[key]) && entry[key] >= 0 ? entry[key] : 0]),
		),
		...(entry.currency === 'USD' || entry.currency === 'CNY' ? { currency: entry.currency } : {}),
		...(typeof entry.autoOffPeak === 'boolean' ? { autoOffPeak: entry.autoOffPeak } : {}),
		...(PEAK_RULE_IDS.includes(entry.peakRule) ? { peakRule: entry.peakRule } : {}),
		...([...PRICE_SOURCES, 'manual'].includes(entry.source) ? { source: entry.source } : {}),
	};
}

export function parseRouteKey(key) {
	const slash = key.indexOf('/');
	return slash > 0 && slash < key.length - 1
		? { provider: key.slice(0, slash), model: key.slice(slash + 1) }
		: null;
}

export function tokensOf(buckets) {
	return (
		buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
	);
}

function wireTokens(buckets) {
	return {
		input: buckets.uncachedInputTokens,
		output: buckets.outputTokens,
		read: buckets.cacheReadTokens,
		write: buckets.cacheWriteTokens,
	};
}

function priceRoutes(byRoute, config, byTime = {}, calendars = {}) {
	let micros = 0,
		unpricedTokens = 0;
	const bucketMicros = { input: 0, output: 0, read: 0, write: 0 };
	const routes = [],
		amounts = new Map();
	let peakTokens = 0,
		offPeakTokens = 0,
		uncertainTokens = 0;
	for (const [key, buckets] of Object.entries(byRoute)) {
		const rate = normalizeRate(config.pricing[key]);
		const totalTokens = tokensOf(buckets);
		const currency = rate?.currency ?? 'USD';
		const usdFactor = currency === 'CNY' ? 1 / config.cnyPerUsd : 1;
		let amount = 0;
		const periodParts = Object.fromEntries(PERIODS.map((period) => [period, zeroFields()]));
		const periodTokens = Object.fromEntries(PERIODS.map((period) => [period, zeroFields()]));
		let rates = null;
		if (rate === null) unpricedTokens += totalTokens;
		else {
			const parts = zeroFields();
			const rule = peakRule(rate.peakRule);
			const samples = rate.autoOffPeak
				? Object.entries(byTime[key] ?? { unknown: buckets })
				: [['fixed', buckets]];
			for (const [time, sample] of samples) {
				const period = time === 'fixed' ? 'fixed' : pricePeriod(time, rule.id, calendars);
				const factor = period === 'offPeak' ? rule.factor : 1;
				if (period === 'peak') peakTokens += tokensOf(sample);
				if (period === 'offPeak') offPeakTokens += tokensOf(sample);
				if (period === 'unknown') uncertainTokens += tokensOf(sample);
				const sampleParts = {
					input: sample.uncachedInputTokens * rate.input * factor,
					output: sample.outputTokens * rate.output * factor,
					read: sample.cacheReadTokens * rate.cacheRead * factor,
					write: sample.cacheWriteTokens * rate.cacheWrite * factor,
				};
				const sampleTokens = {
					input: sample.uncachedInputTokens,
					output: sample.outputTokens,
					read: sample.cacheReadTokens,
					write: sample.cacheWriteTokens,
				};
				for (const field of FIELDS) {
					parts[field] += sampleParts[field];
					periodParts[period][field] += sampleParts[field];
					periodTokens[period][field] += sampleTokens[field];
				}
			}
			amount = Object.values(parts).reduce((sum, value) => sum + value, 0);
			micros += amount * usdFactor;
			const group = amounts.get(currency) ?? {
				currency,
				micros: 0,
				bucketMicros: zeroFields(),
				periodMicros: Object.fromEntries(PERIODS.map((period) => [period, zeroFields()])),
			};
			group.micros += amount;
			for (const field of FIELDS) {
				bucketMicros[field] += parts[field] * usdFactor;
				group.bucketMicros[field] += parts[field];
			}
			for (const period of PERIODS)
				for (const field of FIELDS) group.periodMicros[period][field] += periodParts[period][field];
			amounts.set(currency, group);
			rates = {
				input: rate.input,
				output: rate.output,
				read: rate.cacheRead,
				write: rate.cacheWrite,
				factor: rule.factor,
				rule: rule.id,
			};
		}
		routes.push({
			route: key,
			currency,
			amountMicros: Math.round(amount),
			micros: Math.round(amount * usdFactor),
			totalTokens,
			priced: rate !== null,
			periodMicros: Object.fromEntries(PERIODS.map((period) => [period, roundFields(periodParts[period])])),
			tokensByPeriod: periodTokens,
			...(rates === null ? {} : { rates }),
		});
	}
	for (const key of FIELDS) bucketMicros[key] = Math.round(bucketMicros[key]);
	for (const group of amounts.values()) {
		group.micros = Math.round(group.micros);
		for (const key of FIELDS) group.bucketMicros[key] = Math.round(group.bucketMicros[key]);
		for (const period of PERIODS)
			for (const field of FIELDS) group.periodMicros[period][field] = Math.round(group.periodMicros[period][field]);
	}
	return {
		micros: Math.round(micros),
		unpricedTokens,
		bucketMicros,
		routes,
		amounts: [...amounts.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
		peakTokens,
		offPeakTokens,
		uncertainTokens,
	};
}

/** The same calculation serves host projections and reactive client displays. */
export function buildCostView(accounting, config) {
	const pricedSession = priceRoutes(accounting.byRoute, config, accounting.byTime, accounting.calendars);
	const {
		micros: totalMicros,
		unpricedTokens,
		bucketMicros,
		routes,
		amounts,
		peakTokens,
		offPeakTokens,
		uncertainTokens,
	} = pricedSession;
	routes.sort((a, b) => b.micros - a.micros || b.totalTokens - a.totalTokens);
	const turns = {};
	for (const [key, entry] of Object.entries(accounting.turns)) {
		const priced = priceRoutes(entry.byRoute, config, entry.byTime, accounting.calendars);
		turns[key] = {
			micros: priced.micros,
			amounts: priced.amounts,
			peakTokens: priced.peakTokens,
			offPeakTokens: priced.offPeakTokens,
			uncertainTokens: priced.uncertainTokens,
			totalTokens: entry.totalTokens,
			route: Object.keys(entry.byRoute).join(', '),
			routes: priced.routes,
			tokens: wireTokens(entry.tokens),
			bucketMicros: priced.bucketMicros,
			priced: priced.unpricedTokens === 0,
			recovered: entry.recovered,
		};
	}
	const prompt = tokensOf(accounting.totals) - accounting.totals.outputTokens;
	// The view total is USD money; name the currency that displays it.
	const currency =
		config.currency === 'USD' || config.currency === 'CNY'
			? config.currency
			: amounts.some((entry) => entry.currency === 'CNY')
				? 'CNY'
				: 'USD';
	return {
		currency,
		cnyPerUsd: config.cnyPerUsd,
		totalMicros,
		totalTokens: tokensOf(accounting.totals),
		tokens: wireTokens(accounting.totals),
		bucketMicros,
		amounts,
		peakTokens,
		offPeakTokens,
		uncertainTokens,
		cacheHitPct: prompt === 0 ? null : Math.round((accounting.totals.cacheReadTokens / prompt) * 1000) / 10,
		skippedTurns: accounting.skippedTurns,
		unpricedTokens,
		showDock: config.showDockChip !== false,
		showTurn: config.showTurnChip !== false,
		routes: routes.slice(0, 8),
		turns,
	};
}
