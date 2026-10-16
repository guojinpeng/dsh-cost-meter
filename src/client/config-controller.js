import { RATE_KEYS, convertRateCurrency } from '../pricing.js';
import {
	applyPreview,
	buildDraft,
	configOf,
	deepEqual,
	newRow,
	parseModelKey,
	rateOf,
	rateText,
} from './config-draft.js';

const initialStatus = {
	saving: false,
	syncing: false,
	error: null,
	loadError: null,
	syncError: null,
	notice: null,
	details: [],
	addError: null,
};

/**
 * Staged configuration controller: every edit lands in a local draft and only
 * save() writes it, which is the contract the host settings pages follow.
 */
export function createUseConfigController(react, store) {
	return function useConfigController(t) {
		const payload = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
		const [draft, setDraft] = react.useState(null);
		const [status, setStatus] = react.useState(initialStatus);
		const saved = react.useRef(null);
		const staged = react.useRef(null);
		staged.current = draft;

		const adopt = (value) => {
			const next = buildDraft(value);
			saved.current = configOf(next);
			setDraft(next);
		};

		react.useEffect(() => {
			if (store.getSnapshot() !== null) return;
			store.load().catch((error) => setStatus((state) => ({ ...state, loadError: error.message })));
		}, [store]);

		// A new payload replaces the draft only while the draft is clean, so work
		// in progress survives a background refresh.
		react.useEffect(() => {
			if (payload === null) return;
			const current = staged.current;
			if (current === null) {
				adopt(payload);
				return;
			}
			if (saved.current === null) return;
			let clean = false;
			try {
				clean = deepEqual(configOf(current), saved.current);
			} catch {
				clean = false;
			}
			if (clean) adopt(payload);
		}, [payload]);

		let current = null;
		if (draft !== null) {
			try {
				current = configOf(draft);
			} catch {
				current = null;
			}
		}
		const invalid = draft !== null && current === null;
		const dirty =
			draft !== null && (current === null || saved.current === null || !deepEqual(current, saved.current));

		const patch = (field, value) =>
			setDraft((latest) => (latest === null ? latest : { ...latest, [field]: value }));

		const rowPatch = (key, field, value) =>
			setDraft((latest) =>
				latest === null
					? latest
					: {
							...latest,
							rows: latest.rows.map((row) =>
								row.key === key
									? { ...row, [field]: value, ...(RATE_KEYS.includes(field) ? { source: 'manual' } : {}) }
									: row,
							),
						},
			);

		/** Switch one row's currency and convert its rates at the staged exchange rate. */
		const setCurrency = (key, currency) =>
			setDraft((latest) => {
				if (latest === null) return latest;
				const cnyPerUsd = Number(latest.cnyPerUsd);
				return {
					...latest,
					rows: latest.rows.map((row) => {
						if (row.key !== key || row.currency === currency) return row;
						const rate = rateOf(row);
						const convertible =
							cnyPerUsd > 0 && RATE_KEYS.every((field) => Number.isFinite(rate[field]) && rate[field] >= 0);
						const converted = convertible
							? convertRateCurrency({ ...rate, currency: row.currency ?? 'USD' }, currency, cnyPerUsd)
							: null;
						// A unit conversion keeps the price's origin; only edited rates are manual.
						return { ...row, currency, ...(converted === null ? {} : rateText(converted)) };
					}),
				};
			});

		const addModel = (input) => {
			const key = parseModelKey(input);
			const rows = staged.current?.rows ?? [];
			if (key === null || rows.some((row) => row.key === key)) {
				setStatus((state) => ({ ...state, addError: t('configAddModelInvalid') }));
				return false;
			}
			setStatus((state) => ({ ...state, addError: null }));
			setDraft((latest) => (latest === null ? latest : { ...latest, rows: [...latest.rows, newRow(key)] }));
			return true;
		};

		const removeModel = (key) =>
			setDraft((latest) =>
				latest === null ? latest : { ...latest, rows: latest.rows.filter((row) => row.key !== key) },
			);

		/** Stage the source prices as a preview; nothing reaches disk until save(). */
		const sync = async () => {
			if (draft === null || invalid || status.syncing || status.saving) return;
			setStatus((state) => ({ ...state, syncing: true, syncError: null, notice: null, details: [] }));
			try {
				const value = await store.sync(draft.priceSource, current);
				const report = value.report ?? {};
				const preserved =
					(report.unmatched?.length ?? 0) + (report.unsupported?.length ?? 0) + (report.ambiguous?.length ?? 0);
				const source = draft.priceSource;
				setDraft((latest) => (latest === null ? latest : applyPreview(latest, value.preview)));
				setStatus((state) => ({
					...state,
					syncing: false,
					notice: `${t('configUpdated')} ${report.updated?.length ?? 0} · ${t('configPreserved')} ${preserved} · ${t('configSyncPreview', { source })}`,
					details: report.details ?? [],
				}));
			} catch (error) {
				setStatus((state) => ({ ...state, syncing: false, syncError: error.message }));
			}
		};

		const save = async () => {
			if (draft === null || invalid) return;
			setStatus((state) => ({ ...state, saving: true, error: null, notice: null, details: [] }));
			try {
				adopt(await store.save(current));
				setStatus((state) => ({ ...state, saving: false }));
			} catch (error) {
				const conflict = error.status === 409;
				setStatus((state) => ({
					...state,
					saving: false,
					error: t('configSaveFailed', { message: conflict ? t('configConflict') : error.message }),
				}));
				// Refresh the baseline but keep the draft: the user saves again.
				if (conflict) await store.load().catch(() => {});
			}
		};

		/** SettingsForm calls this when the page unmounts: drop the staged draft. */
		const discard = () => {
			saved.current = null;
			setDraft(null);
		};

		const retry = () => {
			setStatus((state) => ({ ...state, loadError: null, error: null }));
			store.load().catch((error) => setStatus((state) => ({ ...state, loadError: error.message })));
		};

		return {
			available: draft !== null,
			draft,
			discovered: payload?.discovered ?? payload?.models ?? [],
			loadError: status.loadError,
			saving: status.saving,
			syncing: status.syncing,
			dirty,
			invalid,
			error: status.error,
			syncError: status.syncError,
			notice: status.notice,
			details: status.details,
			addError: status.addError,
			patch,
			rowPatch,
			setCurrency,
			addModel,
			removeModel,
			sync,
			save,
			discard,
			retry,
		};
	};
}