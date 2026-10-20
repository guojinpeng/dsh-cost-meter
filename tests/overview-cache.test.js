import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CACHE_TTL_MS, createOverviewCache } from '../src/server/overview-cache.js';

test('the overview cache keeps one file per range within the fifteen minute window', () => {
	assert.equal(CACHE_TTL_MS, 15 * 60 * 1000);
	const dir = mkdtempSync(join(tmpdir(), 'gdcc-cache-'));
	const now = Date.now();
	const cache = createOverviewCache(dir, { now: () => now });
	assert.equal(cache.pathOf('30'), join(dir, '30-day-statistics.json'));
	assert.equal(cache.read('30', 'stamp-a'), null);
	assert.equal(cache.write('30', 'stamp-a', { range: '30', generatedAt: 1 }), true);
	assert.equal(cache.write('7', 'stamp-a', { range: '7', generatedAt: 2 }), true);
	assert.deepEqual(cache.read('30', 'stamp-a'), { range: '30', generatedAt: 1 });
	assert.deepEqual(cache.read('7', 'stamp-a'), { range: '7', generatedAt: 2 });
	// A price or exchange rate change invalidates the payload.
	assert.equal(cache.read('30', 'stamp-b'), null);
	assert.deepEqual(readdirSync(dir).sort(), ['30-day-statistics.json', '7-day-statistics.json']);
	// The file modification time is the age of the payload.
	const old = new Date(now - CACHE_TTL_MS - 1000);
	utimesSync(cache.pathOf('30'), old, old);
	assert.equal(cache.read('30', 'stamp-a'), null);
});

test('the overview cache never throws on a missing or broken file', () => {
	const dir = mkdtempSync(join(tmpdir(), 'gdcc-cache-'));
	const cache = createOverviewCache(dir);
	assert.equal(cache.read('90', ''), null);
	const broken = cache.pathOf('90');
	writeFileSync(broken, 'not json', 'utf8');
	assert.equal(cache.read('90', ''), null);
});
