import { RATE_KEYS, zeroRate } from './pricing.js';
import { HTTP_BASE } from './identity.js';

export function createConfigStore(fetcher = (...args) => fetch(...args)) {
	let snapshot = null,
		sequence = 0,
		loading = null,
		loadStatus = 'idle';
	const listeners = new Set();
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const publish = (value) => {
		snapshot = value;
		notify();
		return value;
	};
	async function request(path, body) {
		const response = await fetcher(
			`${HTTP_BASE}/${path}`,
			body === undefined
				? undefined
				: {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(body),
					},
		);
		const payload = await response.json();
		if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
		return payload;
	}
	return {
		getSnapshot: () => snapshot,
		getLoadStatus: () => loadStatus,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		load: () => {
			if (loading) return loading;
			const ticket = ++sequence;
			loadStatus = 'loading';
			loading = request('config')
				.then((value) => (ticket === sequence ? publish(value) : (snapshot ?? value)))
				.catch((error) => {
					loadStatus = 'error';
					throw error;
				})
				.finally(() => {
					loading = null;
					if (loadStatus !== 'error') loadStatus = 'ready';
					notify();
				});
			notify();
			return loading;
		},
		save: async (config) => {
			const ticket = ++sequence;
			const value = await request('config', { config, revision: snapshot?.revision });
			return ticket === sequence ? publish(value) : snapshot;
		},
		sync: async () => {
			const ticket = ++sequence;
			const value = await request('pricing/sync', { source: 'models.dev', revision: snapshot?.revision });
			return ticket === sequence ? publish(value) : snapshot;
		},
	};
}

export function buildDraft(payload) {
	const config = payload.config;
	return {
		currency: config.currency,
		cnyPerUsd: config.cnyPerUsd,
		showDockChip: config.showDockChip,
		showTurnChip: config.showTurnChip,
		rows: payload.models.map((key) => ({ key, ...(config.pricing[key] ?? zeroRate()) })),
	};
}

export function configOf(draft) {
	const cnyPerUsd = Number(draft.cnyPerUsd);
	if (!Number.isFinite(cnyPerUsd) || cnyPerUsd <= 0) throw new Error('Invalid USD/CNY exchange rate');
	const pricing = {};
	for (const row of draft.rows) {
		if (
			RATE_KEYS.some(
				(key) => String(row[key]).trim() === '' || !Number.isFinite(Number(row[key])) || Number(row[key]) < 0,
			)
		) {
			throw new Error(`Invalid rate: ${row.key}`);
		}
		pricing[row.key] = Object.fromEntries(RATE_KEYS.map((key) => [key, Number(row[key])]));
	}
	return {
		currency: draft.currency,
		cnyPerUsd,
		showDockChip: draft.showDockChip,
		showTurnChip: draft.showTurnChip,
		pricing,
	};
}
