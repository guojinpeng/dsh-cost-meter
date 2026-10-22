/**
 * Pure helpers of the cost overview page. They live apart from the page
 * component so the range rules and the scatter scaling have unit tests.
 */

/** A trend unit key of one calendar month, YYYY-MM. */
const MONTH_KEY = /^\d{4}-\d{2}$/;

/** Last calendar day of a YYYY-MM month. */
export function monthEnd(key) {
	const [year, month] = key.split('-').map(Number);
	return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * Dates a trend bar stands for. A day bar keeps its keys; a month bar becomes
 * the first and the last day of the span, because the page queries dates.
 * @param unit - merged trend unit: fromKey, toKey and key.
 * @returns inclusive start and end dates.
 */
export function trendBarRange(unit) {
	const from = unit.fromKey ?? unit.key;
	const to = unit.toKey ?? unit.key;
	if (!MONTH_KEY.test(from)) return { start: from, end: to };
	return { start: from + '-01', end: monthEnd(to) };
}

/**
 * One point per priced model: the blended price of one million tokens on the
 * x axis and the consumed tokens on the y axis.
 * @param routes - model rows of the overview payload.
 * @returns points sorted by cost, highest first.
 */
export function modelPoints(routes) {
	return routes
		.filter((route) => route.priced === true && route.totalTokens > 0)
		.map((route) => ({
			route: route.route,
			micros: route.micros,
			totalTokens: route.totalTokens,
			tokens: { ...route.tokens },
			bucketMicros: { ...route.bucketMicros },
		}))
		.sort((left, right) => right.micros - left.micros);
}

/** Model name of a route without its provider prefix. */
export function modelName(route) {
	const slash = route.indexOf('/');
	return slash > 0 ? route.slice(slash + 1) : route;
}

/**
 * Short label for a bubble. Long names drop whole leading segments instead of
 * being cut, so two DeepSeek variants do not both read "deepseek-v4…".
 * @param route - provider/model key or a bare model name.
 * @param limit - largest label length kept.
 */
export function shortModelName(route, limit = 14) {
	const name = modelName(route);
	if (name.length <= limit) return name;
	const parts = name.split('-');
	for (let start = 1; start < parts.length; start += 1) {
		const tail = parts.slice(start).join('-');
		if (tail.length <= limit) return tail;
	}
	return name.slice(0, limit - 1) + '…';
}

/** One plus a list of decade mantissas, the usual 1-2-5 tick set of a log axis. */
const LOG_STEPS = [1, 2, 5];

/**
 * Ticks of a logarithmic axis, one set per decade inside the span.
 * Wide spans thin the set out, so an axis never carries more than seven ticks.
 * @param min - smallest positive value on the axis.
 * @param max - largest value on the axis.
 * @returns ascending tick values, or an empty array for an invalid span.
 */
export function logTicks(min, max) {
	if (!(min > 0) || !(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
	const decades = Math.log10(max) - Math.log10(min);
	const mantissas = decades > 4 ? [1] : decades > 2 ? [1, 5] : LOG_STEPS;
	const ticks = [];
	for (let power = Math.floor(Math.log10(min)); power <= Math.ceil(Math.log10(max)); power += 1)
		for (const mantissa of mantissas) {
			const value = mantissa * Math.pow(10, power);
			if (value >= min && value <= max) ticks.push(value);
		}
	// Rounding noise would otherwise print 0.30000000000000004 on the axis.
	return ticks.map((value) => Number(value.toPrecision(12)));
}

/**
 * Smallest 1-2-5 value at or above a wanted log-axis end. The scatter widens
 * its axis to reserve room for the point labels; a tidy end keeps the last
 * tick on the frame instead of leaving a bare stretch of grid.
 * @param value - wanted axis maximum, above zero.
 * @returns a value of the form 1, 2 or 5 times a power of ten.
 */
export function logAxisMax(value) {
	if (!(value > 0) || !Number.isFinite(value)) return value;
	const scale = Math.pow(10, Math.floor(Math.log10(value)));
	for (const mantissa of [...LOG_STEPS, 10]) {
		const candidate = mantissa * scale;
		// A float value just above 200 must still snap to 200, not to 500.
		if (candidate >= value * (1 - 1e-9)) return Number(candidate.toPrecision(12));
	}
	return value;
}
