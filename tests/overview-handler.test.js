import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOverviewCache } from '../src/server/overview-cache.js';
import { createOverviewHandler } from '../src/server/overview.js';

/** Minimal HTTP stand-ins: only what the handler reads and writes. */
function harness(cache) {
	const logs = {
		locate: () => new Map(),
		stampOf: () => null,
		fold: () => null,
		titleOf: () => undefined,
	};
	const connection = { requestRejection: () => undefined };
	const sessionQuery = { listSessions: async () => [] };
	const handler = createOverviewHandler(connection, sessionQuery, undefined, () => undefined, logs, cache);
	const call = async (url) => {
		let head = null;
		let body = '';
		const res = {
			writeHead: (status, headers) => {
				head = { status, headers };
			},
			end: (text) => {
				body = text;
			},
		};
		await handler({ url, method: 'GET', headers: {} }, res);
		return { status: head.status, body: JSON.parse(body) };
	};
	return { call };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('repeat requests reuse the cached payload and refresh recomputes it', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gdcc-handler-'));
	const { call } = harness(createOverviewCache(dir));
	const first = await call('/overview?days=30');
	assert.equal(first.status, 200);
	await wait(5);
	const second = await call('/overview?days=30');
	assert.equal(second.body.generatedAt, first.body.generatedAt);
	// The page shows a cache badge only when the payload came from the cache.
	assert.equal(first.body.cached, undefined);
	assert.equal(second.body.cached, true);
	await wait(5);
	const forced = await call('/overview?days=30&refresh=1');
	assert.equal(forced.status, 200);
	assert.notEqual(forced.body.generatedAt, first.body.generatedAt);
	assert.equal(forced.body.cached, undefined);
	// The refreshed payload replaces the cached one.
	const third = await call('/overview?days=30');
	assert.equal(third.body.generatedAt, forced.body.generatedAt);
	assert.deepEqual(readdirSync(dir), ['30-day-statistics.json']);
});

test('prototype keys and a custom range without dates are rejected', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gdcc-handler-'));
	const { call } = harness(createOverviewCache(dir));
	for (const url of ['/overview?days=toString', '/overview?days=__proto__', '/overview?days=custom']) {
		const result = await call(url);
		assert.equal(result.status, 400, url);
	}
});

test('a custom range is never cached and an inverted range is rejected', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gdcc-handler-'));
	const { call } = harness(createOverviewCache(dir));
	const custom = await call('/overview?start=2026-10-01&end=2026-10-03');
	assert.equal(custom.status, 200);
	assert.equal(custom.body.range, 'custom');
	assert.equal(custom.body.start, '2026-10-01');
	assert.equal(custom.body.end, '2026-10-03');
	assert.equal(custom.body.days, 3);
	assert.deepEqual(readdirSync(dir), []);
	const inverted = await call('/overview?start=2026-10-05&end=2026-10-01');
	assert.equal(inverted.status, 400);
	const bogus = await call('/overview?start=2026-10-05&end=2026-02-31');
	assert.equal(bogus.status, 400);
	const badRange = await call('/overview?days=1');
	assert.equal(badRange.status, 400);
});
