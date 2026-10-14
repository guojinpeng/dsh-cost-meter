import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfigStore } from '../src/client/config-store.js';
import { zeroRate } from '../src/pricing.js';

const initial = () => ({
	revision: '0',
	models: ['p/a'],
	config: {
		currency: 'CNY',
		cnyPerUsd: 7,
		showDockChip: true,
		showTurnChip: true,
		pricing: { 'p/a': zeroRate() },
	},
});
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });

test('queued edits and sync use consecutive revisions and preserve unrelated fields', async () => {
	let state = initial();
	const seen = [];
	const store = createConfigStore(async (url, options) => {
		if (!options) return response(state);
		const body = JSON.parse(options.body);
		assert.equal(body.revision, state.revision);
		seen.push(url.endsWith('/pricing/sync') ? 'sync' : body.config.pricing['p/a'].input);
		state = { ...state, revision: String(Number(state.revision) + 1), config: body.config ?? state.config };
		return response(url.endsWith('/pricing/sync') ? { ...state, report: {} } : state);
	});
	await store.load();
	await Promise.all([
		store.update({ pricing: { 'p/a': { input: 2 } } }),
		store.update({ showDockChip: false }),
		store.sync(),
		store.update({ pricing: { 'p/a': { output: 3 } } }),
	]);
	assert.deepEqual(seen, [2, 2, 'sync', 2]);
	assert.equal(state.config.showDockChip, false);
	assert.equal(state.config.pricing['p/a'].output, 3);
});

test('a GET started during a write cannot replace its committed prices', async () => {
	let completeWrite,
		completeGet,
		first = true;
	let started;
	const writing = new Promise((resolve) => {
		started = resolve;
	});
	const state = initial();
	const store = createConfigStore((url, options) => {
		if (options)
			return new Promise((resolve) => {
				completeWrite = () =>
					resolve(response({ ...state, revision: '1', config: JSON.parse(options.body).config }));
				started();
			});
		if (first) {
			first = false;
			return Promise.resolve(response(state));
		}
		return new Promise((resolve) => {
			completeGet = () => resolve(response(state));
		});
	});
	await store.load();
	const write = store.update({ pricing: { 'p/a': { input: 4 } } });
	await writing;
	const get = store.load();
	completeWrite();
	await write;
	completeGet();
	await get;
	assert.equal(store.getSnapshot().config.pricing['p/a'].input, 4);
});

test('revision conflict merges other fields but rejects a conflicting price', async () => {
	for (const conflict of [false, true]) {
		let state = initial(),
			writes = 0;
		const store = createConfigStore(async (url, options) => {
			if (!options) return response(state);
			writes++;
			if (writes === 1) {
				state = {
					...state,
					revision: '1',
					config: {
						...state.config,
						showTurnChip: false,
						pricing: { 'p/a': { ...zeroRate(), input: conflict ? 9 : 0 } },
					},
				};
				return response({ error: 'conflict' }, 409);
			}
			state = { ...state, revision: '2', config: JSON.parse(options.body).config };
			return response(state);
		});
		await store.load();
		const write = store.update({ pricing: { 'p/a': { input: 4 } } });
		if (conflict) {
			await assert.rejects(write, /conflict/);
			assert.equal(state.config.pricing['p/a'].input, 9);
		} else {
			await write;
			assert.equal(state.config.pricing['p/a'].input, 4);
		}
		assert.equal(state.config.showTurnChip, false);
	}
});
