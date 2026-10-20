import { buildCostView } from '../pricing.js';
import { configStamp, readConfig } from './config-store.js';
import { createCostUsageProjection } from './projection.js';
import { createSessionLogs } from './session-log.js';
import {
	RANGE_DAYS,
	addRangeState,
	buildTimeOfDay,
	buildTrend,
	dayCount,
	emptyAccounting,
	inRange,
	mergeTrend,
	rangeBounds,
	rangeDays,
	routeRows,
	sessionRows,
	totalsOf,
} from './overview-data.js';

const SESSION_CACHE_LIMIT = 500;
const TOP_SESSIONS = 8;
/** Months are the readable unit once a year of days no longer fits. */
const MONTH_THRESHOLD_DAYS = 60;

/** Send one JSON response. */
function respond(res, status, payload) {
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	});
	res.end(JSON.stringify(payload));
}

/** A session header record needs an id to be addressable. */
function headerOf(record) {
	return record?.header?.id ? record.header : null;
}

/**
 * Fold one persisted session once and reuse the state until its log changes.
 * Live sessions are projected on every request by the host, so they are never
 * cached here. Log files are read directly: replaying every event through the
 * host query service takes about a minute for a large history.
 */
async function statesOf(sessionQuery, definition, { cache, liveStateOf, logs }) {
	const records = await sessionQuery.listSessions();
	const locations = logs.locate();
	const live = new Set();
	for (const record of records) if (record?.live) live.add(record.header.id);
	for (const id of live) cache.delete(id);
	const entries = [];
	const titles = new Map();
	for (const record of records) {
		const header = headerOf(record);
		if (header === null) continue;
		if (record.live) {
			const state = liveStateOf?.(header.id) ?? (await foldHost(sessionQuery, definition, header.id));
			entries.push({ header, state });
			continue;
		}
		const location = locations.get(header.id);
		const stamp = location === undefined ? null : logs.stampOf(location);
		const cached = cache.get(header.id);
		if (cached !== undefined && cached.stamp === stamp) {
			entries.push({ header, state: cached.state });
			if (cached.title !== undefined) titles.set(header.id, cached.title);
			continue;
		}
		let entry = null;
		if (location !== undefined) {
			const folded = await logs.foldCached(header.id, location, stamp, definition, 'cost');
			if (folded !== null) entry = { stamp, state: folded.state, title: folded.title };
		}
		if (entry === null) {
			const state = await foldHost(sessionQuery, definition, header.id);
			if (state === null) continue;
			entry = { stamp, state, title: undefined };
		}
		if (stamp !== null) {
			cache.set(header.id, entry);
			if (cache.size > SESSION_CACHE_LIMIT) cache.delete(cache.keys().next().value);
		}
		entries.push({ header, state: entry.state });
		if (typeof entry.title === 'string') titles.set(header.id, entry.title);
	}
	return { entries, titles };
}

/** Replay a session's events through the host query service. */
async function foldHost(sessionQuery, definition, id) {
	try {
		const snapshot = await sessionQuery.readSession(id);
		let state = definition.init();
		for (const event of snapshot?.events ?? []) state = definition.apply(state, event);
		return state;
	} catch {
		return null;
	}
}

/** Add the titles of the displayed sessions, when they can be resolved. */
async function fillTitles(sessionQuery, rows, titles, logs) {
	const locations = logs.locate();
	const remaining = [];
	for (const row of rows) {
		if (titles.has(row.id)) continue;
		const location = locations.get(row.id);
		const title = location === undefined ? undefined : await logs.titleOf(location);
		if (typeof title === 'string') titles.set(row.id, title);
		else remaining.push(row.id);
	}
	if (remaining.length === 0 || typeof sessionQuery.readTitleSnapshots !== 'function') return;
	try {
		const snapshots = await sessionQuery.readTitleSnapshots(remaining);
		for (const snapshot of snapshots ?? []) {
			const raw = snapshot?.status === 'fulfilled' ? snapshot.value?.title : undefined;
			// The host reports an immutable title snapshot, not a bare string.
			const title = typeof raw === 'string' ? raw : raw?.title;
			if (typeof title === 'string' && title !== '') titles.set(snapshot.sessionId, title);
		}
	} catch {
		// Titles are optional: the page falls back to the session id.
	}
}

/** Display currency: the configured one, else the currency of the configured rates. */
function displayCurrency(config, view) {
	if (config.currency === 'USD' || config.currency === 'CNY') return config.currency;
	return view.amounts.some((entry) => entry.currency === 'CNY') ? 'CNY' : 'USD';
}

/** Build the whole overview payload from the selected session states. */
export function buildOverview({ entries, config, range, start = null, end = null, now = Date.now(), titles = new Map(), calendars = {}, rows: givenRows }) {
	const bounds = rangeBounds(range, { start, end }, now);
	const accounting = totalsOf(entries.reduce((sum, entry) => addRangeState(sum, entry.state, bounds.start, bounds.end), emptyAccounting(calendars)));
	const view = buildCostView(accounting, config);
	const dates = new Set();
	for (const buckets of Object.values(accounting.byTime))
		for (const key of Object.keys(buckets)) if (key !== 'unknown') dates.add(key.slice(0, 10));
	const granularity = range === 'all' && dates.size > MONTH_THRESHOLD_DAYS ? 'month' : 'day';
	const trend = mergeTrend(buildTrend(accounting, config, granularity));
	const allRows = givenRows ?? sessionRows(entries, config, bounds.start, bounds.end, calendars);
	const rows = allRows.slice(0, TOP_SESSIONS);
	return {
		generatedAt: now,
		range,
		start: bounds.start,
		end: bounds.end,
		currency: displayCurrency(config, view),
		cnyPerUsd: config.cnyPerUsd,
		days: (range === 'custom' ? dayCount(start, end) : rangeDays(range)) ?? Math.max(dates.size, 1),
		granularity,
		view: {
			totalMicros: view.totalMicros,
			totalTokens: view.totalTokens,
			tokens: view.tokens,
			bucketMicros: view.bucketMicros,
			amounts: view.amounts,
			cacheHitPct: view.cacheHitPct,
			unpricedTokens: view.unpricedTokens,
			uncertainTokens: view.uncertainTokens,
			peakTokens: view.peakTokens,
			offPeakTokens: view.offPeakTokens,
			routes: view.routes,
		},
		counts: {
			sessions: entries.length,
			activeSessions: allRows.length,
			pricedRoutes: view.routes.filter((route) => route.priced).length,
		},
		trend,
		models: routeRows(accounting, config),
		timeOfDay: buildTimeOfDay(accounting, config),
		sessions: rows.map((row) => ({ ...row, title: titles.get(row.id) ?? null })),
	};
}

/** True for a real calendar date in YYYY-MM-DD form. */
function isDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const time = Date.parse(value + 'T00:00:00Z');
	return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Load the holiday calendars of every year the selected states date into. */
async function ensureCalendars(holidays, entries, bounds) {
	if (holidays === undefined) return {};
	const years = new Set();
	for (const { state } of entries)
		for (const buckets of Object.values(state?.byTime ?? {}))
			for (const key of Object.keys(buckets))
				if (inRange(key, bounds.start, bounds.end)) years.add(Number(key.slice(0, 4)));
	await Promise.all([...years].map((year) => holidays.ensure(year)));
	return holidays.snapshot();
}

/** Serve the aggregated cost overview of every session. */
export function createOverviewHandler(connection, sessionQuery, holidays, liveStateOf, sessionLogs, overviewCache) {
	const cache = new Map();
	const logs = sessionLogs ?? createSessionLogs({ onError: () => {} });
	return async (req, res) => {
		const rejection = connection.requestRejection(req);
		if (rejection !== undefined) {
			respond(res, rejection, { error: rejection === 401 ? 'authentication required' : 'forbidden' });
			return;
		}
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			respond(res, 405, { error: 'method not allowed' });
			return;
		}
		let range;
		let start = null;
		let end = null;
		let refresh = false;
		try {
			const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
			refresh = params.get('refresh') === '1';
			if (params.has('start') || params.has('end')) {
				start = params.get('start');
				end = params.get('end');
				if (!isDate(start) || !isDate(end) || end < start) {
					respond(res, 400, { error: 'invalid date range' });
					return;
				}
				range = 'custom';
			} else {
				range = params.get('days') ?? '30';
			}
		} catch {
			respond(res, 400, { error: 'invalid query' });
			return;
		}
		// A custom range needs both dates; a named range must be an own property.
		if (range === 'custom' ? !isDate(start) || !isDate(end) : !Object.hasOwn(RANGE_DAYS, range)) {
			respond(res, 400, { error: 'unsupported range' });
			return;
		}
		try {
			const config = readConfig(true);
			const stamp = configStamp();
			if (range !== 'custom' && !refresh) {
				const cached = overviewCache?.read(range, stamp);
				if (cached !== null && cached !== undefined) {
					// Mark the payload so the page can show the cache badge.
					respond(res, 200, { ...cached, cached: true });
					return;
				}
			}
			const definition = createCostUsageProjection(() => config, holidays);
			const { entries, titles } = await statesOf(sessionQuery, definition, { cache, liveStateOf, logs });
			const now = Date.now();
			const bounds = rangeBounds(range, { start, end }, now);
			const calendars = await ensureCalendars(holidays, entries, bounds);
			// Rank the sessions once: the title lookup and the payload share the rows.
			const allRows = sessionRows(entries, config, bounds.start, bounds.end, calendars);
			await fillTitles(sessionQuery, allRows.slice(0, TOP_SESSIONS), titles, logs);
			const payload = buildOverview({ entries, config, range, start, end, now, titles, calendars, rows: allRows });
			if (range !== 'custom') overviewCache?.write(range, stamp, payload);
			respond(res, 200, payload);
		} catch (error) {
			respond(res, 503, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}