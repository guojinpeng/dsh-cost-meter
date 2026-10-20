import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPriceService } from '../src/server/price-service.js';
import { syncPrices } from '../src/price-sources/sync.js';
import { openRouter } from '../src/price-sources/openrouter.js';
import { deepInfra } from '../src/price-sources/deepinfra.js';
import { createHistoryModels } from '../src/history.js';
import { buildCostView, zeroRate } from '../src/pricing.js';
import { createConfigStore } from '../src/client/config-store.js';

const config = (pricing, priceSource = 'models.dev') => ({
	formatVersion: 2,
	cnyPerUsd: 7,
	priceSource,
	showDockChip: true,
	showTurnChip: true,
	pricing,
});
const orModel = (
	id,
	pricing = { prompt: '0.000002', completion: '0.000006', input_cache_read: '0.00000025' },
) => ({ id, pricing });
const diModel = (model_name, pricing = {}) => ({
	model_name,
	type: 'text-generation',
	pricing: { type: 'tokens', cents_per_input_token: 0.00002, cents_per_output_token: 0.00006, ...pricing },
});
const jsonResponse = (body, status = 200) => ({
	ok: status === 200,
	status,
	json: async () => body,
	text: async () => JSON.stringify(body),
});

test('OpenRouter converts USD/token, keeps zero and preserves missing cache fields', () => {
	const previous = { ...zeroRate(), cacheWrite: 9, currency: 'CNY', source: 'manual' };
	const input = config(
		{
			'A/qwen-test': previous,
			'B/qwen/qwen-test': zeroRate(),
			'A/qwen-test:free': zeroRate(),
			'A/unknown': previous,
		},
		'openrouter.ai',
	);
	const result = syncPrices(
		input,
		{
			data: [
				orModel('qwen/qwen-test'),
				orModel('qwen/qwen-test:free', { prompt: '0', completion: '0', input_cache_read: '0' }),
			],
		},
		openRouter,
	);
	assert.deepEqual(result.config.pricing['A/qwen-test'], {
		currency: 'CNY',
		source: 'openrouter.ai',
		input: 14,
		output: 42,
		cacheRead: 1.75,
		cacheWrite: 9,
	});
	assert.equal(result.config.pricing['B/qwen/qwen-test'].input, 2);
	assert.equal(result.config.pricing['A/qwen-test:free'].input, 0);
	assert.equal(result.config.pricing['A/qwen-test:free'].source, 'openrouter.ai');
	assert.strictEqual(result.config.pricing['A/unknown'], previous);
	assert.deepEqual(result.report.unmatched, ['A/unknown']);
	assert.equal(input.pricing['A/qwen-test'].source, 'manual');
	assert.deepEqual(
		syncPrices(
			result.config,
			{
				data: [
					orModel('qwen/qwen-test'),
					orModel('qwen/qwen-test:free', { prompt: '0', completion: '0', input_cache_read: '0' }),
				],
			},
			openRouter,
		).config,
		result.config,
	);
});

test('namespace matching is exact first; versions, variants and ambiguous IDs are never guessed', () => {
	const input = config(
		Object.fromEntries(
			['A/foo', 'A/vendor/foo', 'A/foo-0902', 'A/free-only', 'A/model'].map((key) => [key, zeroRate()]),
		),
	);
	const result = syncPrices(
		input,
		{
			data: [
				orModel('vendor/foo'),
				orModel('other/foo'),
				orModel('vendor/free-only:free'),
				orModel('vendor/model:batch'),
			],
		},
		openRouter,
	);
	assert.deepEqual(result.report.updated, ['A/vendor/foo']);
	assert.deepEqual(result.report.ambiguous, ['A/foo']);
	assert.deepEqual(result.report.unmatched, ['A/foo-0902', 'A/free-only', 'A/model']);
	const di = syncPrices(
		config({ 'A/deepseek-v4.1-flash': zeroRate() }),
		[diModel('deepseek-ai/DeepSeek-V4.1-Flash')],
		deepInfra,
	);
	assert.equal(di.config.pricing['A/deepseek-v4.1-flash'].input, 0.2);
});

test('DeepInfra converts cents and cache multipliers with valid discounts, using standard service tier', () => {
	const entry = diModel('Qwen/Qwen-test', {
		rate_per_input_token_cached: 0.25,
		rate_per_input_token_cache_write: 1.25,
		discount: 0.5,
		discount_ends_at: null,
		rate_per_service_tier_priority: 1.5,
		rate_per_service_tier_flex: 0.8,
	});
	const result = syncPrices(config({ 'A/qwen-test': zeroRate() }, 'api.deepinfra.com'), [entry], deepInfra);
	assert.deepEqual(result.config.pricing['A/qwen-test'], {
		currency: 'USD',
		source: 'api.deepinfra.com',
		input: 0.1,
		output: 0.3,
		cacheRead: 0.025,
		cacheWrite: 0.125,
	});
	assert.equal(
		deepInfra.offer('qwen-test', [{ ...entry, pricing: { ...entry.pricing, discount_ends_at: 1 } }]).rate
			.input,
		0.2,
	);
	assert.equal(
		deepInfra.offer('qwen-test', [{ ...entry, pricing: { ...entry.pricing, discount: 1 } }]).rate.input,
		0,
	);
});

test('unknown cache-write TTLs preserve the write rate and are included in the sync report', () => {
	const previous = { ...zeroRate(), cacheWrite: 9 };
	const result = syncPrices(
		config({ 'A/test': previous }),
		[diModel('vendor/test', { rate_per_explicit_cache_write_token: { '5m': 1.25, '1h': 2 } })],
		deepInfra,
	);
	assert.equal(result.config.pricing['A/test'].input, 0.2);
	assert.equal(result.config.pricing['A/test'].cacheWrite, 9);
	assert.deepEqual(result.report.details, [
		{ route: 'A/test', reason: 'cacheWriteAmbiguous', fields: ['cacheWrite'] },
	]);
	const single = deepInfra.offer('test', [
		diModel('vendor/test', { rate_per_explicit_cache_write_token: { '5m': 1.25 } }),
	]);
	assert.equal(single.rate.cacheWrite, 0.25);
	const or = openRouter.offer('test', {
		data: [
			orModel('vendor/test', {
				prompt: '0.000002',
				completion: '0.000006',
				input_cache_write: '0.0000025',
				input_cache_write_1h: '0.000004',
			}),
		],
	});
	assert.equal(or.rate.cacheWrite, 2.5, 'OpenRouter publishes a defined default write price');
});

test('conditional, invalid and non-token prices preserve existing entries', () => {
	const previous = { ...zeroRate(), input: 9, source: 'manual' };
	const input = config(Object.fromEntries(['A/tier', 'A/null', 'A/huge'].map((key) => [key, previous])));
	const result = syncPrices(
		input,
		{
			data: [
				orModel('v/tier', {
					prompt: '1',
					completion: '1',
					overrides: [{ min_prompt_tokens: 100000, prompt: '2' }],
				}),
				orModel('v/null', { prompt: null, completion: '1' }),
				orModel('v/huge', { prompt: '1e308', completion: '1' }),
			],
		},
		openRouter,
	);
	assert.equal(result.report.updated.length, 0);
	for (const entry of Object.values(result.config.pricing)) assert.strictEqual(entry, previous);
	for (const entry of [
		diModel('v/a', { type: 'time' }),
		{ ...diModel('v/a'), deprecated: 1 },
		diModel('v/a', { discount: 2 }),
		diModel('v/a', { rate_per_input_token_cached: -1 }),
	])
		assert.equal(deepInfra.offer('a', [entry]).status, 'unsupported');
});

test('platform prices never become official peak prices or alter the configured peak switch', () => {
	for (const [adapter, catalog] of [
		[openRouter, { data: [orModel('deepseek/deepseek-flash')] }],
		[deepInfra, [diModel('deepseek-ai/DeepSeek-Flash')]],
	]) {
		const key = 'deepseek-official/deepseek-flash',
			previous = { ...zeroRate(), input: 9, autoOffPeak: true };
		const blocked = syncPrices(config({ [key]: previous }), catalog, adapter);
		assert.strictEqual(blocked.config.pricing[key], previous);
		assert.equal(blocked.report.details[0].reason, 'offPeakBasis');
		const fixed = syncPrices(config({ [key]: { ...previous, autoOffPeak: false } }), catalog, adapter);
		assert.equal(fixed.config.pricing[key].autoOffPeak, false);
		assert.equal(fixed.config.pricing[key].input, adapter === openRouter ? 2 : 0.2);
	}
});

test('source caches stay separate, initialization never fetches, and failed sync preserves cached data', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'cost-price-sources-'));
	try {
		const catalogs = {
			'models.dev': { p: { models: { test: { cost: { input: 1, output: 1 } } } } },
			'openrouter.ai': { data: [orModel('v/test')] },
			'api.deepinfra.com': [diModel('v/test')],
		};
		const calls = [];
		let fail = false,
			invalid = false;
		const service = createPriceService(directory, async (url) => {
			calls.push(url);
			if (fail) throw new Error('offline');
			const source = url.includes('models.dev')
				? 'models.dev'
				: url.includes('openrouter.ai')
					? 'openrouter.ai'
					: 'api.deepinfra.com';
			return jsonResponse(invalid ? {} : catalogs[source]);
		});
		const input = (source) => config({ 'A/test': zeroRate() }, source);
		for (const source of Object.keys(catalogs)) {
			assert.equal((await service.initialize(input(source))).config.pricing['A/test'].input, 0);
			assert.equal(calls.length, Object.keys(catalogs).indexOf(source));
			await service.prices(input(source));
			assert.deepEqual(JSON.parse(readFileSync(join(directory, `${source}.json`), 'utf8')), catalogs[source]);
		}
		const offline = createPriceService(directory, () => {
			throw new Error('Must not fetch');
		});
		for (const [source, price] of [
			['models.dev', 1],
			['openrouter.ai', 2],
			['api.deepinfra.com', 0.2],
		]) {
			const initialized = await offline.initialize(input(source));
			assert.equal(initialized.config.pricing['A/test'].input, price);
			assert.equal(initialized.config.pricing['A/test'].source, source);
		}
		const bytes = readFileSync(join(directory, 'openrouter.ai.json'), 'utf8');
		fail = true;
		await assert.rejects(service.prices(input('openrouter.ai')), /offline/);
		fail = false;
		invalid = true;
		await assert.rejects(service.prices(input('openrouter.ai')), /Invalid/);
		assert.equal(readFileSync(join(directory, 'openrouter.ai.json'), 'utf8'), bytes);
		assert.equal((await service.initialize(input('openrouter.ai'))).config.pricing['A/test'].input, 2);
		await assert.rejects(
			service.prices(input('https://untrusted.example'), 'https://untrusted.example'),
			/Unsupported/,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('new history models use the selected cache without changing existing prices', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'cost-source-history-'));
	try {
		writeFileSync(join(directory, 'openrouter.ai.json'), JSON.stringify({ data: [orModel('v/test')] }));
		let stored = config({ 'A/test': { ...zeroRate(), input: 9, source: 'manual' } }, 'openrouter.ai');
		const route = (provider) => ({
			type: 'assistant/message',
			data: { message: { source: { provider, model: 'test' } } },
		});
		const prices = createPriceService(directory, () => {
			throw new Error('Must not fetch');
		});
		const history = createHistoryModels(
			{
				listSessions: async () => [{ header: { id: 's' } }],
				readSession: async () => ({ events: [route('A'), route('B')] }),
			},
			{
				readConfig: () => stored,
				writeConfig: (value) => (stored = value),
				initializePrices: prices.initialize,
			},
		);
		await history.config();
		assert.equal(stored.pricing['A/test'].input, 9);
		assert.equal(stored.pricing['B/test'].input, 2);
		assert.equal(stored.pricing['B/test'].source, 'openrouter.ai');
		stored = { ...stored, priceSource: 'api.deepinfra.com' };
		await history.observe(route('C'));
		assert.equal(stored.pricing['C/test'].input, 0, 'never falls back to the OpenRouter cache');
		assert.equal(existsSync(join(directory, 'api.deepinfra.com.json')), false);
		assert.equal(stored.pricing['B/test'].input, 2);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('source selections are queued before sync and alone do not change local fees', async () => {
	const buckets = { uncachedInputTokens: 1000000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
	const accounting = { totals: buckets, byRoute: { 'A/test': buckets }, turns: {}, skippedTurns: 0 };
	let state = {
		revision: '0',
		models: ['A/test'],
		config: config({ 'A/test': { ...zeroRate(), input: 2, source: 'models.dev' } }),
	};
	const initialCost = buildCostView(accounting, state.config);
	const calls = [];
	const store = createConfigStore(async (url, options) => {
		if (!options) return jsonResponse(state);
		const body = JSON.parse(options.body);
		assert.equal(body.revision, state.revision);
		if (url.endsWith('/pricing/sync')) {
			calls.push(body.source);
			assert.equal(body.source, state.config.priceSource);
		} else state = { ...state, config: body.config };
		state = { ...state, revision: String(Number(state.revision) + 1) };
		return jsonResponse({ ...state, report: {} });
	});
	await store.load();
	await Promise.all([store.update({ priceSource: 'openrouter.ai' }), store.sync()]);
	assert.deepEqual(calls, ['openrouter.ai']);
	assert.deepEqual(buildCostView(accounting, state.config), initialCost);
	assert.equal(state.config.pricing['A/test'].source, 'models.dev');
});

test('a failed source selection cannot sync a different source from the one confirmed', async () => {
	let syncCalls = 0;
	const state = { revision: '0', models: [], config: config({}) };
	const store = createConfigStore(async (url, options) => {
		if (!options) return jsonResponse(state);
		if (url.endsWith('/pricing/sync')) syncCalls++;
		return jsonResponse({ error: 'Save failed' }, 503);
	});
	await store.load();
	const save = store.update({ priceSource: 'openrouter.ai' });
	const sync = store.sync('openrouter.ai');
	await assert.rejects(save, /Save failed/);
	await assert.rejects(sync, /Price source changed/);
	assert.equal(syncCalls, 0);
});
