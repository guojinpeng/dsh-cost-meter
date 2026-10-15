/** The Alibaba Cloud rule. Off-peak is the 22:00-08:00 clock window. */
export const rule = {
	id: 'aliyun',
	label: 'configRule_aliyun',
	hint: 'configRuleHint_aliyun',
	factor: 0.5,
	/**
	 * Off-peak runs 22:00 through 08:00 (UTC+8). No calendar takes part, so
	 * this rule always returns a period.
	 * @param date - Beijing date, YYYY-MM-DD. Unused.
	 * @param segment - shared clock window id.
	 * @returns peak or offPeak.
	 */
	period(date, segment) {
		return segment === 'night' || segment === 'late' ? 'offPeak' : 'peak';
	},
};
