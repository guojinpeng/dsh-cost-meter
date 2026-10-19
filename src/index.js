import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHistoryModels } from './history.js';
import { createPriceService } from './server/price-service.js';
import { PLUGIN_ID, HTTP_BASE, PROJECTION_KEY } from './identity.js';
import { CONFIG_PATH, readConfig, writeConfig, seedConfigFile } from './server/config-store.js';
import { createCostUsageProjection } from './server/projection.js';
import { createConfigHandler } from './server/config-handler.js';
import { createOverviewCache } from './server/overview-cache.js';
import { createOverviewHandler } from './server/overview.js';
import { createSessionLogs } from './server/session-log.js';
import { createHolidayStore } from './server/holiday-store.js';

export { readConfig } from './server/config-store.js';
export { stateSchema, viewSchema } from './server/schemas.js';
export { createCostUsageProjection } from './server/projection.js';
export { createConfigHandler } from './server/config-handler.js';

export const inject = ['sessionProjections'];
export const name = PLUGIN_ID;
const CONFIG_ROUTE = `${HTTP_BASE}/config`;

/**
 * Register the cost projection and the config HTTP route.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
	seedConfigFile(ctx.logger);
	const holidays = createHolidayStore(join(dirname(CONFIG_PATH), 'data', 'holidays'), undefined, (error) =>
		ctx.logger?.warn('Could not load holiday calendar', error),
	);
	holidays.ensure(new Date(Date.now() + 8 * 3600000).getUTCFullYear());
	ctx.sessionProjections.register(createCostUsageProjection(readConfig, holidays));
	// Headless profiles still get the projection; HTTP requires browser auth.
	ctx.inject(['sessionQuery'], (queryCtx) => {
		const prices = createPriceService(join(dirname(CONFIG_PATH), 'data'));
		const overviewCache = createOverviewCache(join(dirname(CONFIG_PATH), 'data', 'cache'));
		// Session logs are read directly, which is much faster than replaying
		// every event through the host query service.
		let warnedLog = false;
		const sessionLogs = createSessionLogs({
			onError: (error) => {
				if (warnedLog) return;
				warnedLog = true;
				ctx.logger?.warn('Could not read a session log', error);
			},
		});
		const history = createHistoryModels(queryCtx.sessionQuery, {
			readConfig,
			writeConfig,
			sessionLogs,
			initializePrices: prices.initialize,
			onError: (error) => ctx.logger?.warn('Could not initialize model prices', error),
			backupConfig: () => {
				const backup = `${CONFIG_PATH}.v0.1.1.bak`;
				if (existsSync(CONFIG_PATH) && !existsSync(backup)) copyFileSync(CONFIG_PATH, backup);
			},
		});
		queryCtx.on('session/event', (_session, event) => {
			history.observe(event).catch((error) => ctx.logger?.warn('Could not persist historical model', error));
		});
		history.config().catch((error) => ctx.logger?.warn('Could not discover historical models', error));
		queryCtx.inject(['webServer', 'connection'], (webCtx) => {
			const handler = createConfigHandler(webCtx.connection, history, prices, holidays);
			for (const path of [CONFIG_ROUTE, `${HTTP_BASE}/pricing/sync`]) {
				webCtx.effect(
					() => webCtx.webServer.register({ kind: 'exact', path, handler }),
					`guojinpeng/dsh-cost-meter: ${path}`,
				);
			}
			// The overview reads live sessions from the host projection and folds
			// persisted ones once per session.
			const liveStateOf = (id) => {
				try {
					const session = queryCtx.sessions?.get?.(id);
					return session ? ctx.sessionProjections.stateOf(session, PROJECTION_KEY) : undefined;
				} catch {
					return undefined;
				}
			};
			const overview = createOverviewHandler(
				webCtx.connection,
				queryCtx.sessionQuery,
				holidays,
				liveStateOf,
				sessionLogs,
				overviewCache,
			);
			webCtx.effect(
				() =>
					webCtx.webServer.register({
						kind: 'exact',
						path: `${HTTP_BASE}/overview`,
						handler: overview,
					}),
				'guojinpeng/dsh-cost-meter: overview',
			);
		});
	});
}

// Keep named exports: Cordis unwraps a default function and loses `inject`.
