import { buildCostView } from '../pricing.js';
import { PROJECTION_KEY } from '../identity.js';

export function createUseCostView(react, store) {
	function useCostView(props) {
		const raw = props.useProjection(PROJECTION_KEY);
		const snapshot = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
		const loadStatus = react.useSyncExternalStore(store.subscribe, store.getLoadStatus);
		const missing =
			!snapshot ||
			(raw?.accounting && Object.keys(raw.accounting.byRoute).some((key) => key && !snapshot.config.pricing[key]));
		react.useEffect(() => {
			if (
				!snapshot ||
				(raw?.accounting && Object.keys(raw.accounting.byRoute).some((key) => key && !snapshot.config.pricing[key]))
			)
				store.load().catch(() => {});
		}, [raw]);
		return react.useMemo(() => {
			const view = raw?.accounting && snapshot ? buildCostView(raw.accounting, snapshot.config) : raw;
			return missing && loadStatus !== 'error' ? { ...view, initializing: true } : view;
		}, [raw, snapshot, missing, loadStatus]);
	}

	return useCostView;
}
