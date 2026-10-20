import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_REFRESH_MINUTES, REFRESH_INTERVALS, normalizeRefreshMinutes } from '../src/refresh.js';
import { configInputSchema } from '../src/server/schemas.js';

test('only a selectable interval survives normalization', () => {
	assert.deepEqual(REFRESH_INTERVALS, [1, 3, 5, 10, 15, 30, 60]);
	assert.equal(DEFAULT_REFRESH_MINUTES, 5);
	for (const minutes of REFRESH_INTERVALS) assert.equal(normalizeRefreshMinutes(minutes), minutes);
	for (const minutes of [0, 2, 7, 61, -5, 'x', null, undefined, Number.NaN]) {
		assert.equal(normalizeRefreshMinutes(minutes), DEFAULT_REFRESH_MINUTES, String(minutes));
	}
	assert.equal(normalizeRefreshMinutes('15'), 15, 'a numeric string is coerced');
});

test('the config input schema accepts the refresh fields and rejects a wrong type', () => {
	const base = { cnyPerUsd: 7.2, showDockChip: true, showTurnChip: true, pricing: {} };
	const parsed = configInputSchema.parse({ ...base, autoRefreshCost: false, autoRefreshMinutes: 15 });
	assert.equal(parsed.autoRefreshCost, false);
	assert.equal(parsed.autoRefreshMinutes, 15);
	assert.equal(configInputSchema.safeParse(base).success, true, 'both fields stay optional');
	assert.equal(configInputSchema.safeParse({ ...base, autoRefreshMinutes: '5' }).success, false);
	assert.equal(configInputSchema.safeParse({ ...base, autoRefreshCost: 'yes' }).success, false);
});

test('an older config file gains the default refresh fields', async () => {
	const home = mkdtempSync(join(tmpdir(), 'gdcc-home-'));
	const dir = join(home, 'guojinpeng', 'dsh-cost-meter');
	mkdirSync(dir, { recursive: true });
	const path = join(dir, 'config.json');
	writeFileSync(
		path,
		JSON.stringify({ formatVersion: 2, cnyPerUsd: 7.5, showDockChip: true, showTurnChip: true, pricing: {} }),
		'utf8',
	);
	process.env.DSH_HOME = home;
	// The module resolves its path at import time, so set the home first.
	const { readConfig } = await import('../src/server/config-store.js');
	const config = readConfig(true);
	assert.equal(config.autoRefreshCost, true, 'the timer is on by default');
	assert.equal(config.autoRefreshMinutes, DEFAULT_REFRESH_MINUTES);
	assert.equal(config.cnyPerUsd, 7.5);

	writeFileSync(
		path,
		JSON.stringify({
			formatVersion: 2,
			showDockChip: true,
			showTurnChip: true,
			autoRefreshCost: false,
			autoRefreshMinutes: 7,
			pricing: {},
		}),
		'utf8',
	);
	const next = readConfig(true);
	assert.equal(next.autoRefreshCost, false);
	assert.equal(next.autoRefreshMinutes, DEFAULT_REFRESH_MINUTES, 'an unknown interval falls back');
});
