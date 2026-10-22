import { formatMoney, formatExactTokens } from './format.js';
import { logAxisMax, logTicks, modelPoints, shortModelName, trendBarRange } from './overview-charts.js';
import { OVERVIEW_RANGES, fetchOverview } from './overview-request.js';
import { normalizeRefreshMinutes } from '../refresh.js';

/** Selectable ranges, in display order. */
const RANGES = OVERVIEW_RANGES;
/** Token series, darkest first. */
const SERIES = [
	{ key: 'input', labelKey: 'input' },
	{ key: 'output', labelKey: 'output' },
	{ key: 'read', labelKey: 'cacheRead' },
	{ key: 'write', labelKey: 'cacheWrite' },
];

/** Compact token count: 1.24M / 340K. */
function compactTokens(value) {
	if (!Number.isFinite(value) || value <= 0) return '0';
	if (value >= 1e9) return (value / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
	if (value >= 1e6) return (value / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
	if (value >= 1e3) return (value / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
	return String(Math.round(value));
}

/**
 * Short money text for the totals above the columns. A full amount does not fit
 * on a column, so keep a decimal only for small amounts and when there is room.
 */
function shortMoneyText(text, withDecimal) {
	const match = /^([^0-9]*)([0-9]+)(?:\.([0-9]+))?/.exec(text);
	if (match === null) return text;
	const whole = Number(match[2]);
	const fraction = match[3] ?? '';
	// A positive amount below one cent must not read as zero.
	if (whole === 0 && fraction.slice(0, 2) === '00' && /[1-9]/.test(fraction.slice(2))) return match[1] + '<0.01';
	if (whole >= 100) return match[1] + String(whole);
	if (whole >= 10) return match[1] + (withDecimal ? whole + '.' + fraction.slice(0, 1) : String(whole));
	return match[1] + whole + '.' + (fraction + '00').slice(0, 2);
}

/** Beijing date and time of an instant, without a locale dependency. */
function beijingTime(value, withTime = false) {
	const date = new Date((value ?? 0) + 8 * 3600000);
	if (!Number.isFinite(date.getTime())) return '';
	const iso = date.toISOString();
	return withTime ? iso.slice(0, 10) + ' ' + iso.slice(11, 16) : iso.slice(0, 10);
}

const share = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
/** Move one open tooltip without a React render. */
// Two hover lists are equal when they name the same models in the same order.
function sameHoverRoutes(left, right) {
	if (left === right) return true;
	if (left === null || right === null) return false;
	if (left.length !== right.length) return false;
	return left.every((route, index) => route === right[index]);
}

function placeTip(node, left, top) {
	if (node === null) return;
	node.style.left = left + 'px';
	node.style.top = top + 'px';
}
const percent = (value) => value.toFixed(1) + '%';

/** Calendar date in YYYY-MM-DD form, as a date input reports it. */
function isDate(value) {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function createCostOverviewPage(react, store) {
	const h = react.createElement;

	function CostOverviewPage({ t, openSession, openSettings }) {
		const snapshot = react.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
		const [range, setRange] = react.useState('30');
		const [metric, setMetric] = react.useState('money');
		const [state, setState] = react.useState({ status: 'idle', data: null, error: null });
		const [nonce, setNonce] = react.useState(0);
		const [custom, setCustom] = react.useState({ start: '', end: '' });
		const [force, setForce] = react.useState(false);
		// Only the hovered index is state. A pointer move writes the tooltip
		// position straight to the DOM, so it re-renders nothing.
		const [hover, setHover] = react.useState(null);
		const [timeHover, setTimeHover] = react.useState(null);
		const trendTipRef = react.useRef(null);
		const timeTipRef = react.useRef(null);
		const [modelView, setModelView] = react.useState('scatter');
		// Routes whose bubble sits under the pointer. Overlapping bubbles come in
		// as one list, nearest first, and the tooltip lists every one of them.
		const [modelHover, setModelHover] = react.useState(null);
		// Models switched off in the legend. The axis keeps its span, so a click
		// hides or shows one bubble without rescaling the chart.
		const [hiddenModels, setHiddenModels] = react.useState([]);
		const modelTipRef = react.useRef(null);
		const crossLayerRef = react.useRef(null);
		const crossVRef = react.useRef(null);
		const crossHRef = react.useRef(null);
		const crossXRef = react.useRef(null);
		const crossYRef = react.useRef(null);

		react.useEffect(() => {
			if (store.getSnapshot() === null) store.load().catch(() => {});
		}, []);
		const customActive = custom.start !== '' || custom.end !== '';
		const customReady = isDate(custom.start) && isDate(custom.end) && custom.end >= custom.start;

		react.useEffect(() => {
			// A half-filled or inverted date range waits for a valid pair.
			if (customActive && !customReady) return undefined;
			let alive = true;
			// A manual refresh bypasses the fifteen minute server cache once.
			const wantRefresh = force;
			if (force) setForce(false);
			setState((current) => ({ ...current, status: 'loading', error: null }));
			fetchOverview(range === '' ? '30' : range, {
				refresh: wantRefresh,
				...(customActive ? { start: custom.start, end: custom.end } : {}),
			})
				.then((payload) => {
					if (alive) setState({ status: 'ready', data: payload, error: null });
				})
				.catch((error) => {
					if (alive) setState((current) => ({ status: 'error', data: current.data, error: error.message }));
				});
			return () => {
				alive = false;
			};
		}, [range, custom.start, custom.end, nonce]);
		// A new range or a bar click clears every hovered highlight.
		react.useEffect(() => {
			setHover(null);
			setTimeHover(null);
			setModelHover(null);
		}, [range, nonce, custom.start, custom.end]);

		const data = state.data;
		const view = data?.view;
		const currency = snapshot?.config?.currency ?? data?.currency ?? 'CNY';
		const cnyPerUsd = snapshot?.config?.cnyPerUsd ?? data?.cnyPerUsd ?? 7.2;
		const money = (micros) => formatMoney(micros, currency, cnyPerUsd);
		const loading = state.status === 'loading' && data === null;
		const refreshing = state.status === 'loading' && data !== null;
		// A failed refresh keeps the previous payload and still reports the error.
		const failed = state.status === 'error';

		// The hint carries the cache state and the automatic refresh cadence.
		const cacheConfig = snapshot?.config ?? {};
		const cacheNote =
			cacheConfig.autoRefreshCost !== false
				? t('costPageAutoRefresh', { minutes: normalizeRefreshMinutes(cacheConfig.autoRefreshMinutes) })
				: t('costPageCacheTtl');
		const settings =
			typeof openSettings === 'function'
				? h(
						'button',
						{
							key: 'settings',
							type: 'button',
							className: 'gdcc_ovGhost',
							title: t('costPageSettings'),
							onClick: () => openSettings(),
						},
						[t('costPageSettings')],
					)
				: null;
		const head = h('div', { className: 'gdcc_ovHead' }, [
			h('div', { key: 'titles', className: 'gdcc_ovHeadTitles' }, [
				h('h1', { key: 'title', className: 'gdcc_ovTitle' }, t('costPageTitle')),
				h('p', { key: 'intro', className: 'gdcc_ovIntro' }, t('costPageIntro')),
			]),
			h('div', { key: 'actions', className: 'gdcc_ovHeadActions' }, [
				settings,
				h(
					'button',
					{
						key: 'refresh',
						type: 'button',
						className: 'gdcc_ovGhost',
						onClick: () => {
							setForce(true);
							setNonce((value) => value + 1);
						},
						disabled: loading,
					},
					t('costPageRefresh'),
				),
			]),
		]);

		const rangeLabel = (id) => t(id === 'all' ? 'rangeAll' : id === 'today' ? 'rangeToday' : 'range' + id);
		const pickDate = (key) => (event) => {
			const value = event.target.value;
			const next = { ...custom, [key]: value };
			// Selecting a date drops the preset; clearing both restores the default.
			if (next.start === '' && next.end === '') setRange('30');
			else setRange('');
			setCustom(next);
		};
		const toolbar = h('div', { className: 'gdcc_ovToolbar' }, [
			h(
				'div',
				{ key: 'ranges', className: 'gdcc_ovSegmented', role: 'group' },
				RANGES.map((id) =>
					h(
						'button',
						{
							key: id,
							type: 'button',
							className: 'gdcc_ovSegment',
							'aria-pressed': !customActive && range === id,
							onClick: () => {
								setRange(id);
								setCustom({ start: '', end: '' });
							},
						},
						rangeLabel(id),
					),
				),
			),
			h('div', { key: 'dates', className: 'gdcc_ovDates' }, [
				h('input', {
					key: 'start',
					type: 'date',
					className: 'gdcc_ovDate',
					value: custom.start,
					'aria-label': t('dateStartLabel'),
					onChange: pickDate('start'),
				}),
				h('span', { key: 'sep', className: 'gdcc_ovDateSep' }, '–'),
				h('input', {
					key: 'end',
					type: 'date',
					className: 'gdcc_ovDate',
					value: custom.end,
					'aria-label': t('dateEndLabel'),
					onChange: pickDate('end'),
				}),
			]),
			h(
				'span',
				{ key: 'hint', className: 'gdcc_ovToolbarHint' },
				customActive && !customReady
					? t('costPageDateHint')
					: data === null
						? t('costPageRangeHint')
						: t(data.cached === true ? 'costPageMetaCached' : 'costPageMeta', {
								time: beijingTime(data.generatedAt, true),
								note: cacheNote,
							}),
			),
		]);
		const body = [];
		if (loading)
			body.push(h('div', { key: 'loading', className: 'gdcc_ovEmpty' }, t('costPageLoading')));
		if (failed)
			body.push(
				h('div', { key: 'failed', className: 'gdcc_ovEmpty' }, [
					h('span', { key: 'message', className: 'gdcc_ovError' }, t('costPageFailed', { message: state.error })),
					h(
						'button',
						{
							key: 'retry',
							type: 'button',
							className: 'gdcc_ovGhost',
							onClick: () => setNonce((value) => value + 1),
						},
						t('costPageRetry'),
					),
				]),
			);

		if (data && view) {
			const empty = view.totalTokens === 0;
			if (!empty) body.push(kpiGrid());
			if (!empty) body.push(trendCard());
			if (!empty)
				body.push(h('div', { key: 'pair', className: 'gdcc_ovPair' }, [compositionCard(), timeOfDayCard()]));
			if (!empty && data.trend.length > 0) body.push(modelsCard());
			if (!empty && data.sessions.length > 0) body.push(sessionsCard());
			body.push(notesCard());
			if (empty)
				body.push(
					h('div', { key: 'empty', className: 'gdcc_ovEmpty' }, [
						h('strong', { key: 'title' }, t('emptyTitle')),
						h('span', { key: 'hint', className: 'gdcc_ovMuted' }, t('emptyHint')),
					]),
				);
		}

		const mask = refreshing
			? h('div', { key: 'mask', className: 'gdcc_ovLoading', role: 'status' }, [
					h('span', { key: 'spinner', className: 'gdcc_ovSpinner' }),
					h('span', { key: 'text' }, t('costPageLoading')),
				])
			: null;
		return h('div', { className: 'gdcc_page' }, [
			head,
			toolbar,
			// The body keeps the previous figures under the mask while a range loads.
			h(
				'div',
				{ key: 'body', className: 'gdcc_ovBody', 'aria-busy': state.status === 'loading' },
				[...body, mask],
			),
		]);

		function kpiGrid() {
			// The range divides by its billed days, not by its calendar days.
			const billedDays = data.billedDays ?? data.days;
			const average = billedDays > 0 ? view.totalMicros / billedDays : null;
			return h(
				'div',
				{ key: 'kpi', className: 'gdcc_ovKpis' },
				kpiCard(
					'cost',
					t('kpiTotalCost'),
					money(view.totalMicros),
					average === null
						? t('kpiNoBilledDay')
						: t('kpiAvgPerDay', { amount: money(average), days: billedDays }),
				),
				kpiCard(
					'tokens',
					t('kpiTotalTokens'),
					compactTokens(view.totalTokens),
					formatExactTokens(view.totalTokens) + ' token',
				),
				kpiCard(
					'cache',
					t('kpiCacheHit'),
					view.cacheHitPct === null ? '—' : percent(view.cacheHitPct),
					t('kpiCacheHint'),
				),
				kpiCard(
					'sessions',
					t('kpiSessions'),
					String(data.counts.activeSessions),
					t('kpiSessionHint', { count: data.counts.activeSessions }),
				),
			);
		}

		function kpiCard(key, label, value, hint) {
			return h(
				'div',
				{ key, className: 'gdcc_ovCard gdcc_ovKpi' },
				h('span', { className: 'gdcc_ovKpiLabel' }, label),
				h('strong', { className: 'gdcc_ovKpiValue' }, value),
				h('span', { className: 'gdcc_ovKpiHint' }, hint),
			);
		}

		function trendCard() {
			const units = data.trend;
			const values = units.map((unit) => (metric === 'money' ? unit.bucketMicros : unit.tokens));
			const totals = units.map((unit) => (metric === 'money' ? unit.totalMicros : unit.totalTokens));
			const max = Math.max(...totals, 1);
			// Few units get the width of one day in a long range, so today and the
			// seven-day view stay slim and centered instead of one wide block.
			const thin = units.length <= 12;
			const step = thin ? 1 : Math.ceil(units.length / 10);
			// Few columns get a fixed width; wide cards fit the totals above them.
			const showValues = units.length <= 24;
			// A merged bar names its span; single bars keep their own date.
			const axisLabel = (unit) => (data.granularity === 'month' ? unit.fromKey : String(unit.fromKey).slice(5));
			const tipLabel = (unit) =>
				unit.merged > 1
					? t('trendRange', { from: unit.fromKey, to: unit.toKey })
					: unit.fromKey;
			const tipIndex = hover !== null && hover < units.length ? hover : null;
			const format = (value) => (metric === 'money' ? money(value) : compactTokens(value));
			const columnLabel = (value) =>
				metric === 'money' ? shortMoneyText(money(value), thin) : compactTokens(value);
			const bars = units.map((unit, index) =>
				h(
					'button',
					{
						key: unit.key,
						type: 'button',
						className: 'gdcc_ovBarColumn',
						title: t('trendBarFilter', { label: tipLabel(unit) }),
						'aria-label': t('trendBarFilter', { label: tipLabel(unit) }),
						onMouseEnter: () => setHover(index),
						// One click turns the bar into a custom range and queries it.
						onClick: () => {
							const span = trendBarRange(unit);
							setRange('');
							setCustom({ start: span.start, end: span.end });
							setHover(null);
						},
					},
					[
						// The total sits on the top of its own column, so the labels follow the
						// bar heights instead of sharing one baseline.
						showValues
							? h(
									'span',
									{
										key: 'value',
										className: 'gdcc_ovBarValue',
										style: { bottom: 'calc(' + share(totals[index], max) + '% + 2px)' },
									},
									columnLabel(totals[index]),
								)
							: null,
						h(
							'div',
							{ key: 'bar', className: 'gdcc_ovBar' },
							SERIES.map((series) => {
								const value = values[index][series.key];
								return value > 0
									? h('div', {
											key: series.key,
											className: 'gdcc_ovBarSeg gdcc_ovBarSeg--' + series.key,
											style: { height: (value / max) * 100 + '%' },
										})
									: null;
							}).reverse(),
						),
					],
				),
			);
			const tipNode =
				tipIndex === null || units[tipIndex] === undefined
					? null
					: h(
							'div',
							{ key: 'tip', className: 'gdcc_ovTip', ref: trendTipRef, style: { left: '0px', top: '0px' } },
							[
								h('div', { key: 'date', className: 'gdcc_ovTipHead' }, tipLabel(units[tipIndex])),
								...SERIES.map((series) =>
									h('div', { key: series.key, className: 'gdcc_ovTipRow' }, [
										h('i', { key: 'dot', className: 'gdcc_ovDot gdcc_ovBarSeg--' + series.key }),
										h('span', { key: 'label', className: 'gdcc_ovTipLabel' }, t(series.labelKey)),
										h(
											'span',
											{ key: 'value', className: 'gdcc_ovTipValue' },
											format(values[tipIndex][series.key]),
										),
										h(
											'span',
											{ key: 'share', className: 'gdcc_ovTipShare' },
											percent(share(values[tipIndex][series.key], totals[tipIndex])),
										),
									]),
								),
								h('div', { key: 'total', className: 'gdcc_ovTipTotal' }, [
									h('span', { key: 'label' }, t('totalLabel')),
									h('strong', { key: 'value' }, format(totals[tipIndex])),
								]),
							],
						);
			return h('section', { key: 'trend', className: 'gdcc_ovCard' }, [
				h('div', { key: 'head', className: 'gdcc_ovCardHead' }, [
					h('div', { key: 'titles', className: 'gdcc_ovCardTitles' }, [
						h('h2', { key: 'title', className: 'gdcc_ovCardTitle' }, t('trendTitle')),
						h(
							'span',
							{ key: 'hint', className: 'gdcc_ovMuted' },
							t(
								units.some((unit) => unit.merged > 1)
									? 'trendHintMerged'
									: data.granularity === 'month'
										? 'trendHintMonth'
										: 'trendHintDay',
							) + t('trendClickHint'),
						),
					]),
					h(
						'div',
						{ key: 'metric', className: 'gdcc_ovSegmented' },
						[
							['money', t('kpiTotalCost')],
							['tokens', t('kpiTotalTokens')],
						].map(([id, text]) =>
							h(
								'button',
								{
									key: id,
									type: 'button',
									className: 'gdcc_ovSegment',
									'aria-pressed': metric === id,
									onClick: () => setMetric(id),
								},
								text,
							),
						),
					),
				]),
				h('div', { key: 'chart', className: 'gdcc_ovChart' }, [
					h(
						'div',
						{
							key: 'bars',
							className: thin ? 'gdcc_ovBars gdcc_ovBars--thin' : 'gdcc_ovBars',
							onMouseLeave: () => setHover(null),
							onMouseMove: (event) => {
								const box = event.currentTarget.getBoundingClientRect();
								const left = Math.max(0, Math.min(event.clientX - box.left + 14, box.width - 208));
								const top = Math.max(0, Math.min(event.clientY - box.top + 14, box.height - 8));
								placeTip(trendTipRef.current, left, top);
							},
						},
						[...bars, tipNode],
					),
					h(
						'div',
						{ key: 'axis', className: thin ? 'gdcc_ovAxis gdcc_ovAxis--thin' : 'gdcc_ovAxis' },
						units.map((unit, index) =>
							h(
								'span',
								{ key: unit.key, className: 'gdcc_ovAxisLabel' },
								index % step === 0 || index === units.length - 1 ? axisLabel(unit) : '',
							),
						),
					),
				]),
				h(
					'div',
					{ key: 'legend', className: 'gdcc_ovLegend' },
					SERIES.map((series) =>
						h('span', { key: series.key, className: 'gdcc_ovLegendItem' }, [
							h('i', { key: 'dot', className: 'gdcc_ovDot gdcc_ovBarSeg--' + series.key }),
							t(series.labelKey),
						]),
					),
				),
			]);
		}

		function compositionCard() {
			const entries = SERIES.map((series) => ({
				key: series.key,
				label: t(series.labelKey),
				value: view.tokens[series.key],
				micros: view.bucketMicros[series.key] ?? 0,
			}));
			const total = entries.reduce((sum, entry) => sum + entry.value, 0);
			const cost = entries.reduce((sum, entry) => sum + entry.micros, 0);
			// Money shares fall back to token shares while no route is priced.
			const byMoney = metric === 'money' && cost > 0;
			const unit = (entry) => (byMoney ? entry.micros : entry.value);
			const whole = byMoney ? cost : total;
			let cursor = 0;
			const stops = entries.map((entry) => {
				const from = cursor;
				cursor += share(unit(entry), whole);
				return `var(--gdcc-ov-${entry.key}) ${from}% ${cursor}%`;
			});
			return h('section', { key: 'composition', className: 'gdcc_ovCard' }, [
				h('div', { key: 'head', className: 'gdcc_ovCardHead' }, [
					h('h2', { key: 'title', className: 'gdcc_ovCardTitle' }, t('compositionTitle')),
					h(
						'span',
						{ key: 'hint', className: 'gdcc_ovMuted' },
						t(metric === 'money' ? 'compositionHintCost' : 'compositionHintTokens'),
					),
				]),
				h('div', { key: 'body', className: 'gdcc_ovComposition' }, [
					h('div', {
						key: 'donut',
						className: 'gdcc_ovDonut',
						style: { background: `conic-gradient(${stops.join(', ')})` },
					}, [
						h('div', { key: 'hole', className: 'gdcc_ovDonutHole' }, [
							h(
								'strong',
								{ key: 'main', className: 'gdcc_ovDonutCost' },
								metric === 'money' ? money(view.totalMicros) : compactTokens(total),
							),
							h(
								'span',
								{ key: 'sub' },
								metric === 'money' ? compactTokens(total) + ' token' : money(view.totalMicros),
							),
						]),
					]),
					h(
						'ul',
						{ key: 'legend', className: 'gdcc_ovCompositionLegend' },
						entries.map((entry) =>
							h('li', { key: entry.key }, [
								h('i', { key: 'dot', className: 'gdcc_ovDot gdcc_ovBarSeg--' + entry.key }),
								h('span', { key: 'label', className: 'gdcc_ovCompositionLabel' }, entry.label),
								h('span', { key: 'value', className: 'gdcc_ovMuted' }, compactTokens(entry.value)),
								h('span', { key: 'micros', className: 'gdcc_ovCompositionPrice' }, money(entry.micros)),
								h('strong', { key: 'share' }, percent(share(unit(entry), whole))),
							]),
						),
					),
				]),
			]);
		}

		function timeOfDayCard() {
			// Every row fills the track: the widths are shares of that row's own value,
			// not of the largest row.
			const rows = data.timeOfDay;
			const byMoney = metric === 'money';
			const segmentLabel = (segment) => t('segment' + segment[0].toUpperCase() + segment.slice(1));
			const rowTotal = (row) => (byMoney ? row.totalMicros : row.totalTokens);
			const rowValue = (row, key) => (byMoney ? (row.bucketMicros?.[key] ?? 0) : (row.tokens?.[key] ?? 0));
			const format = (value) => (byMoney ? money(value) : compactTokens(value));
			const hovered = timeHover !== null && rows[timeHover] !== undefined ? rows[timeHover] : null;
			const tip =
				hovered === null
					? null
					: h(
							'div',
							{
								key: 'tip',
								className: 'gdcc_ovTip gdcc_ovTimeTip',
								ref: timeTipRef,
								style: { left: '0px', top: '0px' },
							},
							[
								h('div', { key: 'head', className: 'gdcc_ovTipHead' }, segmentLabel(hovered.segment)),
								...SERIES.map((series) =>
									h('div', { key: series.key, className: 'gdcc_ovTipRow' }, [
										h('i', { key: 'dot', className: 'gdcc_ovDot gdcc_ovBarSeg--' + series.key }),
										h('span', { key: 'label', className: 'gdcc_ovTipLabel' }, t(series.labelKey)),
										h(
											'span',
											{ key: 'value', className: 'gdcc_ovTipValue' },
											format(rowValue(hovered, series.key)),
										),
										h(
											'span',
											{ key: 'share', className: 'gdcc_ovTipShare' },
											percent(share(rowValue(hovered, series.key), rowTotal(hovered))),
										),
									]),
								),
								h('div', { key: 'total', className: 'gdcc_ovTipTotal' }, [
									h('span', { key: 'label' }, t('totalLabel')),
									h('strong', { key: 'value' }, format(rowTotal(hovered))),
								]),
							],
						);
			return h('section', { key: 'time', className: 'gdcc_ovCard' }, [
				h('div', { key: 'head', className: 'gdcc_ovCardHead' }, [
					h('h2', { key: 'title', className: 'gdcc_ovCardTitle' }, t('timeOfDayTitle')),
					h(
						'span',
						{ key: 'hint', className: 'gdcc_ovMuted' },
						t(byMoney ? 'timeOfDayHintCost' : 'timeOfDayHintTokens'),
					),
				]),
				h(
					'div',
					{
						key: 'rows',
						className: 'gdcc_ovTimeRows',
						onMouseLeave: () => setTimeHover(null),
						onMouseMove: (event) => {
							const box = event.currentTarget.getBoundingClientRect();
							const left = Math.max(0, Math.min(event.clientX - box.left + 14, box.width - 208));
							const top = Math.max(0, Math.min(event.clientY - box.top + 14, box.height - 8));
							placeTip(timeTipRef.current, left, top);
						},
					},
					[
						...rows.map((row, index) =>
							h(
								'div',
								{
									key: row.segment,
									className: 'gdcc_ovTimeRow',
									onMouseEnter: () => setTimeHover(index),
								},
								[
									h('span', { key: 'label', className: 'gdcc_ovTimeLabel' }, segmentLabel(row.segment)),
									h(
										'span',
										{ key: 'track', className: 'gdcc_ovTrack' },
										SERIES.map((series) => {
											const value = rowValue(row, series.key);
											return value > 0
												? h('i', {
														key: series.key,
														className: 'gdcc_ovTrackSeg gdcc_ovBarSeg--' + series.key,
														style: { width: share(value, rowTotal(row)) + '%' },
													})
												: null;
										}),
									),
									h('span', { key: 'value', className: 'gdcc_ovTimeValue' }, format(rowTotal(row))),
								],
							),
						),
						tip,
					],
				),
			]);
		}

		// A function declaration, not a const: the card body is built before this
		// point in the render, and the legend buttons close over it.
		function toggleModel(route) {
			setHiddenModels((current) =>
				current.includes(route) ? current.filter((item) => item !== route) : [...current, route],
			);
		}

		function modelsCard() {
			const routes = (data.models ?? view.routes).filter((route) => route.totalTokens > 0);
			const byMoney = metric === 'money';
			const basis = (route) => (byMoney ? route.micros : route.totalTokens);
			const total = routes.reduce((sum, route) => sum + basis(route), 0);
			const unpriced = routes.some((route) => !route.priced);
			const scatter = modelView === 'scatter';
			const hint = unpriced
				? t('modelsUnpriced')
				: scatter
					? t('scatterHint')
					: t(byMoney ? 'modelsHintCost' : 'modelsHintTokens');
			return h('section', { key: 'models', className: 'gdcc_ovCard' }, [
				h('div', { key: 'head', className: 'gdcc_ovCardHead' }, [
					h('div', { key: 'titles', className: 'gdcc_ovCardTitles' }, [
						h('h2', { key: 'title', className: 'gdcc_ovCardTitle' }, t('modelsTitle')),
						h('span', { key: 'hint', className: 'gdcc_ovMuted' }, hint),
					]),
					h(
						'div',
						{ key: 'view', className: 'gdcc_ovSegmented' },
						[
							['scatter', t('modelViewScatter')],
							['share', t('modelViewShare')],
						].map(([id, text]) =>
							h(
								'button',
								{
									key: id,
									type: 'button',
									className: 'gdcc_ovSegment',
									'aria-pressed': modelView === id,
									onClick: () => {
										setModelView(id);
										setModelHover(null);
									},
								},
								text,
							),
						),
					),
				]),
				scatter ? modelsScatter(routes) : modelsTable(routes, basis, total),
			]);
		}

		function modelsTable(routes, basis, total) {
			return h('div', { key: 'table', className: 'gdcc_ovTable' }, [
				h('div', { key: 'head', className: 'gdcc_ovTableHead' }, [
					h('span', { key: 'model' }, t('modelColModel')),
					h('span', { key: 'tokens' }, t('modelColTokens')),
					h('span', { key: 'cost' }, t('modelColCost')),
					h('span', { key: 'share' }, t('modelColShare')),
				]),
				...routes.map((route) => {
					const slash = route.route.indexOf('/');
					const provider = slash > 0 ? route.route.slice(0, slash) : '';
					const model = slash > 0 ? route.route.slice(slash + 1) : route.route;
					return h('div', { key: route.route, className: 'gdcc_ovTableRow' }, [
						h('span', { key: 'model', className: 'gdcc_ovModel' }, [
							provider ? h('small', { key: 'provider', className: 'gdcc_ovMuted' }, provider) : null,
							h('span', { key: 'name', className: 'gdcc_ovModelName' }, model),
						]),
						h('span', { key: 'tokens', className: 'gdcc_ovNum' }, compactTokens(route.totalTokens)),
						h('span', { key: 'cost', className: 'gdcc_ovNum' }, route.priced ? money(route.micros) : '—'),
						h(
							'span',
							{ key: 'share', className: 'gdcc_ovShareCell' },
							h(
								'span',
								{ key: 'track', className: 'gdcc_ovTrack' },
								h('i', {
									key: 'fill',
									className: 'gdcc_ovTrackSeg gdcc_ovBarSeg--input',
									style: { width: share(basis(route), total) + '%' },
								}),
							),
							h('span', { key: 'share', className: 'gdcc_ovMuted' }, percent(share(basis(route), total))),
						),
					]);
				}),
			]);
		}

		function modelsScatter(routes) {
			const all = modelPoints(routes);
			if (all.length === 0)
				return h('div', { key: 'scatter', className: 'gdcc_ovScatterEmpty' }, t('scatterEmpty'));
			// The x axis is the total spend of one model in the display currency. It is
			// logarithmic because model totals differ by orders of magnitude.
			// Every name sits at the top right corner of its bubble, so the widest name
			// needs free room at the right end of the plot.
			const PLOT_HEIGHT = 260;
			const INSET = 12;
			const BUBBLE = 16;
			const GAP = BUBBLE / 2 + 4;
			// A bubble answers the pointer a little outside its rim, so a small dot
			// stays easy to reach.
			const HIT_RADIUS = BUBBLE / 2 + 5;
			const LABEL_CHAR = 5.9;
			const LABEL_MAX = 20;
			// Nominal plot width used to reserve that room; the real width is fluid.
			const LABEL_TRACK = 800;
			const rate = currency === 'CNY' ? cnyPerUsd : 1;
			const displayOf = (micros) => (micros / 1e6) * rate;
			const microsOf = (value) => (value * 1e6) / rate;
			const labelWidth = (point) => shortModelName(point.route, LABEL_MAX).length * LABEL_CHAR + 4;
			const widestLabel = all.reduce((max, point) => Math.max(max, labelWidth(point)), 0);
			const labelRoom = Math.min(0.35, (widestLabel + GAP + INSET) / LABEL_TRACK);
			const spends = all.map((point) => displayOf(point.micros)).filter((value) => value > 0);
			let spendMin = spends.length > 0 ? Math.min(...spends) : 1;
			let spendMax = spends.length > 0 ? Math.max(...spends) : 10;
			// One single model gets a symmetric span, so its bubble lands mid axis.
			if (!(spendMax > spendMin * 1.01)) {
				const middle = Math.max(spendMin, spendMax);
				spendMin = middle / 3;
				spendMax = middle * 3;
			}
			// The axis range grows until the last bubble plus its name fit on the right,
			// so a label never has to move to the left of its bubble.
			const logMin = Math.log10(spendMin);
			const logSpan = (Math.log10(spendMax) - logMin) / (1 - labelRoom);
			const axisMax = logAxisMax(Math.pow(10, logMin + logSpan));
			const tickValues = logTicks(spendMin, axisMax);
			// Drop a tick when its label would touch the previous one at the usual
			// card width; two ticks a few pixels apart read as one garbled number.
			const spacedTicks = [];
			for (const value of tickValues) {
				const fraction = Math.max(0, Math.min((Math.log10(value) - logMin) / logSpan, 1));
				const last = spacedTicks[spacedTicks.length - 1];
				// A later tick replaces a too-close earlier one, so the axis keeps its top label.
				if (last !== undefined && fraction - last.fraction < 0.055) {
					spacedTicks[spacedTicks.length - 1] = { value: value, fraction: fraction };
				} else {
					spacedTicks.push({ value: value, fraction: fraction });
				}
			}
			const xTicks = spacedTicks.length > 0 ? spacedTicks.map((tick) => tick.value) : [spendMin, axisMax];
			const maxTokens = all.reduce((max, point) => Math.max(max, point.totalTokens), 0);
			// Round the top tick up to 1/2/5 so the four labels stay short.
			const yMax = maxTokens > 0 ? logAxisMax(maxTokens) : 1;
			// No mark may paint on the gutter: the axis origin starts one bubble radius
			// inside the frame, and the pointer mapping uses the same track.
			const round = (value) => Math.round(value * 10000) / 10000;
			const at = (fraction) => 'calc(' + INSET + 'px + (100% - ' + 2 * INSET + 'px) * ' + round(fraction) + ')';
			const fractionX = (point) => {
				const value = Math.max(displayOf(point.micros), spendMin);
				return Math.max(0, Math.min((Math.log10(value) - logMin) / logSpan, 1));
			};
			const fractionY = (point) => Math.max(0, Math.min(point.totalTokens / yMax, 1));
			const tickFraction = (value) => Math.max(0, Math.min((Math.log10(value) - logMin) / logSpan, 1));
			const spendOf = (fraction) => Math.pow(10, logMin + logSpan * fraction);
			const yTicks = [yMax / 4, yMax / 2, (yMax * 3) / 4, yMax];
			// Bubble depth follows the blended price: the cheapest model is palest and
			// the dearest is deepest. Prices differ by orders of magnitude, so the ramp
			// is normalised in log space over every model in range.
			const priceOf = (point) => (point.totalTokens > 0 ? point.micros / point.totalTokens : 0);
			const prices = all.map(priceOf).filter((value) => value > 0);
			const priceLogMin = prices.length > 0 ? Math.log10(Math.min(...prices)) : 0;
			const priceLogSpan = prices.length > 1 ? Math.log10(Math.max(...prices)) - priceLogMin : 0;
			// Hue travels from teal (cheap) to indigo (dear) while lightness drops, so
			// two models with close prices still differ in colour, and both ends stay
			// readable on a light and on a dark card.
			const shadeOf = (point) => {
				const price = priceOf(point);
				if (priceLogSpan <= 0 || !(price > 0)) return 'oklch(0.66 0.1 250)';
				const ratio = Math.max(0, Math.min((Math.log10(price) - priceLogMin) / priceLogSpan, 1));
				const lightness = (0.9 - 0.48 * ratio).toFixed(3);
				const chroma = (0.06 + 0.12 * ratio).toFixed(3);
				const hue = (185 + 80 * ratio).toFixed(1);
				return 'oklch(' + lightness + ' ' + chroma + ' ' + hue + ')';
			};
			// Hidden models keep the axis span stable, so a click never rescales it.
			const visible = all.filter((point) => !hiddenModels.includes(point.route));
			const hovered =
				modelHover === null
					? []
					: modelHover.map((route) => visible.find((point) => point.route === route)).filter((point) => point !== undefined);
			// One block per hovered model, stacked top to bottom, nearest first.
			const tipGroups = hovered.map((point) =>
				h('div', { key: point.route, className: 'gdcc_ovTipGroup' }, [
					h('div', { key: 'head', className: 'gdcc_ovTipHead' }, point.route),
					...SERIES.map((series) =>
						h('div', { key: series.key, className: 'gdcc_ovTipRow' }, [
							h('i', { key: 'dot', className: 'gdcc_ovDot gdcc_ovBarSeg--' + series.key }),
							h('span', { key: 'label', className: 'gdcc_ovTipLabel' }, t(series.labelKey)),
							h('span', { key: 'value', className: 'gdcc_ovTipValue' }, money(point.bucketMicros?.[series.key] ?? 0)),
							h(
								'span',
								{ key: 'tokens', className: 'gdcc_ovTipShare' },
								compactTokens(point.tokens?.[series.key] ?? 0),
							),
						]),
					),
					h('div', { key: 'total', className: 'gdcc_ovTipTotal' }, [
						h('span', { key: 'label' }, t('totalLabel')),
						h('span', { key: 'value', className: 'gdcc_ovTipTotalValue' }, [
							h('strong', { key: 'money' }, money(point.micros)),
							h('span', { key: 'tokens', className: 'gdcc_ovMuted' }, compactTokens(point.totalTokens)),
						]),
					]),
					// Average price of one million tokens: total spend divided by total tokens.
					h('div', { key: 'avg', className: 'gdcc_ovTipAvg' }, [
						h('span', { key: 'label' }, t('tipAverage')),
						h(
							'span',
							{ key: 'value', className: 'gdcc_ovTipAvgValue' },
							money(point.totalTokens > 0 ? (point.micros / point.totalTokens) * 1e6 : 0),
						),
					]),
				]),
			);
			const tip =
				tipGroups.length === 0
					? null
					: h('div', { key: 'tip', className: 'gdcc_ovTip', ref: modelTipRef, style: { left: '0px', top: '0px' } }, tipGroups);
			// The guides sit under the bubbles, the readout chips ride on the axes.
			const cross = h('div', { key: 'cross', className: 'gdcc_ovCrossLayer', ref: crossLayerRef }, [
				h('i', { key: 'v', className: 'gdcc_ovCrossV', ref: crossVRef }),
				h('i', { key: 'h', className: 'gdcc_ovCrossH', ref: crossHRef }),
				h('span', { key: 'x', className: 'gdcc_ovCrossX', ref: crossXRef }),
				h('span', { key: 'y', className: 'gdcc_ovCrossY', ref: crossYRef }),
			]);
			// Every name sits at the top right corner of its bubble. The axis reserves
			// room for the widest name, so a name never leaves the plot.
			const labelStyle = { left: GAP + 'px', bottom: BUBBLE / 2 + 2 + 'px' };
			// One legend row per provider, each model a button that hides its bubble.
			const groups = new Map();
			for (const point of all) {
				const slash = point.route.indexOf('/');
				const provider = slash > 0 ? point.route.slice(0, slash) : '';
				const list = groups.get(provider) ?? [];
				list.push(point);
				groups.set(provider, list);
			}
			const legend = h(
				'div',
				{ key: 'legend', className: 'gdcc_ovModelLegend' },
				[...groups].map(([provider, list]) =>
					h('div', { key: provider === '' ? 'bare' : provider, className: 'gdcc_ovModelLegendRow' }, [
						provider === ''
							? null
							: h('span', { key: 'provider', className: 'gdcc_ovModelLegendProvider' }, provider),
						...list.map((point) => {
							const slash = point.route.indexOf('/');
							const name = slash > 0 ? point.route.slice(slash + 1) : point.route;
							return h(
								'button',
								{
									key: point.route,
									type: 'button',
									className: 'gdcc_ovModelLegendItem',
									'aria-pressed': !hiddenModels.includes(point.route),
									title: point.route,
									onClick: () => toggleModel(point.route),
								},
								name,
							);
						}),
					]),
				),
			);
			return h('div', { key: 'scatter', className: 'gdcc_ovScatterView' }, [
				h('div', { key: 'chart', className: 'gdcc_ovScatter' }, [
					h('span', { key: 'titleY', className: 'gdcc_ovScatterTitle gdcc_ovScatterTitle--y' }, t('scatterAxisY')),
					h(
						'div',
						{
							key: 'plot',
							className: 'gdcc_ovScatterPlot',
							style: { height: PLOT_HEIGHT + 'px' },
							onMouseMove: (event) => {
								const box = event.currentTarget.getBoundingClientRect();
								const spanX = Math.max(1, box.width - 2 * INSET);
								const spanY = Math.max(1, box.height - 2 * INSET);
								const pointerX = Math.max(0, Math.min(event.clientX - box.left, box.width));
								const pointerY = Math.max(0, Math.min(event.clientY - box.top, box.height));
								// The guides follow the pointer only: they never snap to a bubble.
								const fx = Math.max(0, Math.min((pointerX - INSET) / spanX, 1));
								const fy = Math.max(0, Math.min((box.height - pointerY - INSET) / spanY, 1));
								const lineX = INSET + spanX * fx;
								const lineY = INSET + spanY * fy;
								const layer = crossLayerRef.current;
								if (layer !== null) layer.style.opacity = '1';
								const vertical = crossVRef.current;
								if (vertical !== null) vertical.style.left = lineX + 'px';
								const horizontal = crossHRef.current;
								if (horizontal !== null) horizontal.style.bottom = lineY + 'px';
								const xChip = crossXRef.current;
								if (xChip !== null) {
									xChip.style.left = lineX + 'px';
									xChip.textContent = money(microsOf(spendOf(fx)));
								}
								const yChip = crossYRef.current;
								if (yChip !== null) {
									yChip.style.bottom = lineY + 'px';
									yChip.textContent = compactTokens(fy * yMax);
								}
								// Every bubble under the pointer is hovered, not only the topmost one:
								// stacked bubbles report their models together, nearest first.
								const hits = [];
								for (const point of visible) {
									const centerX = INSET + spanX * fractionX(point);
									const centerY = box.height - (INSET + spanY * fractionY(point));
									const distance = Math.hypot(pointerX - centerX, pointerY - centerY);
									if (distance <= HIT_RADIUS) hits.push({ route: point.route, distance: distance });
								}
								hits.sort((left, right) => left.distance - right.distance || (left.route < right.route ? -1 : 1));
								const routes = hits.map((hit) => hit.route);
								const next = routes.length === 0 ? null : routes;
								setModelHover((current) => (sameHoverRoutes(current, next) ? current : next));
								// The tooltip stays inside the plot: below or right of the pointer by
								// default, flipped to the other side when the frame ends first.
								const tipNode = modelTipRef.current;
								if (tipNode !== null) {
									const gap = 14;
									const tipWidth = tipNode.offsetWidth;
									const tipHeight = tipNode.offsetHeight;
									const rawLeft = pointerX + gap + tipWidth > box.width ? pointerX - gap - tipWidth : pointerX + gap;
									const rawTop = pointerY + gap + tipHeight > box.height ? pointerY - gap - tipHeight : pointerY + gap;
									const left = Math.max(0, Math.min(rawLeft, box.width - tipWidth));
									const top = Math.max(0, Math.min(rawTop, box.height - tipHeight));
									placeTip(tipNode, left, top);
								}
							},
							onMouseLeave: () => {
								setModelHover(null);
								if (crossLayerRef.current !== null) crossLayerRef.current.style.opacity = '0';
							},
						},
						[
							...yTicks.map((value, index) =>
								h('i', { key: 'grid' + index, className: 'gdcc_ovScatterGrid', style: { bottom: at(value / yMax) } }),
							),
							...xTicks.map((value, index) =>
								h('i', {
									key: 'vgrid' + index,
									className: 'gdcc_ovScatterGrid gdcc_ovScatterGrid--v',
									style: { left: at(tickFraction(value)) },
								}),
							),
							cross,
							...visible.map((point) => {
								const fx = fractionX(point);
								const fy = fractionY(point);
								const shade = shadeOf(point);
								return h(
									'div',
									{
										key: point.route,
										className: 'gdcc_ovPointAnchor',
										style: { left: at(fx), bottom: at(fy) },
									},
									[
										h('i', {
											key: 'dot',
											className:
												modelHover !== null && modelHover.includes(point.route)
													? 'gdcc_ovPoint gdcc_ovPoint--on'
													: 'gdcc_ovPoint',
											style: { width: BUBBLE + 'px', height: BUBBLE + 'px', background: shade },
										}),
										h(
											'span',
											{ key: 'label', className: 'gdcc_ovPointLabel', style: labelStyle },
											shortModelName(point.route, LABEL_MAX),
										),
									],
								);
							}),
							tip,
							...yTicks.map((value, index) =>
								h(
									'span',
									{
										key: 'ytick' + index,
										className: 'gdcc_ovScatterTick gdcc_ovScatterTick--y',
										style: { bottom: at(value / yMax) },
									},
									compactTokens(value),
								),
							),
							...xTicks.map((value, index) =>
								h(
									'span',
									{
										key: 'xtick' + index,
										className: 'gdcc_ovScatterTick gdcc_ovScatterTick--x',
										style: { left: at(tickFraction(value)) },
									},
									shortMoneyText(money(microsOf(value)), false),
								),
							),
						],
					),
					h('span', { key: 'titleX', className: 'gdcc_ovScatterTitle gdcc_ovScatterTitle--x' }, t('scatterAxisX')),
				]),
				legend,
			]);
		}

		function sessionsCard() {
			const open = typeof openSession === 'function' ? openSession : null;
			return h('section', { key: 'sessions', className: 'gdcc_ovCard' }, [
				h('div', { key: 'head', className: 'gdcc_ovCardHead' }, [
					h('h2', { key: 'title', className: 'gdcc_ovCardTitle' }, t('sessionsTitle')),
				]),
				h(
					'div',
					{ key: 'rows', className: 'gdcc_ovSessions' },
					data.sessions.map((session) =>
						h(
							open === null ? 'div' : 'button',
							{
								key: session.id,
								type: open === null ? undefined : 'button',
								className: 'gdcc_ovSessionRow',
								title: open === null ? undefined : t('sessionOpenHint'),
								onClick: open === null ? undefined : () => open(session.id),
							},
							[
								h('div', { key: 'main', className: 'gdcc_ovSessionMain' }, [
									h(
										'span',
										{ key: 'title', className: 'gdcc_ovSessionTitle' },
										session.title ?? t('sessionUntitled'),
									),
									h(
										'span',
										{ key: 'meta', className: 'gdcc_ovMuted' },
										beijingTime(session.createdAt) +
											(session.routes.length > 0 ? ' · ' + session.routes.join(', ') : ''),
									),
								]),
								h(
									'span',
									{ key: 'cost', className: 'gdcc_ovSessionCost' },
									money(session.totalMicros),
								),
							],
						),
					),
				),
			]);
		}

		function notesCard() {
			const scope =
				data.range === 'custom'
					? t('noteScopeCustom', { start: data.start, end: data.end })
					: rangeLabel(data.range);
			const notes = [
				t('noteRate', { rate: String(cnyPerUsd) }),
				t('noteScope', { range: scope }),
				t('noteSource'),
			];
			if (data.view.unpricedTokens > 0)
				notes.push(t('noteUnpriced', { count: formatExactTokens(data.view.unpricedTokens) }));
			return h('section', { key: 'notes', className: 'gdcc_ovCard gdcc_ovNotesCard' }, [
				h('h2', { key: 'title', className: 'gdcc_ovCardTitle' }, t('notesTitle')),
				h(
					'ul',
					{ key: 'list', className: 'gdcc_ovNotes' },
					notes.map((note) => h('li', { key: note }, note)),
				),
			]);
		}
	}

	return CostOverviewPage;
}