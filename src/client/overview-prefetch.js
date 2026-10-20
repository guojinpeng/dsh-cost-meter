import { OVERVIEW_RANGES, fetchOverview } from './overview-request.js';
import { normalizeRefreshMinutes } from '../refresh.js';

// Call the globals through arrows. Extracting `window.setTimeout` and calling it
// as `timers.setTimeout(...)` makes the browser throw "Illegal invocation"
// (the receiver must be the window), which silently killed the timer in 0.4.4.
const defaultTimers = {
	setTimeout: (callback, delay) => setTimeout(callback, delay),
	clearTimeout: (handle) => clearTimeout(handle),
};

/**
 * Warm the five preset-range caches on a timer so opening the cost page reads
 * the server cache immediately. The timer runs while the web client is mounted.
 * A failed batch is silent: the page keeps the previous cache.
 */
export function createOverviewPrefetcher(store, options = {}) {
	const { fetcher = (...args) => fetch(...args), timers = defaultTimers } = options;
	let timer = null;
	let running = false;
	let disposed = false;
	let key = null;

	const clear = () => {
		if (timer === null) return;
		timers.clearTimeout(timer);
		timer = null;
	};

	/** Reload all five preset ranges in parallel; a batch never overlaps itself. */
	const run = () => {
		if (running) return;
		running = true;
		Promise.all(OVERVIEW_RANGES.map((range) => fetchOverview(range, { refresh: true, fetcher })))
			.catch(() => {})
			.finally(() => {
				running = false;
			});
	};

	const schedule = (minutes) => {
		clear();
		const handle = timers.setTimeout(() => {
			timer = null;
			if (disposed) return;
			run();
			schedule(minutes);
		}, minutes * 60000);
		handle?.unref?.();
		timer = handle;
	};

	/** Apply the current switch and interval; a change restarts the cadence. */
	const sync = () => {
		if (disposed) return;
		const snapshot = store.getSnapshot();
		if (snapshot === null) {
			if (store.getLoadStatus?.() === 'idle') store.load().catch(() => {});
			return;
		}
		const config = snapshot.config ?? {};
		const enabled = config.autoRefreshCost !== false;
		const minutes = normalizeRefreshMinutes(config.autoRefreshMinutes);
		const next = enabled ? String(snapshot.revision ?? '') + ':' + minutes : 'off';
		if (next === key) return;
		key = next;
		clear();
		if (!enabled) return;
		run();
		schedule(minutes);
	};

	const unsubscribe = store.subscribe(sync);
	sync();
	return {
		dispose() {
			disposed = true;
			clear();
			unsubscribe();
		},
	};
}
