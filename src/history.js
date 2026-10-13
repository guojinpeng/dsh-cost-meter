import { parseRouteKey, normalizeRate, zeroRate } from './pricing.js';

export function routeFromEvent(event) {
	if (event?.type !== 'assistant/message') return null;
	const source = event.data?.message?.source;
	return typeof source?.provider === 'string' &&
		source.provider !== '' &&
		typeof source.model === 'string' &&
		source.model !== ''
		? `${source.provider}/${source.model}`
		: null;
}

/** Migrate bare keys once; subsequent missing historical routes start at zero. */
export function reconcileConfig(config, models) {
	const pricing = {};
	for (const key of models) {
		const legacy = config.formatVersion !== 2 ? config.pricing[parseRouteKey(key).model] : null;
		pricing[key] = normalizeRate(config.pricing[key]) ?? normalizeRate(legacy) ?? zeroRate();
	}
	return { ...config, formatVersion: 2, pricing };
}

export function createHistoryModels(
	sessionQuery,
	{ readConfig, writeConfig, backupConfig, initializePrices, onError = () => {} },
) {
	const models = new Set();
	let ready = false,
		scanning = null,
		pending = Promise.resolve(),
		initializedOnce = false;
	async function reconcile() {
		const config = readConfig(true);
		const initialized = {};
		if (initializePrices) {
			const needsPrice = (key) =>
				!Object.hasOwn(initialized, key) &&
				!normalizeRate(config.pricing[key]) &&
				!(config.formatVersion !== 2 && normalizeRate(config.pricing[parseRouteKey(key).model]));
			let missing;
			do {
				missing = Object.fromEntries([...models].filter(needsPrice).map((key) => [key, zeroRate()]));
				if (Object.keys(missing).length || (!initializedOnce && !Object.keys(config.pricing).length)) {
					initializedOnce = true;
					try {
						Object.assign(initialized, (await initializePrices({ ...config, pricing: missing })).config.pricing);
					} catch (error) {
						Object.assign(initialized, missing);
						onError(error);
					}
				}
			} while ([...models].some(needsPrice));
		}
		// Re-read after network I/O so initialization never overwrites a manual edit.
		const latest = readConfig(true);
		const seeded = { ...latest, pricing: { ...initialized, ...latest.pricing } };
		const next = reconcileConfig(seeded, [...models].sort());
		if (JSON.stringify(next) !== JSON.stringify(latest)) {
			if (latest.formatVersion !== 2) backupConfig();
			writeConfig(next);
		}
		return next;
	}
	const service = {
		list: () => [...models].sort(),
		observe: async (event) => {
			const route = routeFromEvent(event);
			if (!route || models.has(route)) return;
			models.add(route);
			if (ready) await service.config();
		},
		config: async () => {
			if (!ready) {
				if (!scanning)
					scanning = (async () => {
						const sessions = await sessionQuery.listSessions();
						const discovered = new Set();
						// Bound cold reads and commit the model set only after a complete scan.
						for (let offset = 0; offset < sessions.length; offset += 4) {
							const logs = await Promise.all(
								sessions.slice(offset, offset + 4).map((row) => sessionQuery.readSession(row.header.id)),
							);
							for (const log of logs)
								for (const event of log.events) {
									const route = routeFromEvent(event);
									if (route) discovered.add(route);
								}
						}
						for (const route of discovered) models.add(route);
						ready = true;
					})().finally(() => {
						scanning = null;
					});
				await scanning;
			}
			pending = pending.catch(() => {}).then(reconcile);
			return pending;
		},
		save: (config) => writeConfig(reconcileConfig({ ...config, formatVersion: 2 }, [...models].sort())),
	};
	return service;
}
