import { formatMoney, formatChipMoney, formatExactTokens } from './format.js';

export function createCostChips(react, useCostView, dialogs) {
	const h = react.createElement;
	const { useCostDialog, panel, details, IconGaugeOutlineRegular } = dialogs;
	function InitializingChip({ t, turn }) {
		return h(
			'span',
			{ className: turn ? 'gdcc_turnRoot' : 'gdcc_dockRoot', role: 'status', 'aria-busy': true },
			h(
				'span',
				{ className: (turn ? 'gdcc_turnTrigger' : 'gdcc_dockPill') + ' gdcc_initializing', title: t('initializing') },
				[h(IconGaugeOutlineRegular, { key: 'icon' }), h('span', { key: 'label' }, t('initializing'))],
			),
		);
	}
	/**
	 * Bottom status-bar chip: session-level spend.
	 *
	 * The panel lists the four token buckets priced into money (the host
	 * pre-computes `bucketMicros`), the per-model breakdown, and nothing
	 * else: token counts belong to the official usage pill.
	 */
	function CostDockChip(props) {
		const view = useCostView(props);
		const dialog = useCostDialog();
		const t = props.t;
		if (view === undefined || view === null || view.showDock === false) return null;
		if (view.initializing) return h(InitializingChip, { t });
		const label = t(`costValue`, { amount: formatChipMoney(view.totalMicros, view.currency, view.cnyPerUsd) });
		const buckets = view.bucketMicros ?? { input: 0, output: 0, read: 0, write: 0 };
		const items = [
			[t(`input`), formatMoney(buckets.input, view.currency, view.cnyPerUsd)],
			[t(`cacheRead`), formatMoney(buckets.read, view.currency, view.cnyPerUsd)],
			[t(`cacheWrite`), formatMoney(buckets.write, view.currency, view.cnyPerUsd)],
			[t(`output`), formatMoney(buckets.output, view.currency, view.cnyPerUsd)],
		];
		if (view.skippedTurns > 0) items.push([t(`skipped`), t(`unpricedValue`, { count: view.skippedTurns })]);
		if (view.unpricedTokens > 0) items.push([t(`unpriced`), t(`count`, { count: view.unpricedTokens })]);
		const routes = view.routes ?? [];
		const routeRows =
			routes.length === 0
				? null
				: h(`div`, { key: `routes` }, [
						h(`div`, { className: `gdcc_sub`, key: `h` }, t(`byRoute`)),
						details(
							routes.flatMap((entry) => [
								[
									entry.route,
									formatMoney(entry.micros, view.currency, view.cnyPerUsd) +
										`  ·  ` +
										t(`count`, { count: formatExactTokens(entry.totalTokens) }),
								],
							]),
							`routes`,
						),
					]);
		return h(`span`, { className: `gdcc_dockRoot`, ref: dialog.rootRef }, [
			h(
				`button`,
				{
					key: `b`,
					type: `button`,
					className: `gdcc_dockPill`,
					'aria-haspopup': `dialog`,
					'aria-expanded': dialog.open,
					onClick: () => dialog.setOpen(!dialog.open),
				},
				[h(IconGaugeOutlineRegular, { key: `i` }), h(`span`, { className: `gdcc_dockLabel`, key: `l` }, label)],
			),
			dialog.open
				? panel({
						panelRef: dialog.panelRef,
						pos: dialog.pos,
						title: t(`sessionTitle`),
						value: formatMoney(view.totalMicros, view.currency, view.cnyPerUsd),
						icon: IconGaugeOutlineRegular,
						children: [details(items, `main`), routeRows, h(`div`, { className: `gdcc_note`, key: `n` }, t(`note`))],
					})
				: null,
		]);
	}

	/**
	 * Turn-footer chip: spend of one turn, rendered next to the official
	 * "本轮用量" pill.
	 *
	 * The panel shows the route plus the four token buckets priced into
	 * money (tokens × rate from the wire entry); token counts and the rate
	 * line itself are left to the official usage pill.
	 */
	function CostTurnAction(props) {
		const turn = props.useChat((snapshot) => {
			const tail = snapshot.nodes
				.values()
				.find((node) => node.kind === `turn-tail` && node.data.closing?.finalNode.messageId === props.messageId);
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
		// steps, ...}), not its number; official consumers read `turn.turn`
		// (see ui-plan, ui-deliverables). Accept a bare number too.
		const raw = props.turn;
		const turnNo = raw !== null && typeof raw === `object` ? raw.turn : raw;
		if (!Number.isSafeInteger(turnNo) || turnNo < 1) return null;
		const entry = view.turns === undefined ? undefined : view.turns[String(turnNo)];
		if (entry === undefined) return null;
		const label = entry.priced ? formatChipMoney(entry.micros, view.currency, view.cnyPerUsd) : t(`noPricing`);
		const priced = entry.priced === true;
		const money = entry.bucketMicros;
		const items = [
			[t(`model`), entry.route === `` ? null : entry.route],
			priced ? [t(`input`), formatMoney(money.input, view.currency, view.cnyPerUsd)] : [t(`input`), t(`noPricing`)],
			priced ? [t(`cacheRead`), formatMoney(money.read, view.currency, view.cnyPerUsd)] : null,
			priced ? [t(`cacheWrite`), formatMoney(money.write, view.currency, view.cnyPerUsd)] : null,
			priced ? [t(`output`), formatMoney(money.output, view.currency, view.cnyPerUsd)] : null,
		].filter((item) => item !== null);
		return h(`span`, { className: `gdcc_turnRoot`, ref: dialog.rootRef }, [
			h(
				`button`,
				{
					key: `b`,
					type: `button`,
					className: `gdcc_turnTrigger`,
					'aria-haspopup': `dialog`,
					'aria-expanded': dialog.open,
					onClick: () => dialog.setOpen(!dialog.open),
				},
				[
					h(IconGaugeOutlineRegular, { key: `i` }),
					h(`span`, { className: `gdcc_turnLabel`, key: `l` }, t(`turnCost`, { amount: label })),
				],
			),
			dialog.open
				? panel({
						panelRef: dialog.panelRef,
						pos: dialog.pos,
						title: t(`turnTitle`),
						value: formatMoney(entry.micros, view.currency, view.cnyPerUsd),
						icon: IconGaugeOutlineRegular,
						children: [details(items, `turn`)],
					})
				: null,
		]);
	}

	return { InitializingChip, CostDockChip, CostTurnChip, CostTurnAction };
}
