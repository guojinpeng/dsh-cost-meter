import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHistoryModels } from './history.js';
import { createModelsDev } from './models-dev.js';
import { PLUGIN_ID, HTTP_BASE } from './identity.js';
import { CONFIG_PATH, readConfig, writeConfig, seedConfigFile } from './server/config-store.js';
import { createCostUsageProjection } from './server/projection.js';
import { createConfigHandler } from './server/config-handler.js';

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
	ctx.sessionProjections.register(createCostUsageProjection());
	// Headless profiles still get the projection; HTTP requires browser auth.
	ctx.inject(['sessionQuery'], (queryCtx) => {
		const prices = createModelsDev(undefined, join(dirname(CONFIG_PATH), 'data', 'models.dev.json'));
		const history = createHistoryModels(queryCtx.sessionQuery, {
			readConfig,
			writeConfig,
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
			const handler = createConfigHandler(webCtx.connection, history, prices);
			for (const path of [CONFIG_ROUTE, `${HTTP_BASE}/pricing/sync`]) {
				webCtx.effect(
					() => webCtx.webServer.register({ kind: 'exact', path, handler }),
					`guojinpeng/dsh-cost-meter: ${path}`,
				);
			}
		});
	});
}

// Keep named exports: Cordis unwraps a default function and loses `inject`.
