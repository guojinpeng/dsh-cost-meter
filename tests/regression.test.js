import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
	process.env.DSH_RUNTIME_ROOT ?? join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@deepseek-ai', 'dsh');
const require = createRequire(pathToFileURL(join(runtime, 'package.json')));
const home = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-test-'));
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;
const host = await import('../src/index.js');
const { HostConnectionService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-connection')));
const connection = {
	trustedHosts: ['dsh.local:3000'],
	browserAuth: { isAuthenticated: (req) => req.headers.cookie === 'test-session' },
	requestRejection: HostConnectionService.prototype.requestRejection,
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

test('initializing view clears when pricing loads or fails and supports both chips', () => {
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
const usage = { inputTokens: 100, outputTokens: 100, totalTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 };
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

test('multiple models and live prices agree for session and turn', () => {
	const config = { currency: 'USD', cnyPerUsd: 7.2, pricing: { 'p/a': rate(1), 'p/b': rate(10) } };
	const { projection, state, view } = project(turn(...step(1, 'a'), ...step(2, 'b')), config);
	assert.equal(view.totalMicros, 2200);
	assert.equal(view.turns['1'].micros, 2200);
	assert.equal(view.turns['1'].bucketMicros.input, 1100);
	assert.strictEqual(projection.wire.view(state), view);
	config.pricing['p/a'] = rate(2);
	const changed = projection.wire.view(state);
	assert.equal(changed.totalMicros, 2400);
	assert.equal(changed.turns['1'].micros, 2400);
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
				JSON.stringify({ revision: initial.payload.revision, config: { ...saved, pricing: { 'p/a': rate(2) } } }),
			)
		).status,
		200,
	);
	assert.equal(
		(await request('GET', { host: headers.host, 'sec-fetch-site': 'same-origin', cookie: headers.cookie })).payload
			.config.pricing['p/a'].input,
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
	const conflict = await request('POST', headers, syncBody, undefined, '/guojinpeng/dsh-cost-meter/pricing/sync', {
		prices: async (config) => {
			saved = { ...saved, cnyPerUsd: 8 };
			return { config: { ...config, cnyPerUsd: 9 }, report: {} };
		},
	});
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
