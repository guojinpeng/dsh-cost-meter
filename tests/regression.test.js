import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test, after } from 'node:test';
import { Readable } from 'node:stream';
import { execSync } from 'node:child_process';
import { buildCostView } from '../src/pricing.js';
import * as identity from '../src/identity.js';
import { createUseCostView } from '../src/client/cost-view.js';
import { createCostDialog } from '../src/client/cost-dialog.js';
import { createCostChips } from '../src/client/cost-chips.js';

// Resolve peers from the installed DSH without changing the user's profile.
const runtime =
	process.env.DSH_RUNTIME_ROOT ??
	join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@deepseek-ai', 'dsh');
const require = createRequire(pathToFileURL(join(runtime, 'package.json')));
const home = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-test-'));
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;
const host = await import('../src/index.js');
const configStore = await import('../src/server/config-store.js');
const { HostConnectionService } = await import(
	pathToFileURL(require.resolve('@deepseek-ai/dsh-client-connection'))
);
// The host fence is used as is; requestRejection delegates to admit() in recent
// host versions, so the stand-in carries the state that admit() reads.
const connection = {
	trustedHosts: ['dsh.local:3000'],
	browserAuth: {
		isAuthenticated: (req) => req.headers.cookie === 'test-session',
		authenticateApi: () => undefined,
	},
	owner: { get: () => undefined },
	disposed: false,
	browserPeer: { id: 'test-peer' },
	peers: new Map(),
	requestRejection: HostConnectionService.prototype.requestRejection,
	admit: HostConnectionService.prototype.admit,
	isTrusted: HostConnectionService.prototype.isTrusted,
};
after(() => {
	if (previousHome === undefined) delete process.env.DSH_HOME;
	else process.env.DSH_HOME = previousHome;
	rmSync(home, { recursive: true, force: true });
});

let configSnapshot = null,
	loadStatus = 'idle';
const react = {
	createElement: (type, props, children) => ({ type, props, children }),
	useSyncExternalStore: (_, get) => get(),
	useEffect: () => {},
	useMemo: (compute) => compute(),
};
const useCostView = createUseCostView(react, {
	getSnapshot: () => configSnapshot,
	getLoadStatus: () => loadStatus,
	subscribe: () => () => {},
});
const client = { useCostView, ...createCostChips(react, useCostView, createCostDialog(react, {})) };

const rate = (value) => ({ input: value, output: value, cacheRead: value, cacheWrite: value });

test('existing config is read without rewriting and appended model settings survive reload', () => {
	const key = 'deepseek-official/deepseek-flash';
	const original = {
		formatVersion: 2,
		currency: 'CNY',
		cnyPerUsd: 7,
		showDockChip: true,
		showTurnChip: true,
		showSidebarCost: true,
		autoRefreshCost: true,
		autoRefreshMinutes: 5,
		pricing: { [key]: rate(2) },
	};
	configStore.writeConfig(original);
	const bytes = readFileSync(configStore.CONFIG_PATH, 'utf8');
	const read = configStore.readConfig(true);
	assert.deepEqual(read, original);
	assert.equal(readFileSync(configStore.CONFIG_PATH, 'utf8'), bytes);
	configStore.writeConfig({
		...read,
		priceSource: 'openrouter.ai',
		pricing: { [key]: { ...rate(14), currency: 'CNY', autoOffPeak: true, source: 'manual' } },
	});
	assert.deepEqual(configStore.readConfig(true).pricing[key], {
		...rate(14),
		currency: 'CNY',
		autoOffPeak: true,
		source: 'manual',
	});
	assert.equal(configStore.readConfig(true).priceSource, 'openrouter.ai');
	assert.equal(configStore.readConfig(true).formatVersion, 2);
});

test('initializing view clears when pricing loads or fails and supports both chips', () => {
	configSnapshot = null;
	loadStatus = 'idle';
	const buckets = { uncachedInputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
	const raw = {
		accounting: { totals: buckets, byRoute: { 'p/a': buckets }, turns: {}, skippedTurns: 0 },
		totalMicros: 0,
	};
	const props = { useProjection: () => raw };
	assert.equal(client.useCostView(props).initializing, true);
	for (const turn of [false, true]) {
		const chip = client.InitializingChip({ t: () => 'Initializing', turn });
		assert.equal(chip.props.role, 'status');
		assert.equal(chip.children.children[1].children, 'Initializing');
	}
	configSnapshot = { config: { currency: 'USD', cnyPerUsd: 7.2, pricing: { 'p/a': rate(2) } } };
	loadStatus = 'ready';
	assert.equal(client.useCostView(props).initializing, undefined);
	assert.equal(client.useCostView(props).totalMicros, 200);
	configSnapshot = null;
	loadStatus = 'error';
	assert.equal(client.useCostView(props).initializing, undefined);
	loadStatus = 'idle';
});

test('priced server views display session and turn fees before the config request completes', () => {
	configSnapshot = null;
	loadStatus = 'loading';
	const accounting = {
		totals: { uncachedInputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
		byRoute: {},
		turns: {},
		skippedTurns: 0,
	};
	accounting.byRoute['p/a'] = accounting.totals;
	accounting.turns['1'] = {
		totalTokens: 100,
		tokens: accounting.totals,
		byRoute: accounting.byRoute,
		recovered: false,
	};
	for (const price of [2, 0]) {
		const config = { currency: 'USD', cnyPerUsd: 7.2, pricing: { 'p/a': rate(price) } };
		const raw = { ...buildCostView(accounting, config), accounting };
		const props = { useProjection: () => raw };
		const view = client.useCostView(props);
		assert.equal(view.initializing, undefined);
		assert.equal(view.totalMicros, 100 * price);
		assert.equal(view.turns['1'].micros, 100 * price);
	}
	const unpriced = {
		...buildCostView(accounting, { currency: 'USD', cnyPerUsd: 7.2, pricing: {} }),
		accounting,
	};
	assert.equal(client.useCostView({ useProjection: () => unpriced }).initializing, true);
	loadStatus = 'idle';
});
const usage = {
	inputTokens: 100,
	outputTokens: 100,
	totalTokens: 200,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
};
const event = (type, data = {}) => ({ type, data: { turn: 1, ...data } });
function step(number, model, sample = usage) {
	return [
		event('step/start', { step: number }),
		event('assistant/message', {
			step: number,
			usage: sample,
			message: { source: { provider: 'p', model } },
		}),
		event('step/end', { step: number }),
	];
}
function project(events, config) {
	const projection = host.createCostUsageProjection(() => config);
	let state = projection.init();
	for (const item of events) state = projection.apply(state, item);
	host.stateSchema.parse(state);
	return { projection, state, view: projection.wire.view(state) };
}
const turn = (...events) => [event('turn/start'), ...events, event('turn/end')];

test('an inherited seed is billed to the original session, not to the side thread', () => {
	const config2 = { currency: 'USD', cnyPerUsd: 7.2, pricing: { 'p/a': rate(1) } };
	const seed = turn(...step(1, 'a'));
	assert.equal(project(seed, config2).view.totalTokens, 200);
	const later = [
		event('turn/start', { turn: 2 }),
		event('step/start', { turn: 2, step: 1 }),
		event('assistant/message', {
			turn: 2,
			step: 1,
			usage,
			message: { source: { provider: 'p', model: 'a' } },
		}),
		event('step/end', { turn: 2, step: 1 }),
		event('turn/end', { turn: 2 }),
	];
	// A side thread logs the inherited transcript, then the marker that ends it.
	const sideThread = project(
		[...seed, { type: 'session/end-seed', data: { inherited: true } }, ...later],
		config2,
	);
	assert.equal(sideThread.view.totalTokens, 200);
	// A plain session keeps every turn, even after its own end-of-seed marker.
	const plain = project([...seed, { type: 'session/end-seed', data: {} }, ...later], config2);
	assert.equal(plain.view.totalTokens, 400);
});

test('multiple models and live prices agree for session and turn', () => {
	const config = { currency: 'USD', cnyPerUsd: 7.2, pricing: { 'p/a': rate(1), 'p/b': rate(10) } };
	const { projection, state, view } = project(turn(...step(1, 'a'), ...step(2, 'b')), config);
	assert.equal(view.totalMicros, 2200);
	assert.equal(view.turns['1'].micros, 2200);
	assert.equal(view.turns['1'].bucketMicros.input, 1100);
	assert.deepEqual(
		view.turns['1'].routes.map((entry) => entry.route),
		['p/a', 'p/b'],
	);
	assert.strictEqual(projection.wire.view(state), view);
	config.pricing['p/a'] = rate(2);
	const changed = projection.wire.view(state);
	assert.equal(changed.totalMicros, 2400);
	assert.equal(changed.turns['1'].micros, 2400);
});

test('timestamp replacement moves usage between periods without counting tokens twice', () => {
	const config = {
		cnyPerUsd: 7,
		pricing: { 'deepseek-official/deepseek-flash': { ...rate(2), currency: 'CNY', autoOffPeak: true } },
	};
	const projection = host.createCostUsageProjection(() => config, {
		ensure: () => {},
		snapshot: () => ({ 2026: ['2026-10-01'] }),
	});
	let state = projection.init();
	const stamped = (type, data, clock) => ({
		...event(type, data),
		time: Date.parse(`2026-10-14T${clock}+08:00`),
	});
	state = projection.apply(state, stamped('turn/start', {}, '11:59:00'));
	state = projection.apply(state, stamped('step/start', { step: 1 }, '11:59:00'));
	state = projection.apply(
		state,
		stamped(
			'assistant/message',
			{ step: 1, usage, message: { source: { provider: 'deepseek-official', model: 'deepseek-flash' } } },
			'11:59:59',
		),
	);
	assert.equal(projection.wire.view(state).amounts[0].micros, 400);
	state = projection.apply(
		state,
		stamped(
			'assistant/message',
			{ step: 1, usage, message: { source: { provider: 'deepseek-official', model: 'deepseek-flash' } } },
			'12:00:00',
		),
	);
	assert.equal(projection.wire.view(state).totalTokens, 200);
	assert.equal(projection.wire.view(state).amounts[0].micros, 200);
	// A completed turn uses a single durable settlement, as in a real DSH log.
	state = projection.init();
	for (const sample of [
		stamped('turn/start', {}, '11:59:00'),
		stamped('step/start', { step: 1 }, '11:59:00'),
		stamped(
			'assistant/message',
			{ step: 1, usage, message: { source: { provider: 'deepseek-official', model: 'deepseek-flash' } } },
			'12:00:00',
		),
	])
		state = projection.apply(state, sample);
	state = projection.apply(state, stamped('step/end', { step: 1 }, '12:00:00'));
	state = projection.apply(state, stamped('turn/end', {}, '12:00:00'));
	const view = projection.wire.view(state);
	assert.equal(view.totalTokens, 200);
	assert.equal(view.amounts[0].micros, 200);
	assert.equal(view.turns['1'].amounts[0].micros, 200);
	assert.equal(view.offPeakTokens, 200);
	assert.equal(view.peakTokens, 0);
	const turnRoute = view.turns['1'].routes[0];
	const money = Object.values(turnRoute.periodMicros).flatMap((entry) => Object.values(entry));
	assert.equal(
		money.reduce((sum, value) => sum + value, 0),
		view.turns['1'].amounts[0].micros,
	);
	const tokens = Object.values(turnRoute.tokensByPeriod).flatMap((entry) => Object.values(entry));
	assert.equal(
		tokens.reduce((sum, value) => sum + value, 0),
		view.turns['1'].totalTokens,
	);
	host.stateSchema.parse(state);
});

test('configuration GET displays local prices while history discovery is still running', async () => {
	const req = Readable.from([]);
	Object.assign(req, {
		method: 'GET',
		headers: { host: 'dsh.local:3000', cookie: 'test-session' },
		url: '/guojinpeng/dsh-cost-meter/config',
	});
	let payload;
	await host.createConfigHandler(connection, {
		config: async () => {
			throw new Error('GET must not wait for history');
		},
		snapshot: () => ({ currency: 'CNY', cnyPerUsd: 7, pricing: { 'p/a': rate(3) } }),
		list: () => ['p/a'],
		ready: () => false,
	})(req, {
		writeHead: (status) => assert.equal(status, 200),
		end: (value) => {
			payload = JSON.parse(value);
		},
	});
	assert.equal(payload.config.pricing['p/a'].input, 3);
	assert.equal(payload.historyPending, true);
	assert.deepEqual(payload.discovered, ['p/a'], 'without a discovery list the models stand in');
});

test('one handler serializes concurrent writes and rejects the stale revision', async () => {
	let config = { cnyPerUsd: 7, showDockChip: true, showTurnChip: true, pricing: { 'p/a': rate(2) } };
	const handler = host.createConfigHandler(connection, {
		config: async () => config,
		list: () => ['p/a'],
		save: (value) => {
			config = value;
		},
	});
	async function send(method, body) {
		const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
		Object.assign(req, {
			method,
			url: '/guojinpeng/dsh-cost-meter/config',
			headers: {
				host: 'dsh.local:3000',
				cookie: 'test-session',
				origin: 'http://dsh.local:3000',
				'content-type': 'application/json',
			},
		});
		let status, payload;
		await handler(req, {
			writeHead: (value) => {
				status = value;
			},
			end: (value) => {
				payload = JSON.parse(value);
			},
		});
		return { status, payload };
	}
	const { payload: before } = await send('GET');
	const first = { ...config, cnyPerUsd: 8 },
		second = { ...config, cnyPerUsd: 9 };
	const results = await Promise.all([
		send('POST', { revision: before.revision, config: first }),
		send('POST', { revision: before.revision, config: second }),
	]);
	assert.deepEqual(
		results.map(({ status }) => status),
		[200, 409],
	);
	assert.equal(config.cnyPerUsd, 8);
});

test('price sync accepts only the configured source and never fetches an arbitrary URL', async () => {
	let config = {
		cnyPerUsd: 7,
		priceSource: 'openrouter.ai',
		showDockChip: true,
		showTurnChip: true,
		pricing: { 'p/a': rate(2) },
	};
	const calls = [];
	const handler = host.createConfigHandler(
		connection,
		{
			config: async () => config,
			list: () => ['p/a'],
			save: (value) => {
				config = value;
			},
		},
		{
			prices: async (value, source) => {
				calls.push(source);
				return { config: value, report: {} };
			},
		},
	);
	async function send(method, body) {
		const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
		Object.assign(req, {
			method,
			url: '/guojinpeng/dsh-cost-meter/pricing/sync',
			headers: {
				host: 'dsh.local:3000',
				cookie: 'test-session',
				origin: 'http://dsh.local:3000',
				'content-type': 'application/json',
			},
		});
		let status, payload;
		await handler(req, {
			writeHead: (value) => {
				status = value;
			},
			end: (value) => {
				payload = JSON.parse(value);
			},
		});
		return { status, payload };
	}
	const { payload: before } = await send('GET');
	assert.equal(
		(await send('POST', { revision: before.revision, source: 'https://untrusted.example' })).status,
		400,
	);
	assert.equal((await send('POST', { revision: before.revision, source: 'models.dev' })).status, 409);
	assert.deepEqual(calls, []);
	assert.equal((await send('POST', { revision: before.revision, source: 'openrouter.ai' })).status, 200);
	assert.deepEqual(calls, ['openrouter.ai']);
});

test('a staged price sync previews the draft and saves nothing', async () => {
	let config = {
		cnyPerUsd: 7,
		priceSource: 'openrouter.ai',
		showDockChip: true,
		showTurnChip: true,
		pricing: { 'p/a': rate(2) },
	};
	let saves = 0;
	const priced = [];
	const handler = host.createConfigHandler(
		connection,
		{
			config: async () => config,
			list: () => ['p/a'],
			discovered: () => ['p/a'],
			save: (value) => {
				saves++;
				config = value;
			},
		},
		{
			prices: async (value, source) => {
				priced.push([source, value.pricing['p/a'].input]);
				return { config: { ...value, pricing: { 'p/a': rate(9) } }, report: { updated: ['p/a'] } };
			},
		},
	);
	async function send(method, body) {
		const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
		Object.assign(req, {
			method,
			url: '/guojinpeng/dsh-cost-meter/pricing/sync',
			headers: {
				host: 'dsh.local:3000',
				cookie: 'test-session',
				origin: 'http://dsh.local:3000',
				'content-type': 'application/json',
			},
		});
		let status, payload;
		await handler(req, {
			writeHead: (value) => {
				status = value;
			},
			end: (value) => {
				payload = JSON.parse(value);
			},
		});
		return { status, payload };
	}
	const { payload: before } = await send('GET');
	assert.deepEqual(before.discovered, ['p/a']);
	const staged = { ...config, pricing: { 'p/a': rate(5) } };
	const preview = await send('POST', { revision: before.revision, source: 'openrouter.ai', config: staged });
	assert.equal(preview.status, 200);
	assert.equal(preview.payload.preview.pricing['p/a'].input, 9);
	assert.deepEqual(preview.payload.report, { updated: ['p/a'] });
	assert.equal(preview.payload.config.pricing['p/a'].input, 2, 'the stored config is untouched');
	assert.equal(preview.payload.revision, before.revision);
	assert.equal(saves, 0);
	assert.deepEqual(priced, [['openrouter.ai', 5]], 'the draft is priced, not the stored config');
	// A staged draft names its own source, so a different one is a conflict.
	assert.equal(
		(await send('POST', { revision: before.revision, source: 'models.dev', config: staged })).status,
		409,
	);
	assert.deepEqual(priced, [['openrouter.ai', 5]]);
	assert.equal(saves, 0);
});

test('unknown models stay unpriced and become priced after configuration', () => {
	const config = { currency: 'USD', cnyPerUsd: 7.2, pricing: {} };
	const { projection, state, view } = project(turn(...step(1, 'unknown')), config);
	assert.equal(view.unpricedTokens, 200);
	assert.equal(view.turns['1'].priced, false);
	config.pricing['p/unknown'] = rate(3);
	assert.equal(projection.wire.view(state).turns['1'].micros, 600);
	assert.equal(projection.wire.view(state).unpricedTokens, 0);
});

test('retry usage without model attribution stays unpriced', () => {
	const stream = [{ type: 'chunk', chunk: { type: 'usage', usage } }];
	const events = turn(
		event('step/start', { step: 1 }),
		event('assistant/attempt', { step: 1, stream }),
		event('llm/retry', { step: 1 }),
		event('llm/retry-started', { step: 1 }),
		event('assistant/message', { step: 1, usage, message: { source: { provider: 'p', model: 'a' } } }),
		event('step/end', { step: 1 }),
	);
	const { view } = project(events, { currency: 'USD', cnyPerUsd: 7.2, pricing: { 'p/a': rate(1) } });
	assert.equal(view.totalTokens, 400);
	assert.equal(view.totalMicros, 200);
	assert.equal(view.turns['1'].micros, 200);
	assert.equal(view.unpricedTokens, 200);
});

test('missing cache split is recovered consistently', () => {
	const sample = { inputTokens: 100, outputTokens: 100, totalTokens: 250 };
	const { view } = project(turn(...step(1, 'a', sample)), {
		currency: 'USD',
		cnyPerUsd: 7.2,
		pricing: { 'p/a': rate(1) },
	});
	assert.equal(view.totalMicros, 250);
	assert.equal(view.turns['1'].micros, 250);
});

test('turn action resolves only the completed turn closing message', () => {
	const nodes = [
		{ kind: 'assistant-step', data: { finalNode: { messageId: 'intermediate' }, turn: 2 } },
		{ kind: 'turn-tail', data: { turn: 2, closing: { finalNode: { messageId: 'final' } } } },
		{ kind: 'turn-tail', data: { turn: 3, closing: null } },
	];
	const props = { useChat: (selector) => selector({ nodes: { values: () => nodes } }), messageId: 'final' };
	assert.equal(client.CostTurnAction(props).props.turn, 2);
	assert.equal(client.CostTurnAction({ ...props, messageId: 'intermediate' }), null);
});

let saved = { currency: 'USD', cnyPerUsd: 7.2, showDockChip: true, showTurnChip: true, pricing: {} };
async function request(
	method,
	headers,
	body = '{}',
	remoteAddress = '192.168.1.20',
	url = '/guojinpeng/dsh-cost-meter/config',
	prices,
) {
	const req = Readable.from([Buffer.from(body)]);
	Object.assign(req, { method, headers, url, socket: { remoteAddress } });
	let status, payload;
	await host.createConfigHandler(
		connection,
		{
			config: async () => saved,
			list: () => ['p/a'],
			save: (value) => {
				saved = value;
			},
		},
		prices,
	)(req, {
		writeHead: (code) => {
			status = code;
		},
		end: (value) => {
			payload = JSON.parse(value);
		},
	});
	return { status, payload };
}
test('authenticated remote config works; cross-origin and non-JSON writes fail', async () => {
	const headers = {
		host: 'dsh.local:3000',
		origin: 'http://dsh.local:3000',
		'content-type': 'application/json',
		cookie: 'test-session',
	};
	const initial = await request('GET', headers);
	assert.equal(
		(
			await request(
				'POST',
				headers,
				JSON.stringify({
					revision: initial.payload.revision,
					config: { ...saved, pricing: { 'p/a': rate(2) } },
				}),
			)
		).status,
		200,
	);
	assert.equal(
		(await request('GET', { host: headers.host, 'sec-fetch-site': 'same-origin', cookie: headers.cookie }))
			.payload.config.pricing['p/a'].input,
		2,
	);
	assert.equal((await request('GET', { host: headers.host })).status, 401);
	assert.equal((await request('GET', { host: 'untrusted.local', cookie: headers.cookie })).status, 403);
	assert.equal((await request('POST', { ...headers, origin: 'http://other.local' })).status, 403);
	assert.equal((await request('POST', { ...headers, 'content-type': 'text/plain' })).status, 415);
	assert.equal((await request('POST', headers, '{')).status, 400);
});

test('concurrent config edits during sync and network failure do not overwrite prices', async () => {
	const headers = {
		host: 'dsh.local:3000',
		origin: 'http://dsh.local:3000',
		'content-type': 'application/json',
		cookie: 'test-session',
	};
	const before = (await request('GET', headers)).payload;
	const syncBody = JSON.stringify({ revision: before.revision, source: 'models.dev' });
	const conflict = await request(
		'POST',
		headers,
		syncBody,
		undefined,
		'/guojinpeng/dsh-cost-meter/pricing/sync',
		{
			prices: async (config) => {
				saved = { ...saved, cnyPerUsd: 8 };
				return { config: { ...config, cnyPerUsd: 9 }, report: {} };
			},
		},
	);
	assert.equal(conflict.status, 409);
	assert.equal(saved.cnyPerUsd, 8);
	const current = (await request('GET', headers)).payload;
	const failed = await request(
		'POST',
		headers,
		JSON.stringify({ revision: current.revision, source: 'models.dev' }),
		undefined,
		'/guojinpeng/dsh-cost-meter/pricing/sync',
		{
			prices: async () => {
				throw new Error('offline');
			},
		},
	);
	assert.equal(failed.status, 502);
	assert.equal(saved.cnyPerUsd, 8);
});