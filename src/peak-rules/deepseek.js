/** The DeepSeek official rule. Peak is a weekday clock window; holidays are off-peak. */
export const rule = {
	id: 'deepseek',
	label: 'configRule_deepseek',
	hint: 'configRuleHint_deepseek',
	factor: 0.5,
	/**
	 * Weekends and Chinese public holidays are off-peak for a whole day.
	 * Weekday 09:00-12:00 and 14:00-18:00 are peak; the other windows are off-peak.
	 * @param date - Beijing date, YYYY-MM-DD.
	 * @param segment - shared clock window id.
	 * @param calendars - year to holiday date list.
	 * @returns peak, offPeak, or unknown without the year data in a peak window.
	 */
	period(date, segment, calendars) {
		const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
		if (weekday === 0 || weekday === 6) return 'offPeak';
		if (segment !== 'am' && segment !== 'pm') return 'offPeak';
		const days = calendars[date.slice(0, 4)];
		if (!days) return 'unknown';
		if (days.includes(date)) return 'offPeak';
		return 'peak';
	},
};