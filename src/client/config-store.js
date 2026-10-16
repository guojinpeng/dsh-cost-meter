import { HTTP_BASE } from '../identity.js';
import { resolvedPriceSource } from '../price-sources.js';

export function createConfigStore(fetcher = (...args) => fetch(...args)) {
	let snapshot = null,
		sequence = 0,
		loading = null,
		loadStatus = 'idle';
	const listeners = new Set();
	let operations = Promise.resolve(),
		refreshTimer = null;
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const publish = (value) => {
		snapshot = value;
		clearTimeout(refreshTimer);
		if (value.historyPending || value.calendarPending?.length) {
			refreshTimer = setTimeout(() => store.load().catch(() => {}), 1000);
			refreshTimer.unref?.();
		}
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
		if (!response.ok) {
			const error = new Error(payload.error ?? `HTTP ${response.status}`);
			error.status = response.status;
			throw error;
		}
		return payload;
	}
	const enqueue = (operation) => {
		const next = operations.catch(() => {}).then(operation);
		operations = next;
		return next;
	};
	const inputConfig = ({ currency, priceSource, cnyPerUsd, showDockChip, showTurnChip, pricing }) => ({
		currency,
		priceSource,
		cnyPerUsd,
		showDockChip,
		showTurnChip,
		pricing,
	});
	const merge = (config, changes) => ({
		...config,
		...changes,
		pricing: {
			...config.pricing,
			...Object.fromEntries(
				Object.entries(changes.pricing ?? {}).map(([key, fields]) => [
					key,
					{ ...config.pricing[key], ...fields },
				]),
			),
		},
	});
	const conflicts = (before, after, changes) => {
		for (const [key, value] of Object.entries(changes)) {
			if (key === 'pricing') {
				for (const [route, fields] of Object.entries(value))
					for (const [field, next] of Object.entries(fields))
						if (
							before.pricing[route]?.[field] !== after.pricing[route]?.[field] &&
							after.pricing[route]?.[field] !== next
						)
							return true;
			} else if (before[key] !== after[key] && after[key] !== value) return true;
		}
		return false;
	};
	const store = {
		getSnapshot: () => snapshot,
		getLoadStatus: () => loadStatus,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		load: () => {
			if (loading) return loading;
			const ticket = sequence;
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
			const value = await request('config', { config: inputConfig(config), revision: snapshot?.revision });
			if (ticket !== sequence) return snapshot;
			sequence++;
			return publish(value);
		},
		update: (changes) => {
			const base = snapshot?.config;
			return enqueue(async () => {
				if (!snapshot) await store.load();
				const before = snapshot;
				sequence++;
				try {
					const value = await request('config', {
						config: inputConfig(merge(before.config, changes)),
						revision: before.revision,
					});
					sequence++;
					return publish(value);
				} catch (error) {
					if (error.status !== 409) throw error;
					const current = await request('config');
					sequence++;
					publish(current);
					if (conflicts(base ?? before.config, current.config, changes)) throw error;
					const value = await request('config', {
						config: inputConfig(merge(current.config, changes)),
						revision: current.revision,
					});
					sequence++;
					return publish(value);
				}
			});
		},
		/**
		 * Sync prices. With a staged config the server only previews the result and
		 * writes nothing; without one it keeps committing the synced prices.
		 */
		sync: (source, config) =>
			enqueue(async () => {
				const staged = config !== undefined;
				const selected = resolvedPriceSource(config ?? snapshot?.config ?? {});
				if (!staged && source !== undefined && source !== selected)
					throw new Error('Price source changed. Reload and retry.');
				if (!staged) sequence++;
				const value = await request('pricing/sync', {
					source: selected,
					revision: snapshot?.revision,
					...(staged ? { config: inputConfig(config) } : {}),
				});
				if (!staged) sequence++;
				return staged ? value : publish(value);
			}),
	};
	return store;
}