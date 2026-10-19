import { createCostIcon } from './icons.js';
import { formatMoney, formatChipMoney, formatExactTokens, formatAmounts, formatAmountPeriod } from './format.js';

/** Detail rows of one priced period, in display order. */
const ROWS = [
	['input', 'input'],
	['read', 'cacheRead'],
	['write', 'cacheWrite'],
	['output', 'output'],
];
/**
 * Display groups. Peak money includes the unconfirmed period, because an
 * unconfirmed window is charged at the peak price.
 */
const GROUPS = [
	{ key: 'peak', label: 'peakPrice', periods: ['peak', 'unknown'] },
	{ key: 'offPeak', label: 'offPeakPrice', periods: ['offPeak'] },
	{ key: 'fixed', label: 'fixedPrice', periods: ['fixed'] },
];

export function createCostChips(react, useCostView, dialogs) {
	const h = react.createElement;
	const { useCostDialog, panel, details, Hint } = dialogs;
	const CostIcon = createCostIcon(react);

	function InitializingChip({ t, turn }) {
		return h(
			'span',
			{ className: turn ? 'gdcc_turnRoot' : 'gdcc_dockRoot', role: 'status', 'aria-busy': true },
			h(
				'span',
				{
					className: (turn ? 'gdcc_turnTrigger' : 'gdcc_dockPill') + ' gdcc_initializing',
					title: t('initializing'),
				},
				[h(CostIcon, { key: 'icon' }), h('span', { key: 'label' }, t('initializing'))],
			),
		);
	}

	/** Money one group charges for one field, in the holder's own currency. */
	function groupMicros(holder, group, field) {
		if (holder === undefined) return 0;
		return group.periods.reduce((sum, period) => sum + (holder[period]?.[field] ?? 0), 0);
	}

	/** One price formula per charged window: the popover holds formulas only. */
	function formulaLines(route, group, field, t) {
		const lines = [];
		if (route.rates === undefined || route.tokensByPeriod === undefined) return lines;
		for (const period of group.periods) {
			const tokens = route.tokensByPeriod[period]?.[field] ?? 0;
			if (tokens <= 0) continue;
			const factor = period === 'offPeak' ? route.rates.factor : 1;
			lines.push(
				h(
					'div',
					{ className: 'gdcc_hintLine', key: period },
					t(period === 'offPeak' ? 'formulaOffPeak' : 'formula', {
						tokens: formatExactTokens(tokens),
						unit: formatMoney(route.rates[field] * 1e6, route.currency, 1),
						percent: Math.round(factor * 100),
						money: formatMoney(route.periodMicros?.[period]?.[field] ?? 0, route.currency, 1),
					}),
				),
			);
		}
		return lines;
	}

	/** Session-level hint: one block per model, named, with its own lines. */
	function sessionHint(routes, group, field, t) {
		const children = [];
		for (const route of routes) {
			const lines = formulaLines(route, group, field, t);
			if (lines.length === 0) continue;
			children.push(h('div', { className: 'gdcc_hintModel', key: 'm-' + route.route }, route.route));
			for (const line of lines) children.push(react.cloneElement(line, { key: route.route + '-' + line.key }));
		}
		return children;
	}

	/** A money cell, with the formula button when a derivation exists. */
	function amountRow(label, money, hint, t) {
		return [
			label,
			h(
				'span',
				{ className: 'gdcc_amount' },
				hint.length === 0
					? money
					: [money, h(Hint, { key: 'h', label: t('formulaLabel'), title: t('formulaLabel'), children: hint })],
			),
		];
	}

	/** Hint of a summed row: the model is named above, so label each field. */
	function routeHint(route, group, t) {
		const children = [];
		for (const row of ROWS) {
			const lines = formulaLines(route, group, row[0], t);
			if (lines.length === 0) continue;
			children.push(h('div', { className: 'gdcc_hintField', key: 'f-' + row[0] }, t(row[1])));
			for (const line of lines) children.push(react.cloneElement(line, { key: row[0] + '-' + line.key }));
		}
		return children;
	}

	/**
	 * One model block: the route name, then its window groups.
	 *
	 * The session panel sums each group on one row; the turn panel lists the
	 * four prices of each group like the session-level groups do.
	 */
	function routeBlock(route, t, detail) {
		const block = [h('div', { className: 'gdcc_routeName', key: 'n' }, route.route)];
		if (route.priced === false) block.push(h('div', { className: 'gdcc_note', key: 'p' }, t('noPricing')));
		else if (detail) {
			for (const group of GROUPS) {
				const items = [];
				for (const row of ROWS) {
					const micros = groupMicros(route.periodMicros, group, row[0]);
					if (micros <= 0) continue;
					items.push(
						amountRow(
							t(row[1]),
							formatMoney(micros, route.currency, 1),
							formulaLines(route, group, row[0], t),
							t,
						),
					);
				}
				if (items.length === 0) continue;
				block.push(
					h('div', { className: 'gdcc_group', key: group.key }, [
						h('div', { className: 'gdcc_sub', key: 'h' }, t(group.label)),
						details(items, 'r-' + route.route + '-' + group.key),
					]),
				);
			}
		} else {
			const items = [];
			for (const group of GROUPS) {
				const micros = ROWS.reduce((sum, row) => sum + groupMicros(route.periodMicros, group, row[0]), 0);
				if (micros <= 0) continue;
				items.push(
					amountRow(
						t(group.label),
						formatMoney(micros, route.currency, 1),
						routeHint(route, group, t),
						t,
					),
				);
			}
			if (items.length > 0) block.push(details(items, 'r-' + route.route));
		}
		return h('div', { className: 'gdcc_routeBlock', key: route.route }, block);
	}

	/** Count rows shared by both panels; zero counts stay hidden. */
	function footItems(view, t) {
		const items = [];
		if (view.uncertainTokens > 0)
			items.push([t('uncertainTokens'), t('count', { count: formatExactTokens(view.uncertainTokens) })]);
		if (view.skippedTurns > 0) items.push([t('skipped'), t('unpricedValue', { count: view.skippedTurns })]);
		if (view.unpricedTokens > 0)
			items.push([t('unpriced'), t('count', { count: formatExactTokens(view.unpricedTokens) })]);
		return items;
	}

	/**
	 * Bottom status-bar chip: session-level spend.
	 *
	 * The panel prices the four token buckets per window group (peak,
	 * off-peak, fixed) and per model; token counts stay with the official
	 * usage pill.
	 */
	function CostDockChip(props) {
		const view = useCostView(props);
		const dialog = useCostDialog();
		const t = props.t;
		if (view === undefined || view === null || view.showDock === false) return null;
		if (view.initializing) return h(InitializingChip, { t });
		const amount = view.amounts
			? formatAmounts(view.amounts, true)
			: formatChipMoney(view.totalMicros, view.currency, view.cnyPerUsd);
		const label = t('costValue', { amount });
		const amounts = view.amounts ?? [];
		const routes = view.routes ?? [];
		const children = [];
		for (const group of GROUPS) {
			const items = [];
			for (const row of ROWS) {
				const money = formatAmountPeriod(amounts, group.periods, row[0]);
				if (money === null) continue;
				items.push(amountRow(t(row[1]), money, sessionHint(routes, group, row[0], t), t));
			}
			if (items.length === 0) continue;
			children.push(
				h('div', { className: 'gdcc_group', key: group.key }, [
					h('div', { className: 'gdcc_sub', key: 'h' }, t(group.label)),
					details(items, group.key),
				]),
			);
		}
		if (routes.length > 0) {
			if (children.length > 0) children.push(h('div', { className: 'gdcc_divider', key: 'divider' }));
			for (const route of routes) children.push(routeBlock(route, t));
		}
		const foot = footItems(view, t);
		if (foot.length > 0) children.push(details(foot, 'foot'));
		children.push(h('div', { className: 'gdcc_note', key: 'note' }, t('note')));
		return h('span', { className: 'gdcc_dockRoot', ref: dialog.rootRef }, [
			h(
				'button',
				{
					key: 'b',
					type: 'button',
					className: 'gdcc_dockPill',
					'aria-haspopup': 'dialog',
					'aria-expanded': dialog.open,
					onClick: () => dialog.setOpen(!dialog.open),
				},
				[
					h(CostIcon, { key: 'i' }),
					h('span', { className: 'gdcc_dockLabel', key: 'l' }, label),
				],
			),
			dialog.open
				? panel({
						panelRef: dialog.panelRef,
						pos: dialog.pos,
						title: t('sessionTitle'),
						value: view.amounts
							? formatAmounts(view.amounts)
							: formatMoney(view.totalMicros, view.currency, view.cnyPerUsd),
						icon: CostIcon,
						children,
					})
				: null,
		]);
	}

	/**
	 * Turn-footer chip: spend of one turn, rendered next to the official
	 * "本轮用量" pill.
	 *
	 * The panel shows each route of the turn with its peak and off-peak
	 * sums; token counts stay with the official usage pill.
	 */
	function CostTurnAction(props) {
		const turn = props.useChat((snapshot) => {
			const tail = snapshot.nodes
				.values()
				.find(
					(node) => node.kind === 'turn-tail' && node.data.closing?.finalNode.messageId === props.messageId,
				);
			return tail?.data.turn;
		});
		return turn === undefined ? null : h(CostTurnChip, { ...props, turn });
	}

	function CostTurnChip(props) {
		const view = useCostView(props);
		const dialog = useCostDialog();
		const t = props.t;
		if (view === undefined || view === null || view.showTurn === false) return null;
		if (view.initializing) return h(InitializingChip, { t, turn: true });
		// The turn-tail slot is handed the whole turn record ({turn, status,
		// steps, ...}), not its number; official consumers read 'turn.turn'
		// (see ui-plan, ui-deliverables). Accept a bare number too.
		const raw = props.turn;
		const turnNo = raw !== null && typeof raw === 'object' ? raw.turn : raw;
		if (!Number.isSafeInteger(turnNo) || turnNo < 1) return null;
		const entry = view.turns === undefined ? undefined : view.turns[String(turnNo)];
		if (entry === undefined) return null;
		const label = entry.priced
			? entry.amounts
				? formatAmounts(entry.amounts, true)
				: formatChipMoney(entry.micros, view.currency, view.cnyPerUsd)
			: t('noPricing');
		const routes = entry.routes ?? [];
		const children = [];
		for (const [index, route] of routes.entries()) {
			if (index > 0) children.push(h('div', { className: 'gdcc_divider', key: 'divider-' + index }));
			children.push(routeBlock(route, t, true));
		}
		const foot = footItems(entry, t);
		if (foot.length > 0) children.push(details(foot, 'foot'));
		return h('span', { className: 'gdcc_turnRoot', ref: dialog.rootRef }, [
			h(
				'button',
				{
					key: 'b',
					type: 'button',
					className: 'gdcc_turnTrigger',
					'aria-haspopup': 'dialog',
					'aria-expanded': dialog.open,
					onClick: () => dialog.setOpen(!dialog.open),
				},
				[
					h(CostIcon, { key: 'i' }),
					h('span', { className: 'gdcc_turnLabel', key: 'l' }, t('turnCost', { amount: label })),
				],
			),
			dialog.open
				? panel({
						panelRef: dialog.panelRef,
						pos: dialog.pos,
						title: t('turnTitle'),
						value: entry.amounts
							? formatAmounts(entry.amounts)
							: formatMoney(entry.micros, view.currency, view.cnyPerUsd),
						icon: CostIcon,
						children,
					})
				: null,
		]);
	}

	return { InitializingChip, CostDockChip, CostTurnChip, CostTurnAction };
}
