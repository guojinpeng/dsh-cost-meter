export function isDeepSeekRoute(key) {
	return /^deepseek(?:-|\/)/i.test(key);
}

/** Keep the date and clock window independent of calendar availability. */
export function timeBucket(time) {
	if (!Number.isFinite(time) || time < 0) return 'unknown';
	const local = new Date(time + 8 * 3600000);
	if (!Number.isFinite(local.getTime())) return 'unknown';
	const date = local.toISOString().slice(0, 10);
	const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
	const window = (minute >= 540 && minute < 720) || (minute >= 840 && minute < 1080);
	return `${date}/${window ? 'window' : 'idle'}`;
}

export function pricePeriod(bucket, calendars = {}) {
	if (bucket === 'unknown') return 'unknown';
	const [date, window] = bucket.split('/');
	const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
	if (weekday === 0 || weekday === 6 || window === 'idle') return 'offPeak';
	const days = calendars[date.slice(0, 4)];
	if (!days) return 'unknown';
	return days.includes(date) ? 'offPeak' : 'peak';
}
