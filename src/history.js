import { parseRouteKey, normalizeRate, newRate } from './pricing.js';

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
		pricing[key] = normalizeRate(config.pricing[key]) ?? normalizeRate(legacy) ?? newRate(key);
	}
	return { ...config, formatVersion: 2, pricing };
}

/** Routes the user declared in the config, found in history or not. */
export const configuredKeys = (config) => Object.keys(config.pricing ?? {}).filter((key) => parseRouteKey(key));

/** The model set the config page lists: history routes plus declared routes. */
export const allModels = (models, config) => [...new Set([...models, ...configuredKeys(config)])].sort();

/** The projection that records every route and year found in one log. */
export function createHistoryDefinition() {
	return {
		init: () => ({ routes: [], years: [] }),
		apply: (state, event) => {
			if (Number.isFinite(event?.time)) state.years.push(new Date(event.time + 8 * 3600000).getUTCFullYear());
			const route = routeFromEvent(event);
			if (route) state.routes.push(route);
			return state;
		},
		stateVersion: 1,
	};
}

export function createHistoryModels(
	sessionQuery,
	{ readConfig, writeConfig, backupConfig, initializePrices, sessionLogs, onError = () => {} },
) {
	const models = new Set(),
		years = new Set();
	let ready = false,
		active = 0,
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
				missing = Object.fromEntries([...models].filter(needsPrice).map((key) => [key, newRate(key)]));
				if (Object.keys(missing).length || (!initializedOnce && !Object.keys(config.pricing).length)) {
					initializedOnce = true;
					try {
						Object.assign(
							initialized,
							(await initializePrices({ ...config, pricing: missing })).config.pricing,
						);
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
		const next = reconcileConfig(seeded, allModels(models, seeded));
		if (JSON.stringify(next) !== JSON.stringify(latest)) {
			if (latest.formatVersion !== 2) backupConfig();
			writeConfig(next);
		}
		return next;
	}
	const service = {
		list: () =>
			ready
				? allModels(models, readConfig())
				: Object.keys(readConfig().pricing)
						.filter((key) => parseRouteKey(key))
						.sort(),
		discovered: () => [...models].sort(),
		years: () => [...years],
		ready: () => ready,
		pending: () => active > 0,
		snapshot: () => readConfig(),
		observe: async (event) => {
			if (Number.isFinite(event?.time)) years.add(new Date(event.time + 8 * 3600000).getUTCFullYear());
			const route = routeFromEvent(event);
			if (!route || models.has(route)) return;
			models.add(route);
			if (ready) await service.config();
		},
		config: async () => {
			active++;
			try {
				if (!ready) {
					if (!scanning)
						scanning = (async () => {
							// One unreadable session must not block the configuration page: the
							// host refuses logs written by a newer harness, and older logs may
							// be corrupt. The scan skips those sessions.
							const sessions = await sessionQuery.listSessions().catch((error) => {
								onError(error);
								return [];
							});
							const discovered = new Set();
							const definition = createHistoryDefinition();
							const collect = (state) => {
								for (const year of state.years) years.add(year);
								for (const route of state.routes) discovered.add(route);
							};
							// Decode the log files first: the host replay is much slower. A
							// session without a readable log file still goes through the host.
							const locations = sessionLogs ? sessionLogs.locate() : new Map();
							for (const row of sessions) {
								const id = row?.header?.id;
								if (typeof id !== 'string') continue;
								const location = locations.get(id);
								if (location !== undefined && sessionLogs) {
									const folded = await sessionLogs.foldCached(
										id,
										location,
										sessionLogs.stampOf?.(location) ?? null,
									);
									const state = folded?.states?.history;
									if (state !== undefined) {
										collect(state);
										continue;
									}
								}
								const log = await sessionQuery.readSession(id).catch(() => null);
								const state = definition.init();
								for (const event of log?.events ?? []) definition.apply(state, event);
								collect(state);
							}
							for (const route of discovered) models.add(route);
							ready = true;
						})().finally(() => {
							scanning = null;
						});
					await scanning;
				}
				pending = pending.catch(() => {}).then(reconcile);
				return await pending;
			} finally {
				active--;
			}
		},
		save: (config) => {
			const next = { ...readConfig(true), ...config, formatVersion: 2 };
			return writeConfig(reconcileConfig(next, allModels(models, next)));
		},
	};
	return service;
}