import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { createHistoryDefinition, createHistoryModels } from '../src/history.js';
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
/** A stateful definition that counts the events it was given. */
const tally = () => ({
	init: () => ({ count: 0 }),
	apply: (state, event) => {
		state.count += 1;
		return state;
	},
	stateVersion: 1,
});

test('a compressed session log is located, folded and titled', async () => {
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
	const folded = await logs.fold(location, definition);
	assert.deepEqual(seen, ['assistant/message', 'assistant/message', 'session/title']);
	assert.equal(folded.title, '每日报表');
	assert.match(logs.stampOf(location), /^\d+(\.\d+)?:\d+$/);
});

test('a truncated final frame does not hide the earlier events', async () => {
	const root = makeHome();
	const complete = frame([message('deepseek', 'v3.2')]);
	const torn = frame([title('丢失的标题')]).subarray(0, 8);
	makeSession(root, 'session-two', { 'session.v3.jsonl.zstd': Buffer.concat([complete, torn]) });
	const logs = createSessionLogs({ root });
	const { seen, definition } = counter();
	const folded = await logs.fold(logs.locate().get('session-two'), definition);
	assert.deepEqual(seen, ['assistant/message']);
	assert.equal(folded.title, undefined);
});

test('an uncompressed session log is read the same way', async () => {
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
	assert.equal((await logs.fold(location, definition)).title, '纯文本日志');
	assert.deepEqual(seen, ['assistant/message', 'session/title']);
});

test('the newest log version is used and a corrupt log reports once', async () => {
	const root = makeHome();
	makeSession(root, 'session-four', {
		'session.v1.jsonl.zstd': frame([title('旧版本')]),
		'session.v2.jsonl.zstd': frame([title('新版本')]),
	});
	makeSession(root, 'session-bad', { 'session.v1.jsonl.zstd': Buffer.from('not a zstd log at all') });
	const errors = [];
	const logs = createSessionLogs({ root, onError: (error) => errors.push(error) });
	const locations = logs.locate();
	assert.equal(await logs.titleOf(locations.get('session-four')), '新版本');
	assert.equal(await logs.fold(locations.get('session-bad'), counter().definition), null);
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
			sessionLogs: createSessionLogs({
				root,
				definitions: [{ name: 'history', definition: createHistoryDefinition() }],
			}),
		},
	);
	const config = await history.config();
	assert.equal(replayed, 0, 'the host replay is not used for a readable log');
	assert.ok(Object.hasOwn(config.pricing, 'deepseek-official/deepseek-v3.2'));
});

test('a folded session is cached until its log or its definition changes', async () => {
	const root = makeHome();
	const dir = makeSession(root, 'session-cached', {
		'session.v1.jsonl': Buffer.from(JSON.stringify(message('deepseek', 'v3.2')) + '\n'),
	});
	const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-cost-cache-'));
	const projection = { name: 'cost', definition: tally() };
	const logs = createSessionLogs({ root, cacheDir, definitions: [projection] });
	const location = logs.locate().get('session-cached');
	const stamp = logs.stampOf(location);
	const cacheFile = join(cacheDir, 'session-cached.json');
	assert.deepEqual(await logs.foldCached('session-cached', location, stamp), {
		states: { cost: { count: 1 } },
		title: undefined,
	});
	assert.ok(existsSync(cacheFile));
	// The state comes from the cache file, so the log is not read again.
	rmSync(dir, { recursive: true });
	assert.deepEqual(await logs.foldCached('session-cached', location, stamp), {
		states: { cost: { count: 1 } },
		title: undefined,
	});
	// A changed stamp, a changed projection definition, and a corrupt cache all
	// fall back to a fold, which reports the missing log.
	const errors = [];
	const fresh = createSessionLogs({ root, cacheDir, definitions: [projection], onError: (error) => errors.push(error) });
	assert.equal(await fresh.foldCached('session-cached', location, stamp + ':1'), null);
	assert.equal(errors.length, 1);
	const other = createSessionLogs({
		root,
		cacheDir,
		definitions: [{ name: 'cost', definition: { ...tally(), stateVersion: 2 } }],
	});
	assert.equal(await other.foldCached('session-cached', location, stamp), null);
	writeFileSync(cacheFile, '{');
	assert.equal(await fresh.foldCached('session-cached', location, stamp), null);
});

test('an appended log is folded from its new frames only', async () => {
	const root = makeHome();
	const first = frame([message('deepseek', 'v3.2')]);
	const dir = makeSession(root, 'session-grow', { 'session.v1.jsonl.zstd': first });
	const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-cost-cache-'));
	const logs = createSessionLogs({ root, cacheDir, definitions: [{ name: 'cost', definition: tally() }] });
	const location = logs.locate().get('session-grow');
	assert.equal((await logs.foldCached('session-grow', location, logs.stampOf(location))).states.cost.count, 1);
	// Appending a frame changes the stamp, not the bytes already folded.
	writeFileSync(join(dir, 'session.v1.jsonl.zstd'), Buffer.concat([first, frame([title('标题'), message('aliyun', 'qwen3-coder')])]));
	const folded = await logs.foldCached('session-grow', location, logs.stampOf(location));
	assert.deepEqual(folded, { states: { cost: { count: 3 } }, title: '标题' });
	const entry = JSON.parse(readFileSync(join(cacheDir, 'session-grow.json'), 'utf8'));
	assert.equal(entry.offset, statSync(join(dir, 'session.v1.jsonl.zstd')).size);
});

test('a rewritten log is folded from the start', async () => {
	const root = makeHome();
	const dir = makeSession(root, 'session-rewrite', { 'session.v1.jsonl.zstd': frame([message('deepseek', 'v3.2')]) });
	const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-cost-cache-'));
	const logs = createSessionLogs({ root, cacheDir, definitions: [{ name: 'cost', definition: tally() }] });
	const location = logs.locate().get('session-rewrite');
	assert.equal((await logs.foldCached('session-rewrite', location, logs.stampOf(location))).states.cost.count, 1);
	// The first frame changes, so the cached prefix hash no longer matches.
	writeFileSync(join(dir, 'session.v1.jsonl.zstd'), frame([message('aliyun', 'qwen3-coder'), message('aliyun', 'qwen3-coder')]));
	const folded = await logs.foldCached('session-rewrite', location, logs.stampOf(location));
	assert.equal(folded.states.cost.count, 2, 'the old state is not reused');
});
