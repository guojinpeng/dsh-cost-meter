import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOverviewPrefetcher } from '../src/client/overview-prefetch.js';
import { OVERVIEW_RANGES } from '../src/client/overview-request.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeStore(initial) {
	const listeners = new Set();
	return {
		getSnapshot: () => initial,
		getLoadStatus: () => 'ready',
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		load: async () => initial,
		publish(next) {
			initial = next;
			for (const listener of listeners) listener();
		},
	};
}

/** Capture timer registrations so the test drives the cadence itself. */
function fakeTimers() {
	const handles = [];
	return {
		handles,
		setTimeout(fn, delay) {
			const handle = { fn, delay, cleared: false };
			handles.push(handle);
			return handle;
		},
		clearTimeout(handle) {
			handle.cleared = true;
		},
		active() {
			return handles.filter((handle) => !handle.cleared);
		},
	};
}

/** Record URLs and hold every response until the test releases it. */
function fakeFetcher() {
	const calls = [];
	const releases = [];
	return {
		calls,
		fetcher: (url) => {
			calls.push(url);
			return new Promise((resolve) => releases.push(() => resolve({ ok: true, json: async () => ({}) })));
		},
		release() {
			for (const done of releases.splice(0)) done();
		},
	};
}

const configSnapshot = (overrides) => ({
	config: { autoRefreshCost: true, autoRefreshMinutes: 5, ...overrides },
	revision: 1,
});

test('a fixed interval warms all five preset ranges in parallel', async () => {
	const store = fakeStore(configSnapshot());
	const timers = fakeTimers();
	const net = fakeFetcher();
	const prefetcher = createOverviewPrefetcher(store, { fetcher: net.fetcher, timers });

	assert.equal(net.calls.length, 5, 'one request per range');
	for (const range of OVERVIEW_RANGES)
		assert.ok(net.calls.includes(`/guojinpeng/dsh-cost-meter/overview?days=${range}&refresh=1`), range);
	assert.equal(timers.active().length, 1);
	assert.equal(timers.active()[0].delay, 5 * 60000);

	net.release();
	await settle();
	prefetcher.dispose();
	assert.equal(timers.active().length, 0);
});

test('a tick skips a batch that is still running, then loads again', async () => {
	const store = fakeStore(configSnapshot());
	const timers = fakeTimers();
	const net = fakeFetcher();
	const prefetcher = createOverviewPrefetcher(store, { fetcher: net.fetcher, timers });

	timers.active()[0].fn();
	assert.equal(net.calls.length, 5, 'the running batch is not repeated');

	net.release();
	await settle();
	timers.active()[0].fn();
	assert.equal(net.calls.length, 10, 'the next tick starts a new batch');
	net.release();
	await settle();
	prefetcher.dispose();
});

test('an interval or revision change reloads, and the switch stops the timer', async () => {
	const store = fakeStore(configSnapshot());
	const timers = fakeTimers();
	const net = fakeFetcher();
	const prefetcher = createOverviewPrefetcher(store, { fetcher: net.fetcher, timers });
	net.release();
	await settle();

	store.publish(configSnapshot({ autoRefreshMinutes: 15 }));
	assert.equal(net.calls.length, 10, 'a new interval reloads once');
	assert.equal(timers.active().length, 1);
	assert.equal(timers.active()[0].delay, 15 * 60000);

	net.release();
	await settle();
	store.publish({ ...configSnapshot({ autoRefreshMinutes: 15 }), revision: 2 });
	assert.equal(net.calls.length, 15, 'a saved configuration reloads once');

	store.publish(configSnapshot({ autoRefreshCost: false, autoRefreshMinutes: 15 }));
	assert.equal(timers.active().length, 0, 'the switch off clears the timer');
	assert.equal(net.calls.length, 15, 'the switch off sends nothing');
	net.release();
	await settle();
	prefetcher.dispose();
});

test('the prefetcher loads the configuration before it starts', async () => {
	let snapshot = null;
	const listeners = new Set();
	const store = {
		getSnapshot: () => snapshot,
		getLoadStatus: () => 'idle',
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		load: async () => {
			snapshot = configSnapshot();
			for (const listener of listeners) listener();
			return snapshot;
		},
	};
	const timers = fakeTimers();
	const net = fakeFetcher();
	const prefetcher = createOverviewPrefetcher(store, { fetcher: net.fetcher, timers });
	await settle();
	assert.equal(net.calls.length, 5, 'the first batch starts once the configuration arrives');
	net.release();
	await settle();
	prefetcher.dispose();
});

test('dispose stops the cadence and ignores later configuration changes', async () => {
	const store = fakeStore(configSnapshot());
	const timers = fakeTimers();
	const net = fakeFetcher();
	const prefetcher = createOverviewPrefetcher(store, { fetcher: net.fetcher, timers });
	net.release();
	await settle();
	prefetcher.dispose();
	assert.equal(timers.active().length, 0);
	store.publish({ ...configSnapshot({ autoRefreshMinutes: 30 }), revision: 3 });
	assert.equal(net.calls.length, 5);
	assert.equal(timers.active().length, 0);
});
