import { buildCostView, RATE_KEYS, zeroRate, parseRouteKey } from './pricing.js';
import { createConfigStore, buildDraft, configOf } from './client-store.js';
window.__ModuleLoader__.load({
	id: `dsh-cost-meter`,
	factory: (e) => {
		var t = { exports: {} },
			n = t.exports;
		Object.defineProperty(n, Symbol.toStringTag, { value: `Module` });

		const react = e(`react`);
		const reactDom = e(`react-dom`);

		const h = react.createElement;
		const store = createConfigStore();
		function useCostView(props) {
			const raw = props.useProjection('costUsage');
			const snapshot = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
			const loadStatus = react.useSyncExternalStore(store.subscribe, store.getLoadStatus);
			const missing =
				!snapshot ||
				(raw?.accounting && Object.keys(raw.accounting.byRoute).some((key) => key && !snapshot.config.pricing[key]));
			react.useEffect(() => {
				if (
					!snapshot ||
					(raw?.accounting && Object.keys(raw.accounting.byRoute).some((key) => key && !snapshot.config.pricing[key]))
				)
					store.load().catch(() => {});
			}, [raw]);
			return react.useMemo(() => {
				const view = raw?.accounting && snapshot ? buildCostView(raw.accounting, snapshot.config) : raw;
				return missing && loadStatus !== 'error' ? { ...view, initializing: true } : view;
			}, [raw, snapshot, missing, loadStatus]);
		}
		const NS = `dshCostMeter`;

		//#region css
		const CSS_TAG = `dsh-cost-meter/cost-chip.module.css`;
		const CSS = `:root{--dcc-money:var(--dsw-alias-label-secondary)}
.dcc_dockRoot{box-sizing:border-box;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex;justify-content:center;gap:12px}
.dcc_dockPill{box-sizing:border-box;corner-shape:round;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;border-radius:999px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}
.dcc_dockPill svg{flex:none;width:14px;height:14px}
.dcc_dockPill:hover,.dcc_dockPill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dcc_dockLabel{text-overflow:ellipsis;min-width:0;overflow:hidden}
.dcc_money{color:var(--dcc-money);font-variant-numeric:tabular-nums}
.dcc_turnRoot{min-width:0;display:inline-flex;order:1}
.dcc_turnTrigger{min-width:0;height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);font-variant-numeric:tabular-nums;line-height:calc(24px + var(--dsh-content-font-delta,0px));white-space:nowrap;cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:6px 8px;display:inline-flex}
.dcc_turnLabel{text-overflow:ellipsis;min-width:0;overflow:hidden}
.dcc_turnTrigger svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px));flex:none}
.dcc_turnTrigger:hover,.dcc_turnTrigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}
.dcc_initializing{pointer-events:none}
@media (width<=480px){.dcc_turnTrigger{width:calc(28px + var(--dsh-content-font-delta,0px));justify-content:center;padding:6px}.dcc_turnTrigger .dcc_turnLabel{display:none}}
.dcc_turnTrigger.dcc_initializing{width:auto}
.dcc_panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:16px;font-size:12px;line-height:18px;position:fixed}
.dcc_title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}
.dcc_titleRule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}
.dcc_titleValue{font-variant-numeric:tabular-nums}
.dcc_titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}
.dcc_titleLabel svg{flex:none;width:14px;height:14px}
.dcc_details{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}
.dcc_details dt,.dcc_details dd{min-width:0;margin:0}
.dcc_details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}
.dcc_details .dcc_route{overflow-wrap:anywhere}
.dcc_sub{color:var(--dsw-alias-label-tertiary);margin:12px 0 6px;font-weight:500}
.dcc_note{color:var(--dsw-alias-label-tertiary);margin-top:10px}
.dcc_form{border:0;padding:0;margin:0;min-width:0;display:grid;gap:12px;max-width:760px}
.dcc_fields{display:grid;gap:8px}
.dcc_field{display:grid;grid-template-columns:minmax(96px,auto) minmax(0,1fr);align-items:center;gap:12px}
.dcc_fieldLabel{color:var(--dsw-alias-label-secondary)}
.dcc_input{box-sizing:border-box;width:100%;min-width:0;font:inherit;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:4px 8px}
.dcc_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.dcc_input[type=checkbox]{width:auto;justify-self:start}
.dcc_rows{display:grid;gap:6px;overflow-x:auto}.dcc_model{overflow-wrap:anywhere}.dcc_row{min-width:620px}.dcc_actions{flex-wrap:wrap}.dcc_ok,.dcc_error{overflow-wrap:anywhere;min-width:0}
.dcc_row{display:grid;grid-template-columns:minmax(0,1.6fr) repeat(4,minmax(0,1fr)) auto;align-items:center;gap:6px}
.dcc_rowHead{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dcc_provider{min-width:620px;margin-top:8px;padding:8px 0 5px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-weight:500;overflow-wrap:anywhere}
.dcc_model{padding-left:12px}
.dcc_btn{font:inherit;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:3px 10px;cursor:pointer}
.dcc_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dcc_btn:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.dcc_btnPrimary{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dcc_actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.dcc_hint{color:var(--dsw-alias-label-tertiary)}
.dcc_error{color:var(--dsw-alias-label-error,var(--dsw-alias-label-primary))}
.dcc_ok{color:var(--dsw-alias-label-tertiary)}`;
		if (
			typeof document !== `undefined` &&
			document.querySelector(`style[data-plugin-css=` + JSON.stringify(CSS_TAG) + `]`) === null
		) {
			const tag = document.createElement(`style`);
			tag.dataset.plugin = `dsh-cost-meter`;
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region formatting
		/** Exact token count with 3-digit grouping. */
		function formatExactTokens(value) {
			if (typeof value !== `number` || !Number.isFinite(value)) return `0`;
			const sign = value < 0 ? `-` : ``;
			const digits = String(Math.abs(Math.round(value)));
			const groups = [];
			for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
			return sign + groups.join(`,`);
		}
		/** Convert integer micro-USD into the display currency. */
		function toDisplay(micros, currency, cnyPerUsd) {
			const usd = micros / 1e6;
			return currency === `CNY` ? usd * (cnyPerUsd || 7.2) : usd;
		}
		/** Currency symbol for the configured currency. */
		function symbolOf(currency) {
			if (currency === `CNY`) return `¥`;
			if (currency === `USD`) return `$`;
			return currency ? currency + ` ` : ``;
		}
		/** Exact money string: ¥0.0034 / ¥1.23. */
		function formatMoney(micros, currency, cnyPerUsd) {
			if (micros === null || micros === undefined) return `—`;
			const value = toDisplay(micros, currency, cnyPerUsd);
			const symbol = symbolOf(currency);
			if (value === 0) return symbol + `0.00`;
			if (Math.abs(value) < 0.01) return symbol + value.toFixed(4);
			if (Math.abs(value) < 1) return symbol + value.toFixed(3);
			return symbol + value.toFixed(2);
		}
		/** Compact money string for the inline chips. */
		function formatChipMoney(micros, currency, cnyPerUsd) {
			if (micros === null || micros === undefined) return `—`;
			const value = toDisplay(micros, currency, cnyPerUsd);
			const symbol = symbolOf(currency);
			if (value === 0) return symbol + `0.00`;
			if (Math.abs(value) < 0.01) return symbol + `<0.01`;
			return symbol + value.toFixed(2);
		}
		//#endregion

		//#region shared UI primitives (inlined)
		// This plugin ships no dependency on a DSH Client package. A separate
		// npm plugin may not runtime-import one: its bundle is built outside the
		// Harness module table, so there is no supplier for such a request. The
		// two hooks and the icon below are therefore copied from
		// `@deepseek-ai/dsh-client-ui-primitives` (v0.2.1-alpha.2,
		// src/useAnchoredPosition.ts, src/useDismissOnOutsidePointer.ts, and
		// src/icons/index.tsx). Inlined copies stay local to this plugin; an
		// upstream primitive change does not reach them.

		/** Viewport inset an overlay keeps below the desktop frame's top strip. */
		function overlayTopMargin(min) {
			const root = document.documentElement;
			const clearance = Number.parseFloat(getComputedStyle(root).getPropertyValue(`--dsh-frame-top-clearance`));
			if (Number.isNaN(clearance)) return min;
			return Math.max(min, (root.hasAttribute(`data-fullscreen`) ? 0 : clearance) + 20);
		}

		/**
		 * Track an anchor and return a fixed-position panel's coordinates.
		 * Measurements stop being valid as soon as anything scrolls or resizes,
		 * so this re-measures on scroll (capture phase, catching nested
		 * scrollers), on resize, and on the panel's own size changes.
		 * @returns `{left, top}`, or null before the first measurement.
		 */
		function useAnchoredPosition(options) {
			const { open, anchorRef, panelRef, side = `bottom`, align = `start`, gap, margin } = options;
			const [position, setPosition] = react.useState(null);
			react.useLayoutEffect(() => {
				if (!open) {
					setPosition(null);
					return undefined;
				}
				const place = () => {
					const rect = anchorRef.current?.getBoundingClientRect();
					if (rect === undefined) return;
					const panel = panelRef.current;
					const width = panel?.offsetWidth ?? 0;
					const height = panel?.offsetHeight ?? 0;
					let left = align === `end` ? rect.right - width : rect.left;
					let top = side === `top` ? rect.top - gap - height : rect.bottom + gap;
					if (width > 0) left = Math.min(Math.max(left, margin), window.innerWidth - width - margin);
					if (height > 0) top = Math.min(Math.max(top, overlayTopMargin(margin)), window.innerHeight - height - margin);
					setPosition({ left, top });
				};
				// The first run measures the panel in the same commit that opened
				// it, so the clamp uses real dimensions before anything paints.
				place();
				window.addEventListener(`scroll`, place, true);
				window.addEventListener(`resize`, place);
				const panel = panelRef.current;
				let observer = null;
				if (typeof ResizeObserver !== `undefined` && panel !== null) {
					observer = new ResizeObserver(place);
					observer.observe(panel);
				}
				return () => {
					observer?.disconnect();
					window.removeEventListener(`scroll`, place, true);
					window.removeEventListener(`resize`, place);
				};
			}, [open, anchorRef, panelRef, side, align, gap, margin]);
			return position;
		}

		/**
		 * Close an open popover when a pointerdown lands outside its root.
		 * @param root - element containing both the trigger and the open surface.
		 * @param open - whether the surface is showing; false detaches the listener.
		 * @param setOpen - state setter invoked with false on an outside pointerdown.
		 * @param portal - surface portaled outside the root that also counts as inside.
		 */
		function useDismissOnOutsidePointer(root, open, setOpen, portal) {
			react.useEffect(() => {
				if (!open) return undefined;
				const closeOutside = (event) => {
					if (
						event.target instanceof Node &&
						root.current?.contains(event.target) !== true &&
						portal?.current?.contains(event.target) !== true
					) {
						setOpen(false);
					}
				};
				document.addEventListener(`pointerdown`, closeOutside);
				return () => {
					document.removeEventListener(`pointerdown`, closeOutside);
				};
			}, [root, open, setOpen, portal]);
		}

		/**
		 * The official gauge glyph (IconGaugeOutline at the regular 1px weight).
		 * @returns the svg element.
		 */
		function IconGaugeOutlineRegular(props) {
			const { size = 16, className } = props ?? {};
			return h(
				`svg`,
				{
					width: size,
					height: size,
					className,
					viewBox: `0 0 16 16`,
					fill: `none`,
					xmlns: `http://www.w3.org/2000/svg`,
					'aria-hidden': `true`,
					strokeWidth: 1,
				},
				h(`path`, {
					d: `M3.4041 13.096C2.49514 12.187 1.87614 11.0288 1.62537 9.76798C1.37459 8.50716 1.50331 7.20028 1.99525 6.01261C2.48719 4.82494 3.32025 3.80981 4.3891 3.09557C5.45795 2.38134 6.71458 2.00008 8.0001 2C9.28563 2.00008 10.5423 2.38134 11.6111 3.09557C12.68 3.80981 13.513 4.82494 14.005 6.01261C14.4969 7.20028 14.6256 8.50716 14.3748 9.76798C14.1241 11.0288 13.5051 12.187 12.5961 13.096`,
					stroke: `currentColor`,
				}),
				h(`path`, { d: `M8 8.49994L11.6114 4.88855`, stroke: `currentColor` }),
				h(`path`, {
					d: `M8 9.75C8.69036 9.75 9.25 9.19036 9.25 8.5C9.25 7.80964 8.69036 7.25 8 7.25C7.30964 7.25 6.75 7.80964 6.75 8.5C6.75 9.19036 7.30964 9.75 8 9.75Z`,
					fill: `currentColor`,
				}),
			);
		}
		//#endregion

		//#region dialog
		const PANEL_MARGIN = 12;
		const PANEL_GAP = 8;
		const MEASURE_STYLE = { visibility: `hidden`, left: 0, top: 0 };

		/**
		 * Anchored popover state, mirroring the official useStatDialog.
		 * @returns open/setOpen/rootRef/panelRef/pos
		 */
		function useCostDialog() {
			const [open, setOpen] = react.useState(false);
			const rootRef = react.useRef(null);
			const panelRef = react.useRef(null);
			const pos = useAnchoredPosition({
				open,
				anchorRef: rootRef,
				panelRef,
				side: `top`,
				gap: PANEL_GAP,
				margin: PANEL_MARGIN,
			});
			useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);
			react.useEffect(() => {
				if (!open) return undefined;
				const onKeyDown = (event) => {
					if (event.key === `Escape`) setOpen(false);
				};
				document.addEventListener(`keydown`, onKeyDown);
				return () => document.removeEventListener(`keydown`, onKeyDown);
			}, [open]);
			return { open, setOpen, rootRef, panelRef, pos };
		}

		/**
		 * Render one detail row, skipping absent values.
		 * @returns dt/dd pair or null.
		 */
		function row(label, value, key) {
			if (value === null || value === undefined || value === false) return null;
			return [h(`dt`, { key: key + `-k` }, label), h(`dd`, { key: key + `-v` }, value)];
		}

		/** Detail list shared by both cards. */
		function details(items, key) {
			const children = [];
			for (const item of items) {
				const cells = row(item[0], item[1], `r${children.length}`);
				if (cells !== null) children.push(cells[0], cells[1]);
			}
			return h(`dl`, { className: `dcc_details`, key }, children);
		}

		/** The floating card shell. */
		function panel(props) {
			return reactDom.createPortal(
				h(`div`, {
					ref: props.panelRef,
					className: `dcc_panel`,
					role: `dialog`,
					'aria-label': props.title,
					style: props.pos ?? MEASURE_STYLE,
					children: [
						h(`div`, { className: `dcc_title`, key: `title` }, [
							h(`span`, { className: `dcc_titleLabel`, key: `l` }, [
								h(props.icon, { key: `i` }),
								h(`span`, { key: `t` }, props.title),
							]),
							h(`span`, { className: `dcc_titleValue`, key: `v` }, props.value),
						]),
						h(`div`, { className: `dcc_titleRule`, key: `rule` }),
						react.Children.toArray(props.children),
					],
				}),
				document.body,
			);
		}
		//#endregion

		//#region components
		function InitializingChip({ t, turn }) {
			return h(
				'span',
				{ className: turn ? 'dcc_turnRoot' : 'dcc_dockRoot', role: 'status', 'aria-busy': true },
				h(
					'span',
					{ className: (turn ? 'dcc_turnTrigger' : 'dcc_dockPill') + ' dcc_initializing', title: t('initializing') },
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
							h(`div`, { className: `dcc_sub`, key: `h` }, t(`byRoute`)),
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
			return h(`span`, { className: `dcc_dockRoot`, ref: dialog.rootRef }, [
				h(
					`button`,
					{
						key: `b`,
						type: `button`,
						className: `dcc_dockPill`,
						'aria-haspopup': `dialog`,
						'aria-expanded': dialog.open,
						onClick: () => dialog.setOpen(!dialog.open),
					},
					[h(IconGaugeOutlineRegular, { key: `i` }), h(`span`, { className: `dcc_dockLabel`, key: `l` }, label)],
				),
				dialog.open
					? panel({
							panelRef: dialog.panelRef,
							pos: dialog.pos,
							title: t(`sessionTitle`),
							value: formatMoney(view.totalMicros, view.currency, view.cnyPerUsd),
							icon: IconGaugeOutlineRegular,
							children: [details(items, `main`), routeRows, h(`div`, { className: `dcc_note`, key: `n` }, t(`note`))],
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
			return h(`span`, { className: `dcc_turnRoot`, ref: dialog.rootRef }, [
				h(
					`button`,
					{
						key: `b`,
						type: `button`,
						className: `dcc_turnTrigger`,
						'aria-haspopup': `dialog`,
						'aria-expanded': dialog.open,
						onClick: () => dialog.setOpen(!dialog.open),
					},
					[
						h(IconGaugeOutlineRegular, { key: `i` }),
						h(`span`, { className: `dcc_turnLabel`, key: `l` }, t(`turnCost`, { amount: label })),
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
		//#endregion

		//#region locale
		const zh = {
			modelName: `模型`,
			initializing: `初始化中`,
			sessionTitle: `会话费用`,
			turnTitle: `本轮费用`,
			costValue: `费用 {amount}`,
			turnCost: `{amount}`,
			input: `未缓存输入`,
			cacheRead: `缓存读取`,
			cacheWrite: `缓存写入`,
			output: `输出`,
			model: `提供方 / 模型`,
			unpriced: `未计价 token`,
			unpricedValue: `{count} 轮`,
			skipped: `未取到用量的轮次`,
			noPricing: `未配置单价`,
			byRoute: `按模型`,
			count: `{count} tok`,
			note: `费用按各模型单价估算,单价可在插件详情页的费用配置中修改。`,
			pluginTitle: `费用`,
			pluginDescription: `按 token 用量估算会话与每轮费用,可自定义各模型单价。`,
			configSectionGeneral: `通用`,
			configCurrency: `显示货币`,
			configCnyPerUsd: `汇率(1 USD = ? CNY)`,
			configShowDockChip: `显示会话费用胶囊`,
			configShowTurnChip: `显示轮次费用胶囊`,
			configPricing: `模型单价`,
			configSave: `保存`,
			configSaving: `保存中…`,
			configSaved: `已保存`,
			configLoading: `读取配置中…`,
			configLoadFailed: `读取配置失败:{message}`,
		};
		const en = {
			modelName: `Model`,
			initializing: `Initializing`,
			sessionTitle: `Session cost`,
			turnTitle: `Turn cost`,
			costValue: `Cost {amount}`,
			turnCost: `{amount}`,
			input: `Uncached input`,
			cacheRead: `Cache read`,
			cacheWrite: `Cache write`,
			output: `Output`,
			model: `Provider / model`,
			unpriced: `Unpriced tokens`,
			unpricedValue: `{count}`,
			skipped: `Turns without usage`,
			noPricing: `no rate configured`,
			byRoute: `By model`,
			count: `{count} tok`,
			note: `Estimated from per-model rates; edit them on this plugin's detail page.`,
			pluginTitle: `Cost`,
			pluginDescription: `Estimates session and per-turn cost from token usage. Model rates are editable.`,
			configSectionGeneral: `General`,
			configCurrency: `Currency`,
			configCnyPerUsd: `Rate (1 USD = ? CNY)`,
			configShowDockChip: `Show session cost chip`,
			configShowTurnChip: `Show per-turn cost chip`,
			configPricing: `Model rates`,
			configSave: `Save`,
			configSaving: `Saving…`,
			configSaved: `Saved`,
			configLoading: `Loading configuration…`,
			configLoadFailed: `Could not load configuration: {message}`,
		};
		//#endregion

		//#region config page
		/** Bundle package name: the plugins.bundle.config key and loader id. */
		const ENTRY_ID = `dsh-cost-meter`;
		/** One labelled row. */
		function field(label, control, key) {
			// `control` is always an element; give it a key of its own so React
			// does not warn about the keyless child of this two-item array.
			const value = control === null || control === undefined ? null : react.cloneElement(control, { key: `v` });
			return h(`div`, { className: `dcc_field`, key }, [
				h(`span`, { className: `dcc_fieldLabel`, key: `l` }, label),
				value,
			]);
		}

		/** A number input bound to the draft. */
		function numberInput(value, onChange, key) {
			return h(`input`, {
				key,
				className: `dcc_input`,
				type: `number`,
				step: `any`,
				value: String(value ?? ``),
				onChange: (event) => onChange(event.target.value),
			});
		}

		/**
		 * The bundle-page configuration card (plugins.bundle.config).
		 *
		 * Self-managed persistence: the draft is loaded from and saved to the
		 * host half's loopback config route, which owns
		 * `<DSH_HOME>/dsh-cost-meter/config.json`. No settings namespace and no
		 * form controller are involved.
		 */
		function CostConfigCard(props) {
			const t = props.t,
				text = (zh, en) => (t('configSave') === '保存' ? zh : en);
			const [payload, setPayload] = react.useState(null),
				[draft, setDraft] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null),
				[notice, setNotice] = react.useState('');
			const accept = (value) => {
				setPayload(value);
				setDraft(buildDraft(value));
			};
			react.useEffect(() => {
				let active = true;
				store
					.load()
					.then((v) => active && accept(v))
					.catch((e) => active && setError(e.message));

				return () => {
					active = false;
				};
			}, []);
			if (!draft) return h('div', { className: error ? 'dcc_error' : 'dcc_hint' }, error || t('configLoading'));
			const dirty = JSON.stringify(draft) !== JSON.stringify(buildDraft(payload));
			const patch = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
			const rowPatch = (index, changes) =>
				setDraft((current) => ({
					...current,
					rows: current.rows.map((row, at) => (at === index ? { ...row, ...changes } : row)),
				}));
			const run = async (sync) => {
				if (
					sync &&
					!window.confirm(
						text(
							'同步将覆盖配置中匹配模型的价格，是否继续？',
							'Sync will overwrite prices of matched configured models. Continue?',
						),
					)
				)
					return;
				setBusy(true);
				setError(null);
				setNotice('');
				try {
					const value = sync ? await store.sync() : await store.save(configOf(draft));
					accept(value);
					const skipped = value.report
						? [...value.report.unmatched, ...value.report.unsupported, ...value.report.ambiguous]
						: [];
					setNotice(
						value.report
							? text('已更新', 'Updated') +
									': ' +
									value.report.updated.length +
									'; ' +
									text('保留原价', 'Preserved') +
									': ' +
									skipped.length +
									(skipped.length ? ' (' + skipped.join(', ') + ')' : '')
							: t('configSaved'),
					);
				} catch (e) {
					setError(e.message);
				} finally {
					setBusy(false);
				}
			};
			const groups = new Map();
			draft.rows.forEach((row, index) => {
				const { provider, model } = parseRouteKey(row.key);
				if (!groups.has(provider)) groups.set(provider, []);
				groups.get(provider).push({ row, index, model });
			});
			const rows = [...groups].flatMap(([provider, entries]) => [
				h(
					'div',
					{ key: `provider:${provider}`, className: 'dcc_provider', role: 'heading', 'aria-level': 3 },
					provider,
				),
				...entries.map(({ row, index, model }) =>
					h('div', { className: 'dcc_row', key: row.key }, [
						h('span', { key: 'model', className: 'dcc_model', title: row.key }, model),
						...RATE_KEYS.map((key) => numberInput(row[key], (value) => rowPatch(index, { [key]: value }), key)),
						h(
							'button',
							{
								key: 'reset',
								type: 'button',
								className: 'dcc_btn',
								title: text('价格归零', 'Reset prices to zero'),
								onClick: () => rowPatch(index, zeroRate()),
							},
							'↺',
						),
					]),
				),
			]);
			return h('fieldset', { className: 'dcc_form', disabled: busy }, [
				field(
					t('configCurrency'),
					h(
						'select',
						{ className: 'dcc_input', value: draft.currency, onChange: (e) => patch('currency', e.target.value) },
						['USD', 'CNY'].map((value) => h('option', { key: value, value }, value)),
					),
					'currency',
				),
				field(
					t('configCnyPerUsd'),
					numberInput(draft.cnyPerUsd, (value) => patch('cnyPerUsd', value)),
					'exchange',
				),
				...['showDockChip', 'showTurnChip'].map((key) =>
					field(
						t(key === 'showDockChip' ? 'configShowDockChip' : 'configShowTurnChip'),
						h('input', {
							className: 'dcc_input',
							type: 'checkbox',
							checked: draft[key],
							onChange: (e) => patch(key, e.target.checked),
						}),
						key,
					),
				),
				h('div', { key: 'pricing', className: 'dcc_sub' }, t('configPricing') + ' (USD / 1M tokens)'),
				h('div', { key: 'source', className: 'dcc_actions' }, [
					h('span', { key: 'from' }, text('从', 'From')),
					h(
						'select',
						{
							key: 'select',
							className: 'dcc_input',
							style: { width: 'auto' },
							'aria-label': text('价格来源', 'Price source'),
						},
						h('option', { value: 'models.dev' }, 'models.dev'),
					),
					h(
						'button',
						{ key: 'sync', type: 'button', className: 'dcc_btn', disabled: dirty || busy, onClick: () => run(true) },
						text('同步价格', 'Sync prices'),
					),
				]),
				dirty
					? h(
							'div',
							{ key: 'dirty', className: 'dcc_hint' },
							text('请先保存修改，再同步价格。', 'Save changes before syncing prices.'),
						)
					: null,
				h('div', { key: 'rows', className: 'dcc_rows' }, [
					h(
						'div',
						{ key: 'head', className: 'dcc_row' },
						['modelName', 'input', 'output', 'cacheRead', 'cacheWrite', ''].map((key) =>
							h('span', { key, className: 'dcc_rowHead' }, key ? t(key) : ''),
						),
					),
					...rows,
				]),
				draft.rows.length
					? null
					: h('div', { key: 'empty', className: 'dcc_hint' }, text('暂无模型调用历史', 'No model call history')),
				h('div', { key: 'actions', className: 'dcc_actions' }, [
					error ? h('span', { key: 'error', className: 'dcc_error' }, error) : null,
					notice ? h('span', { key: 'notice', className: 'dcc_ok' }, notice) : null,
					h(
						'button',
						{
							key: 'reload',
							type: 'button',
							className: 'dcc_btn',
							onClick: async () => {
								setBusy(true);
								try {
									accept(await store.load());
									setError(null);
								} catch (e) {
									setError(e.message);
								} finally {
									setBusy(false);
								}
							},
						},
						text('重新加载', 'Reload'),
					),
					h(
						'button',
						{ key: 'save', type: 'button', className: 'dcc_btn dcc_btnPrimary', onClick: () => run(false) },
						busy ? t('configSaving') : t('configSave'),
					),
				]),
			]);
		}
		//#endregion

		//#region plugin
		const inject = [`slots`, `locale`];

		/**
		 * Register the locale dictionaries, the two cost chips, and the
		 * bundle-page configuration card that edits the model price table.
		 * @param ctx - client plugin context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), `dsh-cost-meter: dictionaries`);
			ctx.slots.inject(`conversation.composer.dock`, () =>
				ctx.slots.register(
					{
						name: `conversation.composer.dock`,
						id: `dsh-cost-meter-dock`,
						order: 10,
						locale: NS,
					},
					CostDockChip,
				),
			);
			ctx.slots.inject(`conversation.chat.assistant-actions`, () =>
				ctx.slots.register(
					{
						name: `conversation.chat.assistant-actions`,
						id: `dsh-cost-meter-turn`,
						order: 10,
						locale: NS,
					},
					CostTurnAction,
				),
			);

			ctx.effect(
				() =>
					ctx.slots.inject(`plugins.bundle.config`, () =>
						ctx.slots.register(
							{
								name: `plugins.bundle.config`,
								key: ENTRY_ID,
								locale: NS,
								inject: () => ({}),
							},
							CostConfigCard,
						),
					),
				`dsh-cost-meter: bundle config page`,
			);
		}
		//#endregion

		n.apply = apply;
		n.inject = inject;
		return t.exports;
	},
});
