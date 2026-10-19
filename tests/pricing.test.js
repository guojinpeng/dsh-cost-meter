import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfigStore, buildDraft, configOf } from '../src/client-store.js';
import { createHistoryModels } from '../src/history.js';
import { buildCostView, zeroRate, newRate } from '../src/pricing.js';
import { syncModelsDev, createModelsDev } from '../src/models-dev.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const config = () => ({
	formatVersion: 2,
	currency: 'USD',
	cnyPerUsd: 7.2,
	showDockChip: true,
	showTurnChip: true,
	pricing: {},
});
const event = (provider, model) => ({
	type: 'assistant/message',
	data: { message: { source: { provider, model } } },
});
const response = (payload, ok = true) => ({ ok, json: async () => payload });

test('history migration preserves old prices; missing and newly observed routes persist zero', async () => {
	let stored = {
			...config(),
			formatVersion: 1,
			pricing: { a: { ...zeroRate(), input: 2 }, unused: zeroRate() },
		},
		backups = 0;
	const history = createHistoryModels(
		{
			listSessions: async () => [{ header: { id: 's' } }],
			readSession: async () => ({ events: [event('p', 'a'), event('p', 'b')] }),
		},
		{
			readConfig: () => stored,
			writeConfig: (value) => {
				stored = value;
				return value;
			},
			backupConfig: () => backups++,
		},
	);
	await history.config();
	assert.equal(backups, 1);
	assert.deepEqual(Object.keys(stored.pricing), ['p/a', 'p/b']);
	assert.equal(stored.pricing['p/a'].input, 2);
	assert.deepEqual(stored.pricing['p/b'], newRate('p/b'));
	delete stored.pricing['p/a'];
	await history.config();
	assert.deepEqual(stored.pricing['p/a'], newRate('p/a'));
	await history.observe(event('p', 'c'));
	assert.deepEqual(stored.pricing['p/c'], newRate('p/c'));
});

test('an unreadable session does not prune config and does not block discovery', async () => {
	let stored = { ...config(), pricing: { 'p/a': zeroRate() } },
		fail = true,
		writes = 0;
	const history = createHistoryModels(
		{
			listSessions: async () => [{ header: { id: 's' } }],
			readSession: async () => {
				if (fail) throw new Error('read failed');
				return { events: [event('p', 'a')] };
			},
		},
		{
			readConfig: () => stored,
			writeConfig: (value) => {
				writes++;
				stored = value;
			},
			backupConfig: () => {},
		},
	);
	const reconciled = await history.config();
	assert.equal(writes, 0, 'the skipped session leaves the stored config unchanged');
	assert.deepEqual(Object.keys(reconciled.pricing), ['p/a'], 'the configured route survives the failed read');
	assert.equal(history.ready(), true);
	fail = false;
	assert.deepEqual((await history.config()).pricing, stored.pricing, 'the second read does not prune the config');
});

test('sync updates only configured exact routes and preserves absent cache rates', () => {
	const previous = { ...zeroRate(), cacheRead: 8, cacheWrite: 9 };
	const source = {
		...config(),
		pricing: {
			'custom/a': previous,
			'custom/a-prime': previous,
			'custom/tier': previous,
			'custom/bad': previous,
		},
	};
	const result = syncModelsDev(source, {
		alibaba: {
			models: {
				a: { cost: { input: 2, output: 6, cache_read: 0 } },
				extra: { cost: { input: 1, output: 1 } },
				tier: { cost: { input: 1, output: 1, tiers: [{ input: 2 }] } },
				bad: { cost: { input: 1, output: 1, cache_write: -1 } },
			},
		},
	});
	assert.deepEqual(Object.keys(result.config.pricing), Object.keys(source.pricing));
	assert.deepEqual(result.config.pricing['custom/a'], {
		currency: 'USD',
		source: 'models.dev',
		input: 2,
		output: 6,
		cacheRead: 0,
		cacheWrite: 9,
	});
	assert.deepEqual(result.report, {
		updated: ['custom/a'],
		unmatched: ['custom/a-prime'],
		unsupported: ['custom/tier', 'custom/bad'],
		ambiguous: [],
		details: [
			{ route: 'custom/a-prime', reason: 'unmatched' },
			{ route: 'custom/tier', reason: 'conditionalPricing' },
			{ route: 'custom/bad', reason: 'invalidPrice' },
		],
	});
	assert.equal(source.pricing['custom/a'].input, 0);
});

test('save publishes prices that reprice existing accounting without new session events', async () => {
	const initial = { config: { ...config(), pricing: { 'p/a': zeroRate() } }, models: ['p/a'], revision: '1' };
	const store = createConfigStore(async (url, options) =>
		options
			? response({ ...initial, config: JSON.parse(options.body).config, revision: '2' })
			: response(initial),
	);
	await store.load();
	const buckets = { uncachedInputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
	const accounting = {
		totals: buckets,
		byRoute: { 'p/a': buckets },
		turns: { 1: { totalTokens: 100, tokens: buckets, byRoute: { 'p/a': buckets }, recovered: false } },
		skippedTurns: 0,
	};
	let notifications = 0;
	store.subscribe(() => notifications++);
	const draft = buildDraft(initial);
	draft.rows[0].input = 3;
	await store.save(configOf(draft));
	const view = buildCostView(accounting, store.getSnapshot().config);
	assert.equal(view.totalMicros, 300);
	assert.equal(view.turns['1'].micros, 300);
	assert.equal(notifications, 1);
});

test('late GET cannot overwrite saved prices; failed writes preserve snapshot', async () => {
	let resolveGet,
		fail = false;
	const initial = { config: config(), models: [], revision: '1' };
	const store = createConfigStore((url, options) =>
		options
			? Promise.resolve(response(fail ? { error: 'conflict' } : { ...initial, revision: '2' }, !fail))
			: new Promise((resolve) => {
					resolveGet = resolve;
				}),
	);
	const loading = store.load();
	await store.save(config());
	resolveGet(response(initial));
	await loading;
	assert.equal(store.getSnapshot().revision, '2');
	fail = true;
	await assert.rejects(store.save(config()));
	assert.equal(store.getSnapshot().revision, '2');
});

test('models.dev network failure leaves input config unchanged', async () => {
	const input = config();
	const service = createModelsDev(async () => {
		throw new Error('offline');
	});
	await assert.rejects(service.prices(input), /offline/);
	assert.deepEqual(input.pricing, {});
});

test('context-dependent prices are preserved rather than flattened', () => {
	const input = { ...config(), pricing: { 'p/a': { ...zeroRate(), input: 4 } } };
	const result = syncModelsDev(input, {
		p: { models: { a: { cost: { input: 1, output: 2, context_over_200k: { input: 3, output: 4 } } } } },
	});
	assert.equal(result.config.pricing['p/a'].input, 4);
	assert.deepEqual(result.report.unsupported, ['p/a']);
});

test('model-only sync uses original vendor and applies the same price to all local providers', () => {
	const input = {
		...config(),
		pricing: {
			'A/qwen-test': zeroRate(),
			'B/qwen-test': zeroRate(),
			'C/unknown': { ...zeroRate(), input: 9 },
		},
	};
	const catalog = {
		'alibaba-token-plan': { models: { 'qwen-test': { cost: { input: 0, output: 0 } } } },
		proxy: {
			models: {
				'qwen-test': { cost: { input: 99, output: 99 } },
				unknown: { cost: { input: 1, output: 2 } },
			},
		},
		alibaba: { models: { 'qwen-test': { cost: { input: 2, output: 6 } } } },
		other: { models: { unknown: { cost: { input: 3, output: 4 } } } },
	};
	const result = syncModelsDev(input, catalog);
	assert.equal(result.config.pricing['A/qwen-test'].input, 2);
	assert.deepEqual(result.config.pricing['A/qwen-test'], result.config.pricing['B/qwen-test']);
	assert.equal(result.config.pricing['C/unknown'].input, 9);
	assert.deepEqual(result.report.ambiguous, ['C/unknown']);
	assert.equal(
		buildCostView(
			{
				totals: { uncachedInputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
				byRoute: {
					'A/qwen-test': { uncachedInputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
				},
				turns: {},
				skippedTurns: 0,
			},
			{ ...input, pricing: { 'B/qwen-test': { ...zeroRate(), input: 3 } } },
		).totalMicros,
		0,
	);
});

test('catalog persists under data and is reused offline; explicit sync fetches fresh data', async () => {
	const home = mkdtempSync(join(tmpdir(), 'cost-cache-'));
	const path = join(home, 'data', 'models.dev.json');
	try {
		const catalog = { p: { models: { a: { cost: { input: 2, output: 6 } } } } };
		let calls = 0;
		const service = createModelsDev(async () => {
			calls++;
			return response(catalog);
		}, path);
		await service.initialize(config());
		assert.equal(calls, 0, 'initialization never downloads a missing catalog');
		await service.prices(config());
		assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), catalog);
		await service.initialize({ ...config(), pricing: { 'A/a': zeroRate() } });
		assert.equal(calls, 1);
		const offline = createModelsDev(async () => {
			throw new Error('offline');
		}, path);
		assert.equal(
			(await offline.initialize({ ...config(), pricing: { 'B/a': zeroRate() } })).config.pricing['B/a'].input,
			2,
		);
		await service.prices(config());
		assert.equal(calls, 2);
		const broken = join(home, 'data', 'broken.json');
		writeFileSync(broken, 'not json');
		const recovery = createModelsDev(async () => response(catalog), broken);
		await recovery.initialize(config());
		assert.equal(
			readFileSync(broken, 'utf8'),
			'not json',
			'automatic initialization does not repair by fetching',
		);
		await recovery.prices(config());
		assert.deepEqual(JSON.parse(readFileSync(broken, 'utf8')), catalog);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test('startup and new history routes initialize only missing prices and preserve manual edits', async () => {
	let stored = { ...config(), pricing: { 'A/a': { ...zeroRate(), input: 9 } } },
		calls = 0;
	const history = createHistoryModels(
		{
			listSessions: async () => [{ header: { id: 's' } }],
			readSession: async () => ({ events: [event('A', 'a'), event('B', 'a')] }),
		},
		{
			readConfig: () => stored,
			writeConfig: (value) => {
				stored = value;
				return value;
			},
			backupConfig: () => {},
			initializePrices: async (input) => {
				calls++;
				return syncModelsDev(input, { p: { models: { a: { cost: { input: 2, output: 6 } } } } });
			},
		},
	);
	await history.config();
	assert.equal(stored.pricing['A/a'].input, 9);
	assert.equal(stored.pricing['B/a'].input, 2);
	await history.config();
	assert.equal(calls, 1);
	await history.observe(event('C', 'a'));
	assert.equal(stored.pricing['C/a'].input, 2);
	assert.equal(calls, 2);
});

test('restart with configured prices skips catalog initialization, including zero prices', async () => {
	for (const formatVersion of [1, 2]) {
		let stored = {
			...config(),
			formatVersion,
			pricing:
				formatVersion === 1
					? { a: { ...zeroRate(), input: 9 }, b: zeroRate() }
					: { 'A/a': { ...zeroRate(), input: 9 }, 'B/b': zeroRate() },
		};
		let calls = 0;
		const query = {
			listSessions: async () => [{ header: { id: 's' } }],
			readSession: async () => ({ events: [event('A', 'a'), event('B', 'b')] }),
		};
		const options = {
			readConfig: () => stored,
			writeConfig: (value) => (stored = value),
			backupConfig: () => {},
			initializePrices: async () => {
				calls++;
				throw new Error('Unexpected catalog request');
			},
		};
		for (let restart = 0; restart < 2; restart++) {
			const history = createHistoryModels(query, options);
			await history.config();
			await history.config();
			assert.equal(stored.pricing['A/a'].input, 9);
			assert.deepEqual(stored.pricing['B/b'], zeroRate());
		}
		assert.equal(calls, 0);
	}
});

test('empty first installation initializes the catalog once without adding models', async () => {
	let stored = config(),
		calls = 0;
	const history = createHistoryModels(
		{ listSessions: async () => [], readSession: async () => ({ events: [] }) },
		{
			readConfig: () => stored,
			writeConfig: (value) => (stored = value),
			backupConfig: () => {},
			initializePrices: async (input) => {
				calls++;
				return { config: input };
			},
		},
	);
	await history.config();
	await history.config();
	assert.equal(calls, 1);
	assert.deepEqual(stored.pricing, {});
});

test('manual price written during initialization wins', async () => {
	let stored = config();
	const history = createHistoryModels(
		{
			listSessions: async () => [{ header: { id: 's' } }],
			readSession: async () => ({ events: [event('A', 'a')] }),
		},
		{
			readConfig: () => stored,
			writeConfig: (value) => {
				stored = value;
				return value;
			},
			backupConfig: () => {},
			initializePrices: async (input) => {
				stored = { ...stored, pricing: { 'A/a': { ...zeroRate(), input: 7 } } };
				return { config: { ...input, pricing: { 'A/a': { ...zeroRate(), input: 2 } } } };
			},
		},
	);
	await history.config();
	assert.equal(stored.pricing['A/a'].input, 7);
});

test('a declared route joins the model list and leaves with the saved config', async () => {
	let stored = { ...config(), pricing: { 'p/a': zeroRate(), 'declared/model': zeroRate() } };
	const history = createHistoryModels(
		{
			listSessions: async () => [{ header: { id: 's' } }],
			readSession: async () => ({ events: [event('p', 'a')] }),
		},
		{
			readConfig: () => stored,
			writeConfig: (value) => (stored = value),
			backupConfig: () => {},
		},
	);
	await history.config();
	assert.deepEqual(history.list(), ['declared/model', 'p/a']);
	assert.deepEqual(history.discovered(), ['p/a']);
	history.save({ ...stored, pricing: { 'p/a': zeroRate() } });
	assert.deepEqual(history.list(), ['p/a']);
	assert.deepEqual(Object.keys(stored.pricing), ['p/a']);
});

test('config loading status ends on both success and failure', async () => {
	let complete;
	const store = createConfigStore(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const loading = store.load();
	assert.equal(store.getLoadStatus(), 'loading');
	complete(response({ config: config(), models: [] }));
	await loading;
	assert.equal(store.getLoadStatus(), 'ready');
	const failed = createConfigStore(async () => {
		throw new Error('offline');
	});
	await assert.rejects(failed.load());
	assert.equal(failed.getLoadStatus(), 'error');
});
