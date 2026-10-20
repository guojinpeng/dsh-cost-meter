import { buildCostView } from '../pricing.js';
import { PROJECTION_KEY } from '../identity.js';

/**
 * One priced view per projection, configuration and calendar object. Every chip
 * on screen shares the same projection, so the pricing runs once per change.
 */
const priced = new WeakMap();
function priceOf(accounting, config, calendars) {
	const cached = priced.get(accounting);
	if (cached !== undefined && cached.config === config && cached.calendars === calendars) return cached.view;
	const view = buildCostView({ ...accounting, calendars }, config);
	priced.set(accounting, { config, calendars, view });
	return view;
}

export function createUseCostView(react, store) {
	function useCostView(props) {
		const raw = props.useProjection(PROJECTION_KEY);
		const snapshot = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
		const loadStatus = react.useSyncExternalStore(store.subscribe, store.getLoadStatus);
		// The server already prices the projection from the local configuration.
		const missing = snapshot
			? raw?.accounting &&
				Object.keys(raw.accounting.byRoute).some((key) => key && !snapshot.config.pricing[key])
			: !raw || raw.unpricedTokens !== 0;
		react.useEffect(() => {
			if (
				!snapshot ||
				(raw?.accounting &&
					Object.keys(raw.accounting.byRoute).some((key) => key && !snapshot.config.pricing[key]))
			)
				store.load().catch(() => {});
		}, [raw]);
		return react.useMemo(() => {
			const view =
				raw?.accounting && snapshot
					? priceOf(raw.accounting, snapshot.config, snapshot.calendars ?? raw.accounting.calendars)
					: raw;
			return missing && loadStatus !== 'error' ? { ...view, initializing: true } : view;
		}, [raw, snapshot, missing, loadStatus]);
	}

	return useCostView;
}
