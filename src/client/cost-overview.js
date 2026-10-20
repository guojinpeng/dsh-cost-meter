import { HTTP_BASE } from '../identity.js';
import { formatMoney, formatExactTokens } from './format.js';

/** Selectable ranges, in display order. */
const RANGES = ['today', '7', '30', '90', 'all'];
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
		const [hover, setHover] = react.useState(null);
		const [timeHover, setTimeHover] = react.useState(null);

		react.useEffect(() => {
			if (store.getSnapshot() === null) store.load().catch(() => {});
		}, []);
		const customActive = custom.start !== '' || custom.end !== '';
		const customReady = isDate(custom.start) && isDate(custom.end) && custom.end >= custom.start;

		react.useEffect(() => {
			// A half-filled or inverted date range waits for a valid pair.
			if (customActive && !customReady) return undefined;
			let alive = true;
			// A manual refresh bypasses the five minute server cache once.
			const wantRefresh = force;
			if (force) setForce(false);
			setState((current) => ({ ...current, status: 'loading', error: null }));
			const query = customActive
				? 'start=' + custom.start + '&end=' + custom.end
				: 'days=' + (range === '' ? '30' : range);
			const suffix = wantRefresh && !customActive ? '&refresh=1' : '';
			fetch(HTTP_BASE + '/overview?' + query + suffix)
				.then(async (response) => {
					const payload = await response.json();
					if (!response.ok) throw new Error(payload?.error ?? 'HTTP ' + response.status);
					return payload;
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
		react.useEffect(() => {
			setHover(null);
			setTimeHover(null);
		}, [range, nonce]);

		const data = state.data;
		const view = data?.view;
		const currency = snapshot?.config?.currency ?? data?.currency ?? 'CNY';
		const cnyPerUsd = snapshot?.config?.cnyPerUsd ?? data?.cnyPerUsd ?? 7.2;
		const money = (micros) => formatMoney(micros, currency, cnyPerUsd);
		const loading = state.status === 'loading' && data === null;
		const refreshing = state.status === 'loading' && data !== null;
		// A failed refresh keeps the previous payload and still reports the error.
		const failed = state.status === 'error';

		const cachedBadge =
			data?.cached === true
				? h('div', { key: 'cache', className: 'gdcc_ovCache' }, [
						h('span', { key: 'dot', className: 'gdcc_ovCacheDot' }),
						h('span', { key: 'label', className: 'gdcc_ovCacheLabel' }, t('costPageCached')),
						h('div', { key: 'card', className: 'gdcc_ovCacheCard', role: 'tooltip' }, [
							h('strong', { key: 'title', className: 'gdcc_ovCacheCardTitle' }, t('costPageCachedTitle')),
							h('p', { key: 'text', className: 'gdcc_ovCacheText' }, t('costPageCachedHint')),
						]),
					])
				: null;
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
				cachedBadge,
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
						: t('costPageMeta', { time: beijingTime(data.generatedAt, true) }),
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
			const average = view.totalMicros / Math.max(data.days, 1);
			return h(
				'div',
				{ key: 'kpi', className: 'gdcc_ovKpis' },
				kpiCard(
					'cost',
					t('kpiTotalCost'),
					money(view.totalMicros),
					t('kpiAvgPerDay', { amount: money(average) }),
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
			const tip = hover !== null && hover.index < units.length ? hover : null;
			const format = (value) => (metric === 'money' ? money(value) : compactTokens(value));
			const columnLabel = (value) =>
				metric === 'money' ? shortMoneyText(money(value), thin) : compactTokens(value);
			const bars = units.map((unit, index) =>
				h(
					'div',
					{
						key: unit.key,
						className: 'gdcc_ovBarColumn',
						onMouseEnter: () => setHover({ index, left: 0, top: 0 }),
					},
					[
						// The total sits on the top of its own column, so the labels
						// follow the bar heights instead of sharing one baseline.
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
				tip === null || units[tip.index] === undefined
					? null
					: h('div', { key: 'tip', className: 'gdcc_ovTip', style: { left: tip.left + 'px', top: tip.top + 'px' } }, [
							h('div', { key: 'date', className: 'gdcc_ovTipHead' }, tipLabel(units[tip.index])),
							...SERIES.map((series) =>
								h('div', { key: series.key, className: 'gdcc_ovTipRow' }, [
									h('i', { key: 'dot', className: 'gdcc_ovDot gdcc_ovBarSeg--' + series.key }),
									h('span', { key: 'label', className: 'gdcc_ovTipLabel' }, t(series.labelKey)),
									h(
										'span',
										{ key: 'value', className: 'gdcc_ovTipValue' },
										format(values[tip.index][series.key]),
									),
									h(
										'span',
										{ key: 'share', className: 'gdcc_ovTipShare' },
										percent(share(values[tip.index][series.key], totals[tip.index])),
									),
								]),
							),
							h('div', { key: 'total', className: 'gdcc_ovTipTotal' }, [
								h('span', { key: 'label' }, t('totalLabel')),
								h('strong', { key: 'value' }, format(totals[tip.index])),
							]),
						]);
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
						),
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
								setHover((current) => (current === null ? current : { index: current.index, left, top }));
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
			// The ring, the trend and the time-of-day bars all show cost shares, so
			// the ring must not switch to token shares when tokens are cheap.
			const cost = entries.reduce((sum, entry) => sum + entry.micros, 0);
			const unit = (entry) => (cost > 0 ? entry.micros : entry.value);
			const whole = cost > 0 ? cost : total;
			let cursor = 0;
			const stops = entries.map((entry) => {
				const from = cursor;
				cursor += share(unit(entry), whole);
				return `var(--gdcc-ov-${entry.key}) ${from}% ${cursor}%`;
			});
			return h('section', { key: 'composition', className: 'gdcc_ovCard' }, [
				h('div', { key: 'head', className: 'gdcc_ovCardHead' }, [
					h('h2', { key: 'title', className: 'gdcc_ovCardTitle' }, t('compositionTitle')),
					h('span', { key: 'hint', className: 'gdcc_ovMuted' }, t('compositionHint')),
				]),
				h('div', { key: 'body', className: 'gdcc_ovComposition' }, [
					h('div', {
						key: 'donut',
						className: 'gdcc_ovDonut',
						style: { background: `conic-gradient(${stops.join(', ')})` },
					}, [
						h('div', { key: 'hole', className: 'gdcc_ovDonutHole' }, [
							h('strong', { key: 'cost', className: 'gdcc_ovDonutCost' }, money(view.totalMicros)),
							h('span', { key: 'value' }, compactTokens(total)),
							h('span', { key: 'unit', className: 'gdcc_ovMuted' }, 'token'),
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
			// Every row fills the track: the widths are shares of that row's own
			// cost, not of the largest row.
			const rows = data.timeOfDay;
			const segmentLabel = (segment) => t('segment' + segment[0].toUpperCase() + segment.slice(1));
			const hovered = timeHover !== null && rows[timeHover.index] !== undefined ? rows[timeHover.index] : null;
			const tip =
				hovered === null
					? null
					: h(
							'div',
							{
								key: 'tip',
								className: 'gdcc_ovTip gdcc_ovTimeTip',
								style: { left: timeHover.left + 'px', top: timeHover.top + 'px' },
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
											money(hovered.bucketMicros?.[series.key] ?? 0),
										),
										h(
											'span',
											{ key: 'share', className: 'gdcc_ovTipShare' },
											percent(share(hovered.bucketMicros?.[series.key] ?? 0, hovered.totalMicros)),
										),
									]),
								),
								h('div', { key: 'total', className: 'gdcc_ovTipTotal' }, [
									h('span', { key: 'label' }, t('totalLabel')),
									h('strong', { key: 'value' }, money(hovered.totalMicros)),
								]),
							],
						);
			return h('section', { key: 'time', className: 'gdcc_ovCard' }, [
				h('div', { key: 'head', className: 'gdcc_ovCardHead' }, [
					h('h2', { key: 'title', className: 'gdcc_ovCardTitle' }, t('timeOfDayTitle')),
					h('span', { key: 'hint', className: 'gdcc_ovMuted' }, t('timeOfDayHint')),
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
							setTimeHover((current) => (current === null ? current : { index: current.index, left, top }));
						},
					},
					[
						...rows.map((row, index) =>
							h(
								'div',
								{
									key: row.segment,
									className: 'gdcc_ovTimeRow',
									onMouseEnter: () => setTimeHover({ index, left: 0, top: 0 }),
								},
								[
									h('span', { key: 'label', className: 'gdcc_ovTimeLabel' }, segmentLabel(row.segment)),
									h(
										'span',
										{ key: 'track', className: 'gdcc_ovTrack' },
										SERIES.map((series) => {
											const value = row.bucketMicros?.[series.key] ?? 0;
											return value > 0
												? h('i', {
														key: series.key,
														className: 'gdcc_ovTrackSeg gdcc_ovBarSeg--' + series.key,
														style: { width: share(value, row.totalMicros) + '%' },
													})
												: null;
										}),
									),
									h('span', { key: 'value', className: 'gdcc_ovTimeValue' }, money(row.totalMicros)),
								],
							),
						),
						tip,
					],
				),
			]);
		}

		function modelsCard() {
			const routes = (data.models ?? view.routes).filter((route) => route.totalTokens > 0);
			const total = routes.reduce((sum, route) => sum + route.micros, 0);
			const unpriced = routes.some((route) => !route.priced);
			return h('section', { key: 'models', className: 'gdcc_ovCard' }, [
				h('div', { key: 'head', className: 'gdcc_ovCardHead' }, [
					h('h2', { key: 'title', className: 'gdcc_ovCardTitle' }, t('modelsTitle')),
					unpriced
						? h('span', { key: 'warning', className: 'gdcc_ovMuted' }, t('modelsUnpriced'))
						: h('span', { key: 'hint', className: 'gdcc_ovMuted' }, t('modelsHintShare')),
				]),
				h('div', { key: 'table', className: 'gdcc_ovTable' }, [
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
										style: { width: share(route.micros, total) + '%' },
									}),
								),
								h('span', { key: 'share', className: 'gdcc_ovMuted' }, percent(share(route.micros, total))),
							),
						]);
					}),
				]),
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