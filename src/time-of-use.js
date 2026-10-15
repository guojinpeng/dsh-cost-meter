import { DEFAULT_PEAK_RULE, PEAK_RULES, PEAK_RULE_IDS, peakRule } from './peak-rules/index.js';

export { DEFAULT_PEAK_RULE, PEAK_RULES, PEAK_RULE_IDS, peakRule };

/**
 * The clock windows every rule shares, as [id, start hour, end hour).
 * Their bounds cover the peak windows of all rules, so one bucket serves all.
 */
const SEGMENTS = [
	['night', 0, 8],
	['morning', 8, 9],
	['am', 9, 12],
	['noon', 12, 14],
	['pm', 14, 18],
	['evening', 18, 22],
	['late', 22, 24],
];

export function isDeepSeekRoute(key) {
	return /^deepseek(?:-|\/)/i.test(key);
}

/** Keep the Beijing date and clock window independent of calendar availability. */
export function timeBucket(time) {
	if (!Number.isFinite(time) || time < 0) return 'unknown';
	const local = new Date(time + 8 * 3600000);
	if (!Number.isFinite(local.getTime())) return 'unknown';
	const date = local.toISOString().slice(0, 10);
	const hour = local.getUTCHours();
	const segment = SEGMENTS.find(([, start, end]) => hour >= start && hour < end);
	return `${date}/${segment[0]}`;
}

/** The period of one bucket under one rule. */
export function pricePeriod(bucket, ruleId = DEFAULT_PEAK_RULE, calendars = {}) {
	if (bucket === 'unknown') return 'unknown';
	const [date, segment] = String(bucket).split('/');
	if (!date || !SEGMENTS.some(([id]) => id === segment)) return 'unknown';
	return peakRule(ruleId).period(date, segment, calendars);
}
