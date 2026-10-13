import { HTTP_BASE } from '../identity.js';

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
