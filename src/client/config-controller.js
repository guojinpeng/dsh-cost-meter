import { buildDraft, configOf } from './config-draft.js';

export function createUseConfigController(react, store) {
	return function useConfigController(t) {
		const [payload, setPayload] = react.useState(null),
			[draft, setDraft] = react.useState(null);
		const [busy, setBusy] = react.useState(false);
		const [error, setError] = react.useState(null),
			[notice, setNotice] = react.useState('');
		const accept = (value) => {
			setPayload(value);
			setDraft(buildDraft(value));
		};
		react.useEffect(() => {
			let active = true;
			store
				.load()
				.then((v) => active && accept(v))
				.catch((e) => active && setError(e.message));

			return () => {
				active = false;
			};
		}, []);
		const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(buildDraft(payload));
		const patch = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
		const rowPatch = (index, changes) =>
			setDraft((current) => ({
				...current,
				rows: current.rows.map((row, at) => (at === index ? { ...row, ...changes } : row)),
			}));
		const run = async (sync) => {
			if (sync && !window.confirm(t('configSyncConfirm'))) return;
			setBusy(true);
			setError(null);
			setNotice('');
			try {
				const value = sync ? await store.sync() : await store.save(configOf(draft));
				accept(value);
				const skipped = value.report
					? [...value.report.unmatched, ...value.report.unsupported, ...value.report.ambiguous]
					: [];
				setNotice(
					value.report
						? t('configUpdated') +
								': ' +
								value.report.updated.length +
								'; ' +
								t('configPreserved') +
								': ' +
								skipped.length +
								(skipped.length ? ' (' + skipped.join(', ') + ')' : '')
						: t('configSaved'),
				);
			} catch (e) {
				setError(e.message);
			} finally {
				setBusy(false);
			}
		};

		const reload = async () => {
			setBusy(true);
			try {
				accept(await store.load());
				setError(null);
			} catch (e) {
				setError(e.message);
			} finally {
				setBusy(false);
			}
		};
		return { draft, dirty, busy, error, notice, patch, rowPatch, run, reload };
	};
}
