import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { createHistoryModels } from '../src/history.js';
import { createSessionLogs } from '../src/server/session-log.js';

const EVENT_TIME = Date.parse('2026-10-19T02:00:00Z');

/** One compressed frame holding the given events. */
function frame(events) {
	return zstdCompressSync(Buffer.from(events.map((event) => JSON.stringify(event)).join('\n') + '\n'));
}

/** A session home with one workspace directory. */
function makeHome() {
	const root = mkdtempSync(join(tmpdir(), 'dsh-cost-log-'));
	mkdirSync(join(root, '--workspace--'));
	return root;
}

/** Create one session directory with the given log files. */
function makeSession(root, id, files) {
	const dir = join(root, '--workspace--', id);
	mkdirSync(dir);
	for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
	return dir;
}

const message = (provider, model) => ({
	type: 'assistant/message',
	time: EVENT_TIME,
	data: { message: { source: { provider, model } } },
});
const title = (text) => ({ type: 'session/title', time: EVENT_TIME, data: { title: text } });
const counter = () => {
	const seen = [];
	return {
		seen,
		definition: {
			init: () => null,
			apply: (state, event) => {
				seen.push(event.type);
				return state;
			},
		},
	};
};

test('a compressed session log is located, folded and titled', () => {
	const root = makeHome();
	const dir = makeSession(root, 'session-one', {
		'session.v4.jsonl.zstd': Buffer.concat([
			frame([message('deepseek', 'v3.2')]),
			frame([message('aliyun', 'qwen3-coder'), title('每日报表')]),
		]),
	});
	const logs = createSessionLogs({ root });
	const location = logs.locate().get('session-one');
	assert.equal(location.path, join(dir, 'session.v4.jsonl.zstd'));
	assert.equal(location.zstd, true);
	const { seen, definition } = counter();
	const folded = logs.fold(location, definition);
	assert.deepEqual(seen, ['assistant/message', 'assistant/message', 'session/title']);
	assert.equal(folded.title, '每日报表');
	assert.match(logs.stampOf(location), /^\d+(\.\d+)?:\d+$/);
});

test('a truncated final frame does not hide the earlier events', () => {
	const root = makeHome();
	const complete = frame([message('deepseek', 'v3.2')]);
	const torn = frame([title('丢失的标题')]).subarray(0, 8);
	makeSession(root, 'session-two', { 'session.v3.jsonl.zstd': Buffer.concat([complete, torn]) });
	const logs = createSessionLogs({ root });
	const { seen, definition } = counter();
	const folded = logs.fold(logs.locate().get('session-two'), definition);
	assert.deepEqual(seen, ['assistant/message']);
	assert.equal(folded.title, undefined);
});

test('an uncompressed session log is read the same way', () => {
	const root = makeHome();
	const dir = makeSession(root, 'session-three', {
		'session.v1.jsonl': Buffer.from(
			[message('deepseek', 'v3.2'), title('纯文本日志')].map((event) => JSON.stringify(event)).join('\n') + '\n',
		),
	});
	const logs = createSessionLogs({ root });
	const location = logs.locate().get('session-three');
	assert.equal(location.path, join(dir, 'session.v1.jsonl'));
	assert.equal(location.zstd, false);
	const { seen, definition } = counter();
	assert.equal(logs.fold(location, definition).title, '纯文本日志');
	assert.deepEqual(seen, ['assistant/message', 'session/title']);
});

test('the newest log version is used and a corrupt log reports once', () => {
	const root = makeHome();
	makeSession(root, 'session-four', {
		'session.v1.jsonl.zstd': frame([title('旧版本')]),
		'session.v2.jsonl.zstd': frame([title('新版本')]),
	});
	makeSession(root, 'session-bad', { 'session.v1.jsonl.zstd': Buffer.from('not a zstd log at all') });
	const errors = [];
	const logs = createSessionLogs({ root, onError: (error) => errors.push(error) });
	const locations = logs.locate();
	assert.equal(logs.titleOf(locations.get('session-four')), '新版本');
	assert.equal(logs.fold(locations.get('session-bad'), counter().definition), null);
	assert.equal(errors.length, 1);
});

test('the history scan reads log files instead of replaying them through the host', async () => {
	const root = makeHome();
	makeSession(root, 'session-a', {
		'session.v1.jsonl.zstd': frame([message('deepseek-official', 'deepseek-v3.2')]),
	});
	let replayed = 0;
	const history = createHistoryModels(
		{
			listSessions: async () => [{ header: { id: 'session-a' }, persisted: true }],
			readSession: async () => {
				replayed += 1;
				return { events: [] };
			},
		},
		{
			readConfig: () => ({ currency: 'CNY', cnyPerUsd: 7, formatVersion: 2, pricing: {} }),
			writeConfig: (next) => next,
			backupConfig: () => {},
			sessionLogs: createSessionLogs({ root }),
		},
	);
	const config = await history.config();
	assert.equal(replayed, 0, 'the host replay is not used for a readable log');
	assert.ok(Object.hasOwn(config.pricing, 'deepseek-official/deepseek-v3.2'));
});
