import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	logAxisMax,
	logTicks,
	modelName,
	modelPoints,
	monthEnd,
	shortModelName,
	trendBarRange,
} from '../src/client/overview-charts.js';

test('a trend bar maps to the inclusive dates it stands for', () => {
	assert.deepEqual(
		trendBarRange({ key: '2026-10-08', fromKey: '2026-10-08', toKey: '2026-10-08', merged: 1 }),
		{ start: '2026-10-08', end: '2026-10-08' },
	);
	// A merged bar queries the whole span.
	assert.deepEqual(
		trendBarRange({ key: '2026-10-08', fromKey: '2026-10-08', toKey: '2026-10-18', merged: 11 }),
		{ start: '2026-10-08', end: '2026-10-18' },
	);
	// A month bar queries its first and last calendar day.
	assert.deepEqual(
		trendBarRange({ key: '2026-02', fromKey: '2026-02', toKey: '2026-02', merged: 1 }),
		{ start: '2026-02-01', end: '2026-02-28' },
	);
	assert.deepEqual(
		trendBarRange({ key: '2028-02', fromKey: '2028-02', toKey: '2028-02', merged: 1 }),
		{ start: '2028-02-01', end: '2028-02-29' },
	);
	assert.deepEqual(
		trendBarRange({ key: '2025-11', fromKey: '2025-11', toKey: '2026-02', merged: 4 }),
		{ start: '2025-11-01', end: '2026-02-28' },
	);
	assert.equal(monthEnd('2026-12'), '2026-12-31');
});

test('scatter points drop unpriced models and empty routes', () => {
	const tokens = { input: 1, output: 0, read: 0, write: 0 };
	const routes = [
		{ route: 'p/a', priced: true, micros: 2000000, totalTokens: 1000000, tokens, bucketMicros: tokens },
		{ route: 'p/b', priced: true, micros: 1000000, totalTokens: 1000000, tokens, bucketMicros: tokens },
		// Tokens without a rate cannot show a price, so they stay out of the plot.
		{ route: 'p/free', priced: false, micros: 0, totalTokens: 500000, tokens, bucketMicros: tokens },
		{ route: 'p/empty', priced: true, micros: 0, totalTokens: 0, tokens, bucketMicros: tokens },
	];
	const points = modelPoints(routes);
	assert.deepEqual(
		points.map((point) => point.route),
		['p/a', 'p/b'],
	);
	assert.equal(points[0].micros, 2000000);
	assert.equal(points[1].micros, 1000000);
	assert.equal(points[0].totalTokens, 1000000);
	assert.deepEqual(points[0].tokens, tokens);
});

test('bubble labels keep the distinctive tail of a long model name', () => {
	assert.equal(modelName('deepseek-official/deepseek-v4.1-flash-1017'), 'deepseek-v4.1-flash-1017');
	assert.equal(modelName('bare-model'), 'bare-model');
	assert.equal(shortModelName('com-aliyun/qwen3.8-max'), 'qwen3.8-max');
	assert.equal(shortModelName('p/short'), 'short');
	// Leading segments go first, so two variants stay distinguishable.
	assert.equal(shortModelName('p/deepseek-v4.1-flash-1017'), 'flash-1017');
	assert.equal(shortModelName('p/deepseek-v4.1-flash-0910'), 'flash-0910');
	assert.equal(shortModelName('p/deepseek-v4.1-pro'), 'v4.1-pro');
	// A name without separators falls back to a cut with an ellipsis.
	assert.equal(shortModelName('p/abcdefghijklmnopqrst', 14), 'abcdefghijklm…');
	assert.equal(shortModelName('p/abcdefghijklmnopqrst', 14).length, 14);
});

test('log axis ticks stay inside the span and never exceed seven', () => {
	assert.deepEqual(logTicks(1, 100), [1, 2, 5, 10, 20, 50, 100]);
	assert.deepEqual(logTicks(1, 1000), [1, 5, 10, 50, 100, 500, 1000]);
	// A wide span keeps one tick per decade.
	assert.deepEqual(logTicks(1, 1000000), [1, 10, 100, 1000, 10000, 100000, 1000000]);
	// Fractional spans keep clean numbers instead of rounding noise.
	assert.deepEqual(logTicks(0.03, 600), [0.1, 1, 10, 100]);
	assert.ok(logTicks(1.5, 150).length <= 7);
	assert.deepEqual(logTicks(0, 100), []);
	assert.deepEqual(logTicks(100, 100), []);
	assert.deepEqual(logTicks(100, 1), []);
});

test('a widened log axis ends on a 1-2-5 value', () => {
	assert.equal(logAxisMax(286.75), 500);
	assert.equal(logAxisMax(100), 100);
	assert.equal(logAxisMax(200.1), 500);
	// Float noise just above a tidy value still snaps to that value.
	assert.equal(logAxisMax(200.0000001), 200);
	assert.equal(logAxisMax(1357.5), 2000);
	assert.equal(logAxisMax(0.7), 1);
	assert.equal(logAxisMax(0.03), 0.05);
	assert.equal(logAxisMax(9.5), 10);
});
