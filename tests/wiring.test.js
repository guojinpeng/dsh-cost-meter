import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const await_routes = (routes) =>
	new Promise((resolve) => {
		let count = 0;
		const timer = setInterval(() => {
			count += 1;
			if (routes.length >= 3 || count > 100) {
				clearInterval(timer);
				resolve(routes);
			}
		}, 10);
	});

test('apply registers the config, pricing and overview routes', async () => {
	// Isolate the plugin data directory before the module reads its paths.
	const home = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-wiring-'));
	process.env.DSH_HOME = home;
	const routes = [];
	const connection = { requestRejection: () => undefined };
	const webServer = {
		register: (route) => {
			routes.push(route.path);
			return () => {};
		},
	};
	const queryCtx = {
		sessionQuery: {
			listSessions: async () => [],
			readSession: async () => ({ session: {}, events: [] }),
			readTitleSnapshots: async () => [],
		},
		sessions: { get: () => undefined },
		on: () => () => {},
		inject: (services, callback) => callback({ connection, webServer, effect: (fn) => fn() }),
	};
	const ctx = {
		logger: { warn: () => {} },
		sessionProjections: { register: () => {}, stateOf: () => undefined },
		inject: (services, callback) => callback(queryCtx),
		effect: (fn) => fn(),
		get: () => undefined,
	};
	const mod = await import('../src/index.js');
	mod.apply(ctx);
	await await_routes(routes);
	assert.deepEqual(routes, [
		'/guojinpeng/dsh-cost-meter/config',
		'/guojinpeng/dsh-cost-meter/pricing/sync',
		'/guojinpeng/dsh-cost-meter/overview',
	]);
});
