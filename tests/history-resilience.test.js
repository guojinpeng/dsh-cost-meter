import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryModels } from '../src/history.js';

/** A minimal configuration the history service can reconcile and write. */
function makeConfig() {
	let config = { currency: 'CNY', cnyPerUsd: 7, showSidebarCost: true, formatVersion: 2, pricing: {} };
	return {
		readConfig: () => config,
		writeConfig: (next) => {
			config = next;
			return next;
		},
		backupConfig: () => {},
		current: () => config,
	};
}

/** An assistant message event that names one provider/model route. */
const route = (provider, model, time = Date.parse('2026-10-19T02:00:00Z')) => ({
	type: 'assistant/message',
	time,
	data: { message: { source: { provider, model } } },
});

test('the history scan continues when listing sessions fails', async () => {
	const errors = [];
	const base = makeConfig();
	const history = createHistoryModels(
		{
			listSessions: async () => {
				throw new Error('session store unavailable');
			},
			readSession: async () => ({ events: [] }),
		},
		{ ...base, onError: (error) => errors.push(error) },
	);

	const config = await history.config();
	assert.deepEqual(config.pricing, {}, 'the configured routes remain the only known routes');
	assert.equal(history.ready(), true, 'a failed scan does not block later saves');
	assert.equal(errors.length, 1, 'the listing failure is reported once');
});

test('a save succeeds while one session log is unreadable', async () => {
	const base = makeConfig();
	const history = createHistoryModels(
		{
			listSessions: async () => [{ header: { id: 'broken' } }],
			readSession: async () => {
				throw new Error('refusing to interpret the log');
			},
		},
		{ ...base },
	);
	const saved = await history.save({ ...base.current(), showSidebarCost: false });
	assert.equal(saved.showSidebarCost, false);
	assert.equal(base.current().showSidebarCost, false);
});