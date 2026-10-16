import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timeBucket, pricePeriod, isDeepSeekRoute } from '../src/time-of-use.js';
import { createHolidayStore } from '../src/server/holiday-store.js';
import { buildCostView, convertRateCurrency, normalizeRate, zeroRate } from '../src/pricing.js';
import { syncModelsDev } from '../src/models-dev.js';

const bucket = (input = 1000000) => ({
	uncachedInputTokens: input,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
});
const time = (local) => Date.parse(`${local}+08:00`);
const calendars = { 2026: ['2026-10-01', '2026-10-02'] };

test('Beijing peak windows have precise inclusive starts and exclusive ends', () => {
	for (const [clock, expected] of [
		['08:59:59', 'offPeak'],
		['09:00:00', 'peak'],
		['11:59:59', 'peak'],
		['12:00:00', 'offPeak'],
		['13:59:59', 'offPeak'],
		['14:00:00', 'peak'],
		['17:59:59', 'peak'],
		['18:00:00', 'offPeak'],
	])
		assert.equal(pricePeriod(timeBucket(time(`2026-10-14T${clock}`)), 'deepseek', calendars), expected, clock);
	assert.equal(timeBucket(Date.parse('2026-12-31T16:00:00Z')), '2027-01-01/night');
});

test('holiday weekdays and working weekends are off-peak; missing calendars remain uncertain', () => {
	assert.equal(pricePeriod(timeBucket(time('2026-10-01T10:00:00')), 'deepseek', calendars), 'offPeak');
	assert.equal(pricePeriod(timeBucket(time('2026-10-10T10:00:00')), 'deepseek', calendars), 'offPeak');
	assert.equal(pricePeriod(timeBucket(time('2026-10-14T10:00:00')), 'deepseek'), 'unknown');
	assert.equal(pricePeriod(timeBucket(time('2026-10-14T20:00:00')), 'deepseek'), 'offPeak');
	assert.equal(pricePeriod(timeBucket(undefined), 'deepseek', calendars), 'unknown');
	assert.equal(isDeepSeekRoute('deepseek-official/deepseek-flash'), true);
	assert.equal(isDeepSeekRoute('com-aliyun/deepseek-flash'), false);
});

test('holiday-cn calendars cache only holiday/weekend dates and reuse offline', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'cost-calendar-'));
	let calls = 0;
	try {
		const service = createHolidayStore(directory, async () => {
			calls++;
			return {
				ok: true,
				json: async () => ({
					year: 2026,
					papers: ['https://www.gov.cn/example'],
					days: [
						{ date: '2026-10-01', isOffDay: true },
						{ date: '2026-10-10', isOffDay: false },
					],
				}),
			};
		});
		await Promise.all([service.ensure(2026), service.ensure(2026)]);
		assert.equal(calls, 1);
		const data = JSON.parse(readFileSync(join(directory, '2026.json'), 'utf8'));
		assert.ok(data.dates.includes('2026-10-01'));
		assert.ok(data.dates.includes('2026-10-10'), 'working Saturdays remain off-peak');
		assert.equal(data.dates.includes('2026-10-14'), false);
		assert.equal(data.days, undefined);
		const offline = createHolidayStore(directory, async () => {
			throw new Error('Must not fetch');
		});
		await offline.ensure(2026);
		assert.deepEqual(offline.snapshot(), service.snapshot());
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('calendar failures never cache an empty complete year or block retries after restart', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'cost-calendar-fail-'));
	let errors = 0;
	try {
		const invalid = createHolidayStore(
			directory,
			async () => ({ ok: true, json: async () => ({ year: 2027, days: [] }) }),
			() => errors++,
		);
		await invalid.ensure(2027);
		assert.equal(errors, 1);
		assert.equal(existsSync(join(directory, '2027.json')), false);
		assert.deepEqual(invalid.pending(), []);
		assert.deepEqual(invalid.snapshot(), {});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('native model currencies convert once and remain separate in mixed totals', () => {
	const usd = { ...zeroRate(), input: 2, currency: 'USD' };
	const cny = convertRateCurrency(usd, 'CNY', 7);
	assert.equal(cny.input, 14);
	assert.deepEqual(convertRateCurrency(cny, 'USD', 7), usd);
	assert.deepEqual(convertRateCurrency(cny, 'CNY', 7), cny);
	const accounting = {
		totals: bucket(2000000),
		byRoute: { 'a/m': bucket(), 'b/m': bucket() },
		turns: {},
		skippedTurns: 0,
	};
	const view = buildCostView(accounting, {
		currency: 'CNY',
		cnyPerUsd: 7,
		pricing: { 'a/m': usd, 'b/m': cny },
	});
	assert.deepEqual(
		view.amounts.map(({ currency, micros }) => ({ currency, micros })),
		[
			{ currency: 'CNY', micros: 14000000 },
			{ currency: 'USD', micros: 2000000 },
		],
	);
	assert.equal(view.totalMicros, 4000000);
	assert.equal(normalizeRate({ ...cny, autoOffPeak: true }).autoOffPeak, true);
	assert.equal(normalizeRate({ ...cny, peakRule: 'glm' }).peakRule, 'glm');
	assert.equal(normalizeRate({ ...cny, peakRule: 'nope' }).peakRule, undefined);
});

test('DeepSeek source off-peak prices become peak prices before currency conversion, without compounding', () => {
	const catalog = {
		deepseek: { models: { 'deepseek-flash': { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } } } },
	};
	const config = {
		cnyPerUsd: 7,
		pricing: {
			'deepseek-official/deepseek-flash': { ...zeroRate(), currency: 'CNY' },
			'deepseek-account/deepseek-flash': { ...zeroRate(), currency: 'USD', autoOffPeak: false },
		},
	};
	const first = syncModelsDev(config, catalog).config;
	assert.equal(first.pricing['deepseek-official/deepseek-flash'].input, 2.1);
	assert.equal(first.pricing['deepseek-official/deepseek-flash'].autoOffPeak, undefined);
	assert.equal(first.pricing['deepseek-account/deepseek-flash'].autoOffPeak, false);
	assert.deepEqual(syncModelsDev(first, catalog).config, first);
});

test('dated peak/off-peak buckets reprice when the calendar arrives; legacy entries stay fixed', () => {
	const key = 'deepseek-official/deepseek-flash';
	const accounting = {
		totals: bucket(2000000),
		byRoute: { [key]: bucket(2000000) },
		byTime: {
			[key]: { '2026-10-01/am': bucket(), '2026-10-14/am': bucket() },
		},
		turns: {},
		skippedTurns: 0,
	};
	const config = { cnyPerUsd: 7, pricing: { [key]: { ...zeroRate(), input: 2, autoOffPeak: true } } };
	assert.equal(buildCostView(accounting, config).totalMicros, 4000000);
	const resolved = buildCostView({ ...accounting, calendars }, config);
	assert.equal(resolved.totalMicros, 3000000);
	assert.equal(resolved.peakTokens, 1000000);
	assert.equal(resolved.offPeakTokens, 1000000);
	const route = resolved.routes[0];
	assert.equal(route.periodMicros.peak.input, 2000000);
	assert.equal(route.periodMicros.offPeak.input, 1000000);
	assert.equal(route.periodMicros.unknown.input, 0);
	assert.equal(route.tokensByPeriod.peak.input, 1000000);
	assert.equal(route.tokensByPeriod.offPeak.input, 1000000);
	assert.deepEqual(route.rates, { input: 2, output: 0, read: 0, write: 0, factor: 0.5, rule: 'deepseek' });
	assert.equal(resolved.amounts[0].periodMicros.peak.input, 2000000);
	assert.equal(resolved.amounts[0].periodMicros.offPeak.input, 1000000);
	delete config.pricing[key].autoOffPeak;
	const legacy = buildCostView({ ...accounting, calendars }, config);
	assert.equal(legacy.totalMicros, 4000000);
	assert.equal(legacy.routes[0].periodMicros.fixed.input, 4000000);
	assert.equal(legacy.routes[0].tokensByPeriod.fixed.input, 2000000);
	assert.equal(legacy.routes[0].periodMicros.peak.input, 0);
});

test('the off-peak flag applies to any provider under its selected rule', () => {
	const key = 'com-aliyun/deepseek-flash';
	const accounting = {
		totals: bucket(),
		byRoute: { [key]: bucket() },
		byTime: {
			[key]: { '2026-10-01/am': bucket() },
		},
		calendars,
		turns: {},
		skippedTurns: 0,
	};
	const view = buildCostView(accounting, {
		cnyPerUsd: 7,
		pricing: { [key]: { ...zeroRate(), input: 2, autoOffPeak: true } },
	});
	assert.equal(view.totalMicros, 1000000);
	assert.equal(view.offPeakTokens, 1000000);
});

test('each model prices its own clock windows with its own rule', () => {
	const key = 'com-aliyun/deepseek-flash';
	const accounting = {
		totals: bucket(2000000),
		byRoute: { [key]: bucket(2000000) },
		byTime: { [key]: { '2026-10-14/am': bucket(), '2026-10-14/late': bucket() } },
		calendars,
		turns: {},
		skippedTurns: 0,
	};
	const rate = (peakRule) => ({ ...zeroRate(), input: 2, autoOffPeak: true, peakRule });
	const priced = (peakRule) =>
		buildCostView(accounting, { cnyPerUsd: 7, pricing: { [key]: rate(peakRule) } });
	// DeepSeek: 10:00 weekday peak, 23:00 off-peak.
	assert.equal(priced('deepseek').totalMicros, 3000000);
	// Alibaba Cloud: 10:00 busy, 23:00 off-peak.
	const aliyun = priced('aliyun');
	assert.equal(aliyun.totalMicros, 3000000);
	assert.equal(aliyun.peakTokens, 1000000);
	assert.equal(aliyun.routes[0].periodMicros.peak.input, 2000000);
	assert.equal(aliyun.routes[0].periodMicros.offPeak.input, 1000000);
	assert.equal(aliyun.routes[0].tokensByPeriod.peak.input, 1000000);
	assert.equal(aliyun.routes[0].rates.rule, 'aliyun');
	// Zhipu GLM: only 14:00-18:00 is peak, so both windows are off-peak.
	const glm = priced('glm');
	assert.equal(glm.totalMicros, 2000000);
	assert.equal(glm.offPeakTokens, 2000000);
	assert.equal(glm.routes[0].periodMicros.offPeak.input, 2000000);
	assert.equal(glm.routes[0].periodMicros.peak.input, 0);
	assert.equal(glm.routes[0].rates.rule, 'glm');
});

test('an unknown rule falls back to DeepSeek; a malformed bucket stays uncertain', () => {
	assert.equal(pricePeriod('2026-10-14/late', 'nope', calendars), 'offPeak');
	assert.equal(pricePeriod('2026-10-14/lunch', 'deepseek', calendars), 'unknown');
	assert.equal(pricePeriod('unknown', 'deepseek', calendars), 'unknown');
});