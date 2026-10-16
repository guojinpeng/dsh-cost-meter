import { RATE_KEYS, parseRouteKey, zeroRate } from '../pricing.js';
import { resolvedPriceSource } from '../price-sources.js';

/** Draft rates are text so an input can hold a value the user is still typing. */
const text = (value) => (value === undefined || value === null || value === '' ? '' : String(value));

const number = (value) => {
	const trimmed = String(value ?? '').trim();
	return trimmed === '' ? Number.NaN : Number(trimmed);
};

export const invalidPrice = (value) => !Number.isFinite(number(value)) || number(value) < 0;

export const invalidCnyPerUsd = (value) => !(number(value) > 0);

export const rateOf = (row) => Object.fromEntries(RATE_KEYS.map((field) => [field, number(row[field])]));

export const rateText = (rate) => Object.fromEntries(RATE_KEYS.map((field) => [field, text(rate[field] ?? 0)]));

/** A model id the route parser accepts, or null. */
export const parseModelKey = (value) => {
	const key = String(value ?? '').trim();
	return parseRouteKey(key) === null ? null : key;
};

export const newRow = (key) => ({
	key,
	currency: 'USD',
	...Object.fromEntries(RATE_KEYS.map((field) => [field, '0'])),
	autoOffPeak: false,
});

export function buildDraft(payload) {
	const config = payload?.config ?? {};
	const pricing = config.pricing ?? {};
	return {
		currency: config.currency,
		priceSource: resolvedPriceSource(config),
		cnyPerUsd: text(config.cnyPerUsd ?? 7.2),
		showDockChip: config.showDockChip !== false,
		showTurnChip: config.showTurnChip !== false,
		rows: (payload?.models ?? []).map((key) => {
			const rate = pricing[key] ?? zeroRate();
			return {
				key,
				currency: rate.currency ?? 'USD',
				...rateText(rate),
				autoOffPeak: rate.autoOffPeak === true,
				...(rate.peakRule ? { peakRule: rate.peakRule } : {}),
				...(rate.source ? { source: rate.source } : {}),
			};
		}),
	};
}

export function configOf(draft) {
	const cnyPerUsd = number(draft.cnyPerUsd);
	if (!(cnyPerUsd > 0)) throw new Error('Invalid USD/CNY exchange rate');
	const pricing = {};
	for (const row of draft.rows) {
		const rate = rateOf(row);
		for (const field of RATE_KEYS) if (invalidPrice(rate[field])) throw new Error(`Invalid rate: ${row.key}`);
		pricing[row.key] = {
			input: rate.input,
			output: rate.output,
			cacheRead: rate.cacheRead,
			cacheWrite: rate.cacheWrite,
			currency: row.currency === 'CNY' ? 'CNY' : 'USD',
			...(row.autoOffPeak === true ? { autoOffPeak: true } : {}),
			...(row.peakRule ? { peakRule: row.peakRule } : {}),
			...(row.source ? { source: row.source } : {}),
		};
	}
	return {
		...(draft.currency ? { currency: draft.currency } : {}),
		priceSource: draft.priceSource,
		cnyPerUsd,
		showDockChip: draft.showDockChip,
		showTurnChip: draft.showTurnChip,
		pricing,
	};
}

/** Stage a sync preview over the draft, keeping rows the source did not match. */
export function applyPreview(draft, config) {
	const pricing = config?.pricing ?? {};
	return {
		...draft,
		rows: draft.rows.map((row) => {
			const rate = pricing[row.key];
			if (rate === undefined) return row;
			return {
				...row,
				currency: rate.currency ?? row.currency,
				...rateText(rate),
				...(rate.source ? { source: rate.source } : {}),
			};
		}),
	};
}

export function deepEqual(a, b) {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	return keys.every((key) => deepEqual(a[key], b[key]));
}
