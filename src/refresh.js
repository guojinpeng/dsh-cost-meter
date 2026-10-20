/** Selectable automatic refresh intervals, in minutes. */
export const REFRESH_INTERVALS = [1, 3, 5, 10, 15, 30, 60];

/** Automatic refresh interval used when none is configured. */
export const DEFAULT_REFRESH_MINUTES = 5;

/** Coerce any stored value into a selectable interval. */
export function normalizeRefreshMinutes(value) {
	const minutes = Number(value);
	return REFRESH_INTERVALS.includes(minutes) ? minutes : DEFAULT_REFRESH_MINUTES;
}
