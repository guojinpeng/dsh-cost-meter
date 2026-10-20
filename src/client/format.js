/** Exact token count with 3-digit grouping. */
export function formatExactTokens(value) {
	if (typeof value !== `number` || !Number.isFinite(value)) return `0`;
	const sign = value < 0 ? `-` : ``;
	const digits = String(Math.abs(Math.round(value)));
	const groups = [];
	for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
	return sign + groups.join(`,`);
}
/** Convert integer micro-USD into the display currency. */
function toDisplay(micros, currency, cnyPerUsd) {
	const usd = micros / 1e6;
	return currency === `CNY` ? usd * (cnyPerUsd || 7.2) : usd;
}
/** Currency symbol for the configured currency. */
function symbolOf(currency) {
	if (currency === `CNY`) return `¥`;
	if (currency === `USD`) return `$`;
	return currency ? currency + ` ` : ``;
}
/** Exact money string: ¥0.0034 / ¥1.23. */
export function formatMoney(micros, currency, cnyPerUsd) {
	if (micros === null || micros === undefined) return `—`;
	const value = toDisplay(micros, currency, cnyPerUsd);
	const symbol = symbolOf(currency);
	if (value === 0) return symbol + `0.00`;
	if (Math.abs(value) < 0.01) return symbol + value.toFixed(4);
	if (Math.abs(value) < 1) return symbol + value.toFixed(3);
	return symbol + value.toFixed(2);
}
/** Compact money string for the inline chips. */
export function formatChipMoney(micros, currency, cnyPerUsd) {
	if (micros === null || micros === undefined) return `—`;
	const value = toDisplay(micros, currency, cnyPerUsd);
	const symbol = symbolOf(currency);
	if (value === 0) return symbol + `0.00`;
	if (Math.abs(value) < 0.01) return symbol + `<0.01`;
	return symbol + value.toFixed(2);
}

/** Values in each group are already expressed in that group's currency. */
export function formatAmounts(amounts, compact = false, currency = 'USD') {
	const format = compact ? formatChipMoney : formatMoney;
	return (amounts.length ? amounts : [{ currency, micros: 0 }])
		.map((entry) => format(entry.micros, entry.currency, 1))
		.join(' · ');
}

/**
 * Money of one display group (peak, off-peak, or fixed) in every charged
 * currency. Returns null when no currency charges this row, so callers can
 * drop zero rows.
 */
export function formatAmountPeriod(amounts, periods, field) {
	const entries = amounts
		.map((entry) => ({
			currency: entry.currency,
			micros: periods.reduce((sum, period) => sum + (entry.periodMicros?.[period]?.[field] ?? 0), 0),
		}))
		.filter((entry) => entry.micros > 0);
	return entries.length === 0 ? null : formatAmounts(entries);
}
