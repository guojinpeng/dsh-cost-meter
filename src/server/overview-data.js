import { buildCostView, tokensOf } from '../pricing.js';

/** Selectable ranges: today, 7, 30, 90 days, or everything. */
export const RANGE_DAYS = { today: 1, '7': 7, '30': 30, '90': 90, all: 0 };

/** Clock windows, in the order the projection records them. */
export const SEGMENTS = ['night', 'morning', 'am', 'noon', 'pm', 'evening', 'late'];

const emptyBucket = () => ({
	uncachedInputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
});

const addBucket = (left, right) => ({
	uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
	outputTokens: left.outputTokens + right.outputTokens,
	cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
	cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
});

/** The Beijing date of an instant, as YYYY-MM-DD. */
export function beijingDate(now = Date.now()) {
	return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

/** Move a YYYY-MM-DD date by whole days. */
export function shiftDate(date, days) {
	const time = Date.parse(date + 'T00:00:00Z') + days * 86400000;
	return new Date(time).toISOString().slice(0, 10);
}

/** First Beijing date of a range, or null for the whole history. */
export function rangeStart(range, now = Date.now()) {
	const days = RANGE_DAYS[range];
	if (days === undefined) return undefined;
	if (days === 0) return null;
	return shiftDate(beijingDate(now), -(days - 1));
}

/** Amount of days a range covers; the whole history reports its observed days. */
export function rangeDays(range) {
	return RANGE_DAYS[range] || null;
}

/** Inclusive day count of a custom range; null when the dates are incomplete. */
export function dayCount(start, end) {
	if (typeof start !== 'string' || typeof end !== 'string') return null;
	const from = Date.parse(start + 'T00:00:00Z');
	const to = Date.parse(end + 'T00:00:00Z');
	if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
	return Math.round((to - from) / 86400000) + 1;
}

/** First and last Beijing date of a range; null means no bound. */
export function rangeBounds(range, { start, end } = {}, now = Date.now()) {
	if (range === 'custom') return { start: start ?? null, end: end ?? null };
	return { start: rangeStart(range, now), end: null };
}

/** Bars above this count are merged so the trend stays readable. */
export const TREND_MAX_BARS = 20;

/** Accounting skeleton accepted by {@link buildCostView}. */
export function emptyAccounting(calendars = {}) {
	return { totals: emptyBucket(), byRoute: {}, byTime: {}, calendars, turns: {}, skippedTurns: 0 };
}

/** Time keys of the selected range; unknown timestamps always count. */
export function inRange(key, start, end = null) {
	const date = String(key).slice(0, 10);
	if (date === 'unknown') return true;
	if (start !== null && start !== undefined && date < start) return false;
	if (end !== null && end !== undefined && date > end) return false;
	return true;
}

/** Add the byTime buckets of one projection state that fall into the range. */
export function addRangeState(target, state, start, end = null) {
	const byTime = state?.byTime;
	if (byTime === null || typeof byTime !== 'object') return target;
	for (const [route, entries] of Object.entries(byTime)) {
		const bucketMap = target.byTime[route] ?? (target.byTime[route] = {});
		for (const [key, bucket] of Object.entries(entries)) {
			if (!inRange(key, start, end)) continue;
			bucketMap[key] = bucketMap[key] ? addBucket(bucketMap[key], bucket) : { ...bucket };
		}
	}
	const skipped = state?.skippedTurns;
	target.skippedTurns += Number.isSafeInteger(skipped) && skipped > 0 ? skipped : 0;
	return target;
}

/** Derive per-route and total token buckets from the ranged byTime buckets. */
export function totalsOf(accounting) {
	const byRoute = {};
	let totals = emptyBucket();
	for (const [route, entries] of Object.entries(accounting.byTime)) {
		let sum = emptyBucket();
		for (const bucket of Object.values(entries)) sum = addBucket(sum, bucket);
		if (tokensOf(sum) === 0) continue;
		byRoute[route] = sum;
		totals = addBucket(totals, sum);
	}
	accounting.byRoute = byRoute;
	accounting.totals = totals;
	return accounting;
}

/** Bucket every ranged entry under one unit key. */
function groupByUnit(accounting, unitOf) {
	const units = new Map();
	for (const [route, entries] of Object.entries(accounting.byTime)) {
		for (const [key, bucket] of Object.entries(entries)) {
			const unit = unitOf(key);
			if (unit === null) continue;
			const group = units.get(unit) ?? emptyAccounting(accounting.calendars);
			const bucketMap = group.byTime[route] ?? (group.byTime[route] = {});
			bucketMap[key] = bucketMap[key] ? addBucket(bucketMap[key], bucket) : { ...bucket };
			units.set(unit, group);
		}
	}
	return units;
}

/** Money and tokens of one accounting group. */
function viewOf(group, config) {
	totalsOf(group);
	const view = buildCostView(group, config);
	return { tokens: view.tokens, totalTokens: view.totalTokens, bucketMicros: view.bucketMicros, totalMicros: view.totalMicros };
}

/** Money per day or per month, ascending by key. */
export function buildTrend(accounting, config, granularity) {
	const month = granularity === 'month';
	const units = groupByUnit(accounting, (key) => {
		if (key === 'unknown') return null;
		const unit = month ? key.slice(0, 7) : key.slice(0, 10);
		return /^\d{4}-\d{2}(-\d{2})?$/.test(unit) ? unit : null;
	});
	return [...units.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, group]) => ({ key, ...viewOf(group, config) }));
}

/**
 * Merge consecutive trend units into at most {@link TREND_MAX_BARS} bars.
 * Every bar keeps the first and last unit key, so the page can name the span.
 */
export function mergeTrend(units, limit = TREND_MAX_BARS) {
	const span = (unit) => ({ fromKey: unit.key, toKey: unit.key, merged: 1 });
	if (units.length <= limit) return units.map((unit) => ({ ...unit, ...span(unit) }));
	const size = Math.ceil(units.length / limit);
	const merged = [];
	for (let index = 0; index < units.length; index += size) {
		const slice = units.slice(index, index + size);
		const total = { totalMicros: 0, totalTokens: 0, tokens: { input: 0, output: 0, read: 0, write: 0 }, bucketMicros: { input: 0, output: 0, read: 0, write: 0 } };
		for (const unit of slice) {
			total.totalMicros += unit.totalMicros;
			total.totalTokens += unit.totalTokens;
			for (const key of Object.keys(total.tokens)) total.tokens[key] += unit.tokens[key];
			for (const key of Object.keys(total.bucketMicros)) total.bucketMicros[key] += unit.bucketMicros[key];
		}
		merged.push({ ...total, key: slice[0].key, fromKey: slice[0].key, toKey: slice[slice.length - 1].key, merged: slice.length });
	}
	return merged;
}

/** Money and tokens of each clock window. */
export function buildTimeOfDay(accounting, config) {
	const groups = new Map(SEGMENTS.map((segment) => [segment, emptyAccounting(accounting.calendars)]));
	for (const [route, entries] of Object.entries(accounting.byTime)) {
		for (const [key, bucket] of Object.entries(entries)) {
			const segment = key === 'unknown' ? '' : key.slice(11);
			const group = groups.get(segment);
			if (group === undefined) continue;
			const bucketMap = group.byTime[route] ?? (group.byTime[route] = {});
			bucketMap[key] = bucketMap[key] ? addBucket(bucketMap[key], bucket) : { ...bucket };
		}
	}
	return SEGMENTS.map((segment) => ({ segment, ...viewOf(groups.get(segment), config) }));
}

/** One row per route with the four priced series, for the model table. */
export function routeRows(accounting, config) {
	const rows = [];
	for (const route of buildCostView(totalsOf(accounting), config).routes) {
		const buckets = accounting.byRoute[route.route];
		if (buckets === undefined || route.totalTokens === 0) continue;
		const single = emptyAccounting(accounting.calendars);
		single.byRoute = { [route.route]: buckets };
		single.byTime = accounting.byTime[route.route] ? { [route.route]: accounting.byTime[route.route] } : {};
		single.totals = buckets;
		const view = buildCostView(single, config);
		rows.push({
			...route,
			bucketMicros: view.bucketMicros,
			tokens: {
				input: buckets.uncachedInputTokens,
				output: buckets.outputTokens,
				read: buckets.cacheReadTokens,
				write: buckets.cacheWriteTokens,
			},
		});
	}
	return rows;
}

/** One row per session that recorded usage inside the range. */
export function sessionRows(entries, config, start, end = null) {
	const rows = [];
	for (const { header, state } of entries) {
		const accounting = totalsOf(addRangeState(emptyAccounting(), state, start, end));
		const view = buildCostView(accounting, config);
		if (view.totalTokens === 0) continue;
		rows.push({
			id: header.id,
			createdAt: header.createdAt,
			parentSession: header.parentSession ?? null,
			totalMicros: view.totalMicros,
			totalTokens: view.totalTokens,
			tokens: view.tokens,
			routes: view.routes.filter((route) => route.totalTokens > 0).slice(0, 2).map((route) => route.route),
		});
	}
	return rows.sort((left, right) => right.totalMicros - left.totalMicros);
}
