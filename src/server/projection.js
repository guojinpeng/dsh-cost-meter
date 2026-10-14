import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client';
import { tokensOf, buildCostView } from '../pricing.js';
import { PROJECTION_KEY } from '../identity.js';
import { readConfig } from './config-store.js';
import { stateSchema, viewSchema } from './schemas.js';
import { timeBucket } from '../time-of-use.js';
import {
	zeroBuckets,
	bucketsFrom,
	bucketsEqual,
	bucketsAdd,
	bucketsReplace,
	messageRoute,
	routeKey,
	usageOf,
	compactEvent,
	recoverBuckets,
} from './usage-events.js';

const TURN_RETENTION = 200;

/** Initial projection state. */
function initialState() {
	return {
		totals: zeroBuckets(),
		byRoute: {},
		byTime: {},
		last: null,
		buffer: [],
		bufferTurn: null,
		turns: {},
		skippedTurns: 0,
	};
}

/** Drop turns that fell out of the retention window. */
function trimTurns(turns, currentTurn) {
	const keys = Object.keys(turns);
	if (keys.length <= TURN_RETENTION + 40) return turns;
	const kept = {};
	for (const key of keys) {
		const turn = Number(key);
		if (Number.isFinite(turn) && turn >= currentTurn - TURN_RETENTION) kept[key] = turns[key];
	}
	return kept;
}

/** Move a bucket in or out of one route's share of the session totals. */
function shiftByRoute(byRoute, key, buckets, sign) {
	const current = byRoute[key] ?? zeroBuckets();
	const next = {
		uncachedInputTokens: Math.max(0, current.uncachedInputTokens + sign * buckets.uncachedInputTokens),
		outputTokens: Math.max(0, current.outputTokens + sign * buckets.outputTokens),
		cacheReadTokens: Math.max(0, current.cacheReadTokens + sign * buckets.cacheReadTokens),
		cacheWriteTokens: Math.max(0, current.cacheWriteTokens + sign * buckets.cacheWriteTokens),
	};
	const result = { ...byRoute };
	if (tokensOf(next) === 0) delete result[key];
	else result[key] = next;
	return result;
}

function shiftByTime(byTime, key, time, buckets, sign) {
	const next = shiftByRoute(byTime[key] ?? {}, time, buckets, sign);
	const result = { ...byTime, [key]: next };
	if (!Object.keys(next).length) delete result[key];
	return result;
}

/** Append one event to the turn buffer that feeds the official fold. */
function appendBuffer(state, compact) {
	if (compact === null) return state;
	const turn = compact.data.turn;
	if (state.bufferTurn !== null && turn !== state.bufferTurn)
		return { ...state, buffer: [compact], bufferTurn: turn };
	return { ...state, buffer: [...state.buffer, compact], bufferTurn: turn };
}

/**
 * Fold one usage sample into the session totals and the route partition.
 *
 * This is the official `tokenUsageProjectionDefinition` rule — a new sample for
 * the same (turn, step) replaces the previous one — plus the route the sample
 * belongs to, so `byRoute` stays a partition of `totals`.
 */
function applySample(state, event) {
	const sample = usageOf(event);
	if (sample === undefined) return state;
	const turn = event.data?.turn;
	const step = event.data?.step;
	if (typeof turn !== 'number' || typeof step !== 'number') return state;
	const buckets = bucketsFrom(sample);
	const route = event.type === 'assistant/message' ? messageRoute(event.data.message) : null;
	const previous =
		state.last !== null && state.last.turn === turn && state.last.step === step ? state.last : null;
	const nextRoute = route ?? previous?.route ?? null;
	const time = timeBucket(event.time);
	if (
		previous !== null &&
		bucketsEqual(previous.buckets, buckets) &&
		routeKey(previous.route) === routeKey(nextRoute) &&
		previous.time === time
	) {
		return state;
	}
	let totals = state.totals;
	let byRoute = state.byRoute;
	let byTime = state.byTime;
	if (previous !== null) {
		totals = bucketsReplace(totals, previous.buckets, buckets);
		byRoute = shiftByRoute(byRoute, routeKey(previous.route), previous.buckets, -1);
		byTime = shiftByTime(byTime, routeKey(previous.route), previous.time, previous.buckets, -1);
	} else {
		totals = bucketsAdd(totals, buckets);
	}
	byRoute = shiftByRoute(byRoute, routeKey(nextRoute), buckets, 1);
	byTime = shiftByTime(byTime, routeKey(nextRoute), time, buckets, 1);
	return {
		...state,
		totals,
		byRoute,
		byTime,
		last: { turn, step, buckets, route: nextRoute, time },
	};
}

/** Use the official fold for each attempt, preserving its model attribution. */
function turnBucketsByRoute(events) {
	let byRoute = {};
	let byTime = {};
	let attempt = [];
	for (const event of events) {
		if (event.type === 'step/start' || event.type === 'llm/retry-started') attempt = [];
		if (
			event.type === 'assistant/message' ||
			event.type === 'assistant/attempt' ||
			event.type === 'llm/retry'
		) {
			attempt.push({ ...event, data: { ...event.data, turn: 1, step: 1 } });
		}
		if (event.type !== 'llm/retry' && event.type !== 'step/end') continue;
		if (attempt.length === 0) continue;
		const aggregate = deriveTurnTokenUsage([
			{ type: 'turn/start', data: { turn: 1 } },
			{ type: 'step/start', data: { turn: 1, step: 1 } },
			...attempt,
			{ type: 'step/end', data: { turn: 1, step: 1 } },
			{ type: 'turn/end', data: { turn: 1 } },
		]);
		if (aggregate !== undefined) {
			const key = routeKey(aggregate.routes?.[0]);
			byRoute = shiftByRoute(byRoute, key, recoverBuckets(aggregate).buckets, 1);
			const settlement =
				attempt.findLast((item) => item.type === 'assistant/message') ??
				attempt.findLast((item) => item.type === 'assistant/attempt');
			byTime = shiftByTime(byTime, key, timeBucket(settlement?.time), recoverBuckets(aggregate).buckets, 1);
		}
		attempt = [];
	}
	return { byRoute, byTime };
}

/** Close the buffered turn with the official fold and price it. */
function settleTurn(state, event) {
	const turn = typeof event.data?.turn === 'number' ? event.data.turn : state.bufferTurn;
	const cleared = { ...state, buffer: [], bufferTurn: null };
	if (turn === null || state.buffer.length === 0) {
		return { ...cleared, skippedTurns: state.skippedTurns + 1 };
	}
	const aggregate = deriveTurnTokenUsage(state.buffer);
	if (aggregate === undefined) return { ...cleared, skippedTurns: state.skippedTurns + 1 };
	const { buckets, recovered } = recoverBuckets(aggregate);
	const entry = {
		totalTokens: aggregate.totalTokens,
		tokens: buckets,
		...turnBucketsByRoute(state.buffer),
		recovered,
	};
	return {
		...cleared,
		turns: trimTurns({ ...state.turns, [String(turn)]: entry }, turn),
	};
}

/**
 * Fold one session event into the projection state.
 *
 * Session totals follow `tokenUsageProjectionDefinition`; each turn is priced
 * from the official `deriveTurnTokenUsage` fold of that turn's events, so the
 * chip agrees with the built-in per-turn usage pill.
 */
function applyToState(state, event) {
	const type = typeof event?.type === 'string' ? event.type : '';

	if (type === 'turn/start') {
		const turn = typeof event.data?.turn === 'number' ? event.data.turn : null;
		const compact = compactEvent(event);
		return { ...state, buffer: compact === null ? [] : [compact], bufferTurn: turn };
	}

	if (type === 'turn/end') return settleTurn(appendBuffer(state, compactEvent(event)), event);

	const sampled = applySample(appendBuffer(state, compactEvent(event)), event);

	// A retry invalidates the provisional sample of the same attempt.
	if (type === 'llm/retry-started') {
		if (
			sampled.last === null ||
			sampled.last.turn !== event.data?.turn ||
			sampled.last.step !== event.data?.step
		) {
			return sampled;
		}
		return { ...sampled, last: null };
	}
	return sampled;
}

/**
 * Build the projection definition.
 *
 * The wire view is memoised per state object: the registry only forwards a
 * change when `Object.is(previous, next)` is false, so an unchanged state must
 * map to an unchanged view. Because the config file can change while the state
 * does not, the memo also remembers the configuration signature and rebuilds
 * when it moves.
 */
export function createCostUsageProjection(readResolvedConfig = readConfig, holidays) {
	const readConfigNow = typeof readResolvedConfig === 'function' ? readResolvedConfig : () => readConfig();
	const views = new WeakMap();
	return {
		key: PROJECTION_KEY,
		stateVersion: 3,
		stateSchema,
		init: () => initialState(),
		apply: (state, event) => {
			try {
				return applyToState(state, event);
			} catch {
				return state;
			}
		},
		wire: {
			viewSchema,
			view: (state) => {
				const resolved = readConfigNow();
				for (const times of Object.values(state.byTime))
					for (const key of Object.keys(times))
						if (key !== 'unknown') holidays?.ensure(Number(key.slice(0, 4)));
				const calendars = holidays?.snapshot() ?? {};
				const signature = configSignature(resolved) + JSON.stringify(calendars);
				const cached = views.get(state);
				if (cached !== undefined && cached.signature === signature) return cached.view;
				const accounting = {
					totals: state.totals,
					byRoute: state.byRoute,
					byTime: state.byTime,
					calendars,
					turns: state.turns,
					skippedTurns: state.skippedTurns,
				};
				const built = viewSchema.parse({ ...buildCostView(accounting, resolved), accounting });
				views.set(state, { signature, view: built });
				return built;
			},
		},
	};
}

/** A cheap identity for the configuration values that change the wire view. */
function configSignature(config) {
	return JSON.stringify([
		config.currency,
		config.cnyPerUsd,
		config.showDockChip,
		config.showTurnChip,
		config.pricing,
	]);
}
