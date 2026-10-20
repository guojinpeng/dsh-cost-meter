import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	RANGE_DAYS,
	addRangeState,
	beijingDate,
	buildTimeOfDay,
	buildTrend,
	emptyAccounting,
	inRange,
	mergeTrend,
	rangeDays,
	rangeStart,
	routeRows,
	sessionRows,
	shiftDate,
	totalsOf,
} from '../src/server/overview-data.js';
import { buildOverview } from '../src/server/overview.js';

/** A usage bucket with one million uncached input tokens by default. */
const bucket = (input = 1000000, output = 0) => ({
	uncachedInputTokens: input,
	outputTokens: output,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
});

/** One projection state with the given byTime buckets. */
const stateOf = (byTime, skippedTurns = 0) => ({
	totals: bucket(),
	byRoute: {},
	byTime,
	turns: {},
	skippedTurns,
});

const rate = (input) => ({
	input,
	output: input,
	cacheRead: input / 10,
	cacheWrite: input,
	currency: 'USD',
});
const config = { cnyPerUsd: 7.2, currency: 'USD', pricing: { 'p/a': rate(1) } };

test('Beijing dates and range starts ignore the local clock', () => {
	// 2026-10-19T13:00Z is 2026-10-19 21:00 in Beijing; 16:00Z already rolls over.
	assert.equal(beijingDate(Date.parse('2026-10-19T13:00:00Z')), '2026-10-19');
	assert.equal(beijingDate(Date.parse('2026-10-19T16:00:00Z')), '2026-10-20');
	assert.equal(shiftDate('2026-10-19', -1), '2026-10-18');
	assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
	const now = Date.parse('2026-10-19T05:00:00Z');
	assert.equal(rangeStart('today', now), '2026-10-19');
	assert.equal(rangeStart('7', now), '2026-10-13');
	assert.equal(rangeStart('30', now), '2026-09-20');
	assert.equal(rangeStart('90', now), '2026-07-22');
	assert.equal(rangeStart('all', now), null);
	assert.equal(rangeStart('bogus', now), undefined);
	assert.equal(rangeDays('today'), 1);
	assert.equal(rangeDays('all'), null);
	assert.equal(RANGE_DAYS.today, 1);
	assert.equal(RANGE_DAYS['7'], 7);
	assert.equal(RANGE_DAYS['30'], 30);
	assert.equal(RANGE_DAYS['90'], 90);
	assert.equal(RANGE_DAYS.all, 0);
});

test('range filtering keeps in-range dates and every unknown timestamp', () => {
	assert.equal(inRange('2026-10-19/am', '2026-10-13'), true);
	assert.equal(inRange('2026-10-12/pm', '2026-10-13'), false);
	assert.equal(inRange('unknown', '2026-10-13'), true);
	assert.equal(inRange('unknown', null), true);
	assert.equal(inRange('2020-01-01/night', null), true);
	const target = emptyAccounting();
	addRangeState(
		target,
		stateOf({
			'p/a': {
				'2026-10-19/am': bucket(100),
				'2026-10-12/am': bucket(200),
				unknown: bucket(300),
			},
		}),
		'2026-10-13',
	);
	assert.equal(target.byTime['p/a']['2026-10-19/am'].uncachedInputTokens, 100);
	assert.equal(target.byTime['p/a']['2026-10-12/am'], undefined);
	assert.equal(target.byTime['p/a'].unknown.uncachedInputTokens, 300);
});

test('range states merge buckets of the same key instead of replacing them', () => {
	const target = emptyAccounting();
	addRangeState(target, stateOf({ 'p/a': { '2026-10-19/am': bucket(100, 10) } }), null);
	addRangeState(target, stateOf({ 'p/a': { '2026-10-19/am': bucket(200, 20) } }), null);
	assert.deepEqual(target.byTime['p/a']['2026-10-19/am'], {
		uncachedInputTokens: 300,
		outputTokens: 30,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	});
});

test('totalsOf derives per-route buckets and drops empty routes', () => {
	const accounting = addRangeState(
		emptyAccounting(),
		stateOf({
			'p/a': { '2026-10-19/am': bucket(100, 10) },
			'p/empty': { '2026-10-19/am': bucket(0, 0) },
		}),
		null,
	);
	totalsOf(accounting);
	assert.equal(accounting.totals.uncachedInputTokens, 100);
	assert.equal(accounting.totals.outputTokens, 10);
	assert.deepEqual(Object.keys(accounting.byRoute), ['p/a']);
});

test('the trend aggregates by day and by month with priced money per token kind', () => {
	const accounting = addRangeState(
		emptyAccounting(),
		stateOf({
			'p/a': {
				'2026-09-30/noon': bucket(1000000),
				'2026-10-01/am': bucket(2000000),
				'2026-10-19/pm': bucket(3000000),
				unknown: bucket(4000000),
			},
		}),
		null,
	);
	const days = buildTrend(accounting, config, 'day');
	assert.deepEqual(
		days.map((unit) => unit.key),
		['2026-09-30', '2026-10-01', '2026-10-19'],
	);
	assert.equal(days[0].totalMicros, 1000000);
	assert.equal(days[0].bucketMicros.input, 1000000);
	assert.equal(days[2].totalTokens, 3000000);
	const months = buildTrend(accounting, config, 'month');
	assert.deepEqual(
		months.map((unit) => unit.key),
		['2026-09', '2026-10'],
	);
	assert.equal(months[1].totalMicros, 5000000);
	assert.equal(months[1].totalTokens, 5000000);
});

test('the clock-window breakdown keeps the projection segment order', () => {
	const accounting = addRangeState(
		emptyAccounting(),
		stateOf({
			'p/a': {
				'2026-10-19/night': bucket(1000000),
				'2026-10-19/pm': bucket(2000000),
				'2026-10-18/pm': bucket(4000000),
				unknown: bucket(8000000),
			},
		}),
		null,
	);
	const rows = buildTimeOfDay(accounting, config);
	assert.deepEqual(
		rows.map((row) => row.segment),
		['night', 'morning', 'am', 'noon', 'pm', 'evening', 'late'],
	);
	assert.equal(rows[0].totalMicros, 1000000);
	assert.equal(rows[4].totalMicros, 6000000);
	assert.equal(rows[2].totalTokens, 0);
});

test('session rows sort by money and drop sessions without ranged usage', () => {
	const entries = [
		{ header: { id: 'a', createdAt: 3, parentSession: null }, state: stateOf({ 'p/a': { '2026-10-19/am': bucket(1000000) } }) },
		{ header: { id: 'b', createdAt: 2 }, state: stateOf({ 'p/a': { '2026-10-19/pm': bucket(2000000) } }) },
		{ header: { id: 'c', createdAt: 1 }, state: stateOf({ 'p/a': { '2026-10-01/am': bucket(9000000) } }) },
	];
	const rows = sessionRows(entries, config, '2026-10-13');
	assert.deepEqual(
		rows.map((row) => row.id),
		['b', 'a'],
	);
	assert.equal(rows[0].totalMicros, 2000000);
	assert.equal(rows[0].tokens.input, 2000000);
	assert.deepEqual(rows[0].routes, ['p/a']);
	assert.equal(rows[1].parentSession, null);
});

test('route rows price each model alone and keep its price blocks', () => {
	const accounting = addRangeState(
		emptyAccounting(),
		stateOf({
			'p/a': { '2026-10-19/am': bucket(1000000, 100) },
			'p/b': { '2026-10-19/pm': bucket(2000000, 200) },
		}),
		null,
	);
	const rows = routeRows(accounting, { ...config, pricing: { 'p/a': rate(1), 'p/b': rate(1) } });
	assert.deepEqual(
		rows.map((row) => row.route),
		['p/b', 'p/a'],
	);
	assert.equal(rows[0].totalTokens, 2000200);
	assert.equal(rows[0].tokens.input, 2000000);
	assert.equal(rows[0].tokens.output, 200);
	assert.equal(rows[1].bucketMicros.input, 1000000);
	// Each series is rounded on its own, so the sum can differ by a few micros.
	const sum = rows[0].bucketMicros.input + rows[0].bucketMicros.output + rows[0].bucketMicros.read + rows[0].bucketMicros.write;
	assert.ok(Math.abs(sum - rows[0].micros) <= 4);
});

test('the overview payload reports counts, granularity, and titles', () => {
	const entries = [
		{ header: { id: 'a', createdAt: 1 }, state: stateOf({ 'p/a': { '2026-10-19/am': bucket(1000000) } }) },
		{ header: { id: 'b', createdAt: 2 }, state: stateOf({ 'p/a': { '2026-10-01/pm': bucket(2000000) } }) },
	];
	const day = buildOverview({
		entries,
		config,
		range: '7',
		now: Date.parse('2026-10-19T05:00:00Z'),
		titles: new Map([['a', 'First session']]),
	});
	assert.equal(day.range, '7');
	assert.equal(day.days, 7);
	assert.equal(day.granularity, 'day');
	assert.equal(day.currency, 'USD');
	assert.equal(day.cnyPerUsd, 7.2);
	assert.equal(day.counts.sessions, 2);
	assert.equal(day.counts.activeSessions, 1);
	assert.equal(day.counts.pricedRoutes, 1);
	assert.deepEqual(
		day.sessions.map((row) => [row.id, row.title]),
		[['a', 'First session']],
	);
	assert.deepEqual(
		day.trend.map((unit) => unit.key),
		['2026-10-19'],
	);
	const all = buildOverview({ entries, config, range: 'all', now: Date.parse('2026-10-19T05:00:00Z') });
	assert.equal(all.granularity, 'day');
	assert.equal(all.days, 2);
	assert.equal(all.sessions.length, 2);
	assert.equal(all.sessions[0].title, null);

	const manyDays = {};
	for (let index = 0; index < 61; index += 1) manyDays[shiftDate('2026-09-01', index) + '/am'] = bucket(100);
	const months = buildOverview({
		entries: [{ header: { id: 'a', createdAt: 1 }, state: stateOf({ 'p/a': manyDays }) }],
		config,
		range: 'all',
		now: Date.parse('2026-12-31T05:00:00Z'),
	});
	assert.equal(months.granularity, 'month');
	assert.deepEqual(
		months.trend.map((unit) => unit.key),
		['2026-09', '2026-10'],
	);
});

test('an empty history still answers a complete payload', () => {
	const payload = buildOverview({ entries: [], config, range: '30', now: Date.parse('2026-10-19T05:00:00Z') });
	assert.equal(payload.view.totalTokens, 0);
	assert.equal(payload.view.totalMicros, 0);
	assert.equal(payload.view.cacheHitPct, null);
	assert.equal(payload.days, 30);
	assert.deepEqual(payload.trend, []);
	assert.equal(payload.timeOfDay.length, 7);
	assert.deepEqual(payload.sessions, []);
});
test('a custom range counts only its two dates', () => {
	const entries = [
		{
			header: { id: 'a', createdAt: 1 },
			state: stateOf({
				'p/a': {
					'2026-10-01/am': bucket(100),
					'2026-10-10/am': bucket(200),
					'2026-10-20/am': bucket(300),
				},
			}),
		},
	];
	const payload = buildOverview({
		entries,
		config,
		range: 'custom',
		start: '2026-10-02',
		end: '2026-10-10',
		now: Date.parse('2026-10-19T05:00:00Z'),
	});
	assert.equal(payload.range, 'custom');
	assert.equal(payload.start, '2026-10-02');
	assert.equal(payload.end, '2026-10-10');
	assert.equal(payload.days, 9);
	assert.deepEqual(
		payload.trend.map((unit) => unit.key),
		['2026-10-10'],
	);
});

test('route rows keep every model beyond the eight wire routes', () => {
	const byTime = {};
	const pricing = {};
	for (let index = 0; index < 10; index += 1) {
		const key = `p/m${index}`;
		byTime[key] = { '2026-10-19/am': bucket((index + 1) * 100000) };
		pricing[key] = rate(1);
	}
	const accounting = addRangeState(emptyAccounting(), stateOf(byTime), null);
	const rows = routeRows(accounting, { ...config, pricing });
	assert.equal(rows.length, 10);
	assert.deepEqual(
		rows.map((row) => row.route),
		Array.from({ length: 10 }, (_, index) => `p/m${9 - index}`),
	);
	assert.equal(rows[0].totalTokens, 1000000);
});

test('the overview prices DeepSeek windows from the holiday calendar', () => {
	const priced = {
		cnyPerUsd: 7.2,
		currency: 'USD',
		pricing: { 'p/a': { ...rate(1), autoOffPeak: true, peakRule: 'deepseek' } },
	};
	const entries = [
		{ header: { id: 'a', createdAt: 1 }, state: stateOf({ 'p/a': { '2026-10-01/am': bucket(1000000) } }) },
	];
	const options = {
		entries,
		config: priced,
		range: 'custom',
		start: '2026-10-01',
		end: '2026-10-01',
		now: Date.parse('2026-10-19T05:00:00Z'),
	};
	const unknown = buildOverview(options);
	assert.equal(unknown.view.totalMicros, 1000000);
	assert.equal(unknown.view.uncertainTokens, 1000000);
	const holidays = buildOverview({ ...options, calendars: { 2026: ['2026-10-01'] } });
	assert.equal(holidays.view.totalMicros, 500000);
	assert.equal(holidays.view.offPeakTokens, 1000000);
	assert.equal(holidays.view.uncertainTokens, 0);
});

test('trend bars merge above twenty units and name their span', () => {
	const units = Array.from({ length: 90 }, (_, index) => ({
		key: shiftDate('2026-07-22', index),
		totalMicros: 10,
		totalTokens: 4,
		tokens: { input: 1, output: 1, read: 1, write: 1 },
		bucketMicros: { input: 1, output: 1, read: 1, write: 1 },
	}));
	const bars = mergeTrend(units);
	assert.equal(bars.length, 18);
	assert.equal(bars[0].fromKey, '2026-07-22');
	assert.equal(bars[0].toKey, '2026-07-26');
	assert.equal(bars[0].merged, 5);
	assert.equal(bars[0].totalMicros, 50);
	assert.equal(bars[0].tokens.input, 5);
	assert.equal(bars[bars.length - 1].toKey, '2026-10-19');
	const short = mergeTrend(units.slice(0, 20));
	assert.equal(short.length, 20);
	assert.equal(short[0].merged, 1);
	assert.equal(short[0].fromKey, '2026-07-22');
});
