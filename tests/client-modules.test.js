import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zh, en } from '../src/client/locales.js';
import { formatMoney, formatChipMoney, formatExactTokens } from '../src/client/format.js';
import { createCostChips } from '../src/client/cost-chips.js';
import { createUseCostView } from '../src/client/cost-view.js';

test('client dictionaries have matching keys and interpolation parameters', () => {
	assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
	for (const key of Object.keys(zh)) {
		const params = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
		assert.deepEqual(params(zh[key]), params(en[key]), key);
	}
});

test('money and token formatting preserves display precision and currency conversion', () => {
	assert.equal(formatMoney(null, 'USD', 7.2), '—');
	assert.equal(formatMoney(0, 'USD', 7.2), '$0.00');
	assert.equal(formatMoney(1234, 'USD', 7.2), '$0.0012');
	assert.equal(formatMoney(123400, 'USD', 7.2), '$0.123');
	assert.equal(formatMoney(1234000, 'USD', 7.2), '$1.23');
	assert.equal(formatMoney(1000000, 'CNY', 7.2), '¥7.20');
	assert.equal(formatChipMoney(1234, 'USD', 7.2), '$<0.01');
	assert.equal(formatChipMoney(123400, 'USD', 7.2), '$0.12');
	assert.equal(formatExactTokens(1234567), '1,234,567');
});

/** Minimal element factory: the chips only need createElement. */
function fakeReact() {
	return {
		createElement: (type, props, ...children) => ({
			type,
			props: { ...props, children: children.length === 1 && Array.isArray(children[0]) ? children[0] : children },
		}),
		useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
		useMemo: (build) => build(),
		useEffect: () => {},
	};
}

test('both chips build their panel children only while the dialog is open', () => {
	const keys = [];
	const t = (key) => {
		keys.push(key);
		return key;
	};
	let open = false;
	const dialogs = {
		useCostDialog: () => ({
			open,
			setOpen: () => {},
			rootRef: { current: null },
			panelRef: { current: null },
			pos: null,
		}),
		panel: (props) => ({ type: 'panel', props }),
		details: (items, key) => ({ type: 'details', props: { items, key } }),
		Hint: () => null,
	};
	const view = { amounts: [], routes: [], uncertainTokens: 5, currency: 'USD', cnyPerUsd: 7.2 };
	const chips = createCostChips(fakeReact(), () => view, dialogs);
	const dockProps = { useCostView: () => view, t };

	open = false;
	const closed = chips.CostDockChip(dockProps);
	assert.equal(closed.props.children[1], null, 'closed dock chip has no panel');
	assert.equal(closed.props.children.length, 2, 'closed dock chip renders trigger and empty panel slot');
	assert.equal(keys.includes('uncertainTokens'), false, 'closed dock chip builds no panel rows');

	open = true;
	const opened = chips.CostDockChip(dockProps);
	assert.equal(opened.props.children[1].type, 'panel', 'open dock chip shows the panel');
	assert.equal(keys.includes('uncertainTokens'), true, 'open dock chip builds the foot rows');

	keys.length = 0;
	open = false;
	view.turns = { 1: { priced: true, amounts: [], micros: 0, routes: [], uncertainTokens: 5 } };
	const turnProps = { useCostView: () => view, t, turn: 1 };
	chips.CostTurnChip(turnProps);
	assert.equal(keys.includes('uncertainTokens'), false, 'closed turn chip builds no panel rows');
	open = true;
	chips.CostTurnChip(turnProps);
	assert.equal(keys.includes('uncertainTokens'), true, 'open turn chip builds the foot rows');
});

test('the client prices one projection once per configuration and calendar change', () => {
	let snapshot = { config: { pricing: {} }, calendars: { rules: {} } };
	const useCostView = createUseCostView(fakeReact(), {
		subscribe: () => {},
		getSnapshot: () => snapshot,
		getLoadStatus: () => 'ready',
	});
	const totals = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
	const accounting = { byRoute: {}, turns: {}, byTime: {}, totals };
	const props = { useProjection: () => ({ accounting }) };

	const first = useCostView(props);
	assert.equal(useCostView(props), first, 'the same inputs reuse the priced view');

	const other = { projection: {}, accounting: { byRoute: {}, turns: {}, byTime: {}, totals } };
	assert.notEqual(useCostView({ useProjection: () => other }), first, 'a new projection prices again');

	snapshot = { config: { pricing: {} }, calendars: snapshot.calendars };
	assert.notEqual(useCostView(props), first, 'a new configuration prices again');

	snapshot = { config: snapshot.config, calendars: { rules: { next: true } } };
	assert.notEqual(useCostView(props), first, 'a new calendar prices again');
});
