import { buildDraft } from './config-draft.js';
import { convertRateCurrency, RATE_KEYS } from '../pricing.js';

export function createUseConfigController(react, store) {
	return function useConfigController(t) {
		const payload = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
		const [draft, setDraft] = react.useState(() => (payload ? buildDraft(payload) : null));
		const [error, setError] = react.useState(null),
			[notice, setNotice] = react.useState('');
		const [busy, setBusy] = react.useState(false),
			[writing, setWriting] = react.useState(0);
		const [syncDetails, setSyncDetails] = react.useState([]);
		const edits = react.useRef(new Map()),
			pending = react.useRef(new Map());
		const timer = react.useRef(null),
			current = react.useRef(draft),
			mounted = react.useRef(true);
		const lastWrite = react.useRef(Promise.resolve());
		const pathOf = (route, field) => JSON.stringify([route, field]);
		const matchesEdit = (path, entry) => {
			const value = edits.current.get(path)?.value;
			return (
				value === entry.value ||
				(typeof value === 'string' && value.trim() !== '' && Number(value) === entry.value)
			);
		};
		const accept = (value) => {
			const next = buildDraft(value);
			for (const { route, field, value: input } of edits.current.values()) {
				if (route) {
					const row = next.rows.find((row) => row.key === route);
					if (row) row[field] = input;
				} else next[field] = input;
			}
			current.current = next;
			setDraft(next);
		};
		const flush = () => {
			clearTimeout(timer.current);
			if (!pending.current.size) return lastWrite.current;
			const submitted = new Map(pending.current);
			pending.current.clear();
			const changes = {};
			for (const { route, field, value, manual } of submitted.values()) {
				if (route) {
					changes.pricing ??= {};
					changes.pricing[route] ??= {};
					changes.pricing[route][field] = value;
					if (manual) changes.pricing[route].source = 'manual';
				} else changes[field] = value;
			}
			if (mounted.current) {
				setWriting((count) => count + 1);
				setError(null);
			}
			const operation = store
				.update(changes)
				.then((value) => {
					for (const [path, entry] of submitted) if (matchesEdit(path, entry)) edits.current.delete(path);
					if (mounted.current) {
						accept(value);
						if (!pending.current.size) setError(null);
						setNotice(t('configSaved'));
					}
				})
				.catch((failure) => {
					for (const [path, entry] of submitted)
						if (!pending.current.has(path) && matchesEdit(path, entry)) pending.current.set(path, entry);
					if (mounted.current) setError(failure.message);
					throw failure;
				})
				.finally(() => mounted.current && setWriting((count) => count - 1));
			lastWrite.current = operation;
			return operation;
		};
		react.useEffect(() => {
			mounted.current = true;
			store.load().catch((failure) => mounted.current && setError(failure.message));
			return () => {
				mounted.current = false;
				flush().catch(() => {});
			};
		}, []);
		react.useEffect(() => {
			if (payload) accept(payload);
		}, [payload]);
		const change = (route, field, value, immediate = false, manual = false) => {
			const path = pathOf(route, field);
			const entry = { route, field, value, manual: manual || pending.current.get(path)?.manual === true };
			edits.current.set(path, entry);
			const next = { ...current.current, rows: current.current.rows.map((row) => ({ ...row })) };
			if (route) next.rows.find((row) => row.key === route)[field] = value;
			else next[field] = value;
			current.current = next;
			setDraft(next);
			const numeric = RATE_KEYS.includes(field) || field === 'cnyPerUsd';
			const number = Number(value);
			if (
				numeric &&
				(String(value).trim() === '' ||
					!Number.isFinite(number) ||
					number < 0 ||
					(field === 'cnyPerUsd' && number === 0))
			) {
				pending.current.delete(path);
				setError(t('configInvalidNumber'));
				return;
			}
			pending.current.set(path, { ...entry, value: numeric ? number : value });
			setError(null);
			setNotice('');
			setSyncDetails([]);
			clearTimeout(timer.current);
			if (immediate) flush().catch(() => {});
			else timer.current = setTimeout(() => flush().catch(() => {}), 400);
		};
		const rowPatch = (key, field, value) =>
			change(key, field, value, typeof value === 'boolean', RATE_KEYS.includes(field));
		const currency = (key, value) => {
			const row = current.current.rows.find((row) => row.key === key);
			if (
				RATE_KEYS.some(
					(field) =>
						String(row[field]).trim() === '' ||
						!Number.isFinite(Number(row[field])) ||
						Number(row[field]) < 0,
				)
			) {
				setError(t('configInvalidNumber'));
				return;
			}
			const exchange = Number(current.current.cnyPerUsd);
			if (!Number.isFinite(exchange) || exchange <= 0) {
				setError(t('configInvalidNumber'));
				return;
			}
			const converted = convertRateCurrency(row, value, exchange);
			for (const field of [...RATE_KEYS, 'currency']) change(key, field, converted[field]);
			flush().catch(() => {});
		};
		const sync = async () => {
			const source = current.current.priceSource;
			if (error || !window.confirm(t('configSyncConfirm', { source }))) return;
			setBusy(true);
			setError(null);
			setSyncDetails([]);
			try {
				await flush();
				const value = await store.sync(source);
				accept(value);
				setSyncDetails(value.report.details ?? []);
				const skipped =
					value.report.unmatched.length + value.report.unsupported.length + value.report.ambiguous.length;
				setNotice(
					`${t('configUpdated')}: ${value.report.updated.length}; ${t('configPreserved')}: ${skipped}`,
				);
			} catch (failure) {
				setError(failure.message);
			} finally {
				setBusy(false);
			}
		};
		const invalid =
			draft &&
			(Number(draft.cnyPerUsd) <= 0 ||
				!Number.isFinite(Number(draft.cnyPerUsd)) ||
				draft.rows.some((row) =>
					RATE_KEYS.some(
						(field) =>
							String(row[field]).trim() === '' ||
							!Number.isFinite(Number(row[field])) ||
							Number(row[field]) < 0,
					),
				));
		return {
			draft,
			busy,
			invalid,
			saving: writing > 0,
			error: invalid ? t('configInvalidNumber') : error,
			notice,
			syncDetails,
			rowPatch,
			currency,
			sync,
			patch: (field, value) =>
				change(null, field, value, typeof value === 'boolean' || field === 'priceSource'),
			retry: () =>
				(pending.current.size
					? flush()
					: store.load().then((value) => {
							accept(value);
							setError(null);
						})
				).catch((failure) => setError(failure.message)),
			flush: () => flush().catch(() => {}),
		};
	};
}
