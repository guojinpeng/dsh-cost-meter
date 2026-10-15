/** The Zhipu GLM rule. Peak is Monday-Friday 14:00-18:00; weekends are off-peak. */
export const rule = {
	id: 'glm',
	label: 'configRule_glm',
	hint: 'configRuleHint_glm',
	factor: 0.5,
	/**
	 * Only the weekday 14:00-18:00 window is peak. Weekends are off-peak for
	 * a whole day. Public holidays do not move the weekday test.
	 * @param date - Beijing date, YYYY-MM-DD.
	 * @param segment - shared clock window id.
	 * @returns peak or offPeak.
	 */
	period(date, segment) {
		const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
		return weekday >= 1 && weekday <= 5 && segment === 'pm' ? 'peak' : 'offPeak';
	},
};
