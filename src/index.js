/**
 * Cost projection and configuration endpoint for DSH.
 * Store token buckets by model; price session and turn views from live config.
 * Rates are USD per million tokens; wire amounts are rounded micro-USD.
 * Config: <DSH_HOME or ~/.dsh>/dsh-cost-meter/config.json.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { normalizeRate, tokensOf, buildCostView } from './pricing.js';
import { createHistoryModels } from './history.js';
import { createModelsDev } from './models-dev.js';
import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm';
// The official per-turn fold. Imported rather than re-derived, so a finished turn
// prices exactly the numbers the built-in usage pill shows. Resolves through the
// host application's package root, the same way the bundled token-meter does.
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client';

/** Cordis services required by {@link apply}. */
export const inject = ['sessionProjections'];

/** Plugin id used in logs. */
export const name = 'dsh-cost-meter';

/** The projection key exposed on the wire. */
const PROJECTION_KEY = 'costUsage';

/** How many finished turns stay addressable by the client. */
const TURN_RETENTION = 200;

/** Same-origin route carrying the config file (GET reads, POST writes). */
const CONFIG_ROUTE = '/dsh-cost-meter/config';

/** Upper bound for a POSTed config body. */
const MAX_BODY_BYTES = 1024 * 1024;

/** How often a config read may stat the file (milliseconds). */
const STAT_INTERVAL_MS = 1000;

// #region config file store

/** Directory name under the DSH home, matching the package name. */
const CONFIG_DIR_NAME = 'dsh-cost-meter';

/** Config file name under {@link CONFIG_DIR_NAME}. */
const CONFIG_FILE_NAME = 'config.json';

/**
 * Resolve the DSH home directory with the official precedence:
 * `$DSH_HOME` when set and non-empty, otherwise `~/.dsh`.
 * Mirrors `@deepseek-ai/dsh-home-paths` `resolveDshHome` without depending on it,
 * so installing this plugin never adds an npm dependency.
 */
function resolveDshHome(env = process.env) {
	const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
	if (configured !== '') return configured;
	return join(homedir(), '.dsh');
}

/** Absolute path of the unified config file. */
const CONFIG_PATH = join(resolveDshHome(), CONFIG_DIR_NAME, CONFIG_FILE_NAME);

/** Coerce any parsed JSON value into a complete configuration object. */
function normalizeConfig(raw) {
	const source = raw !== null && typeof raw === 'object' ? raw : {};
	const currency =
		typeof source.currency === 'string' && source.currency.trim() !== '' ? source.currency.trim() : 'CNY';
	const cnyPerUsd = Number(source.cnyPerUsd);
	const pricing = {};
	const rawPricing = source.pricing !== null && typeof source.pricing === 'object' ? source.pricing : {};
	for (const [key, entry] of Object.entries(rawPricing)) {
		const trimmed = typeof key === 'string' ? key.trim() : '';
		if (trimmed === '') continue;
		const rate = normalizeRate(entry);
		if (rate !== null) pricing[trimmed] = rate;
	}
	return {
		formatVersion: source.formatVersion === 2 ? 2 : 1,
		currency,
		cnyPerUsd: Number.isFinite(cnyPerUsd) && cnyPerUsd > 0 ? cnyPerUsd : 7.2,
		showDockChip: source.showDockChip !== false,
		showTurnChip: source.showTurnChip !== false,
		pricing,
	};
}

/** The mtime/size-cached config plus the parsed snapshot. */
let configCache = null;
let lastStatAt = 0;

/** Read the config file, honouring the mtime/size cache. */
export function readConfig(force = false) {
	const now = Date.now();
	if (!force && configCache !== null && now - lastStatAt < STAT_INTERVAL_MS) return configCache.config;
	lastStatAt = now;
	try {
		const stats = statSync(CONFIG_PATH);
		if (!force && configCache !== null && stats.mtimeMs === configCache.mtimeMs && stats.size === configCache.size) {
			return configCache.config;
		}
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
		const config = normalizeConfig(parsed);
		configCache = { mtimeMs: stats.mtimeMs, size: stats.size, config };
		return config;
	} catch (error) {
		if (force) throw error;
		if (configCache !== null) return configCache.config;
		const config = normalizeConfig({});
		configCache = { mtimeMs: -1, size: -1, config };
		return config;
	}
}

/** Atomically replace the config file and refresh the cache. */
function writeConfig(config) {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	const tmp = `${CONFIG_PATH}.tmp-${String(process.pid)}`;
	writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
	renameSync(tmp, CONFIG_PATH);
	const stats = statSync(CONFIG_PATH);
	configCache = { mtimeMs: stats.mtimeMs, size: stats.size, config };
	lastStatAt = Date.now();
	return config;
}

/** Create an empty pricing configuration when it does not exist. */
function seedConfigFile(logger) {
	try {
		if (existsSync(CONFIG_PATH)) return;
		writeConfig(normalizeConfig({ formatVersion: 2 }));
	} catch (error) {
		logger?.warn(
			'dsh-cost-meter: could not seed config file',
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

// #endregion

// #region bucket helpers

/** An empty token bucket. */
function zeroBuckets() {
	return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

/** A usage field that is safe to accumulate. */
function countOf(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Normalise a provider usage payload into a bucket. */
function bucketsFrom(usage) {
	if (Number.isSafeInteger(usage?.totalTokens)) {
		return recoverBuckets({
			...usage,
			uncachedInputTokens: countOf(usage.inputTokens),
			outputTokens: countOf(usage.outputTokens),
		}).buckets;
	}
	return {
		uncachedInputTokens: countOf(usage?.inputTokens),
		outputTokens: countOf(usage?.outputTokens),
		cacheReadTokens: countOf(usage?.cacheReadTokens),
		cacheWriteTokens: countOf(usage?.cacheWriteTokens),
	};
}

/** Bucket equality, used to preserve state identity. */
function bucketsEqual(left, right) {
	return (
		left.uncachedInputTokens === right.uncachedInputTokens &&
		left.outputTokens === right.outputTokens &&
		left.cacheReadTokens === right.cacheReadTokens &&
		left.cacheWriteTokens === right.cacheWriteTokens
	);
}

/** Bucket addition. */
function bucketsAdd(left, right) {
	return {
		uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
		cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
		cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
	};
}

/** Replace one sample inside a running total, like the official projection. */
function bucketsReplace(total, previous, next) {
	return {
		uncachedInputTokens: total.uncachedInputTokens - previous.uncachedInputTokens + next.uncachedInputTokens,
		outputTokens: total.outputTokens - previous.outputTokens + next.outputTokens,
		cacheReadTokens: total.cacheReadTokens - previous.cacheReadTokens + next.cacheReadTokens,
		cacheWriteTokens: total.cacheWriteTokens - previous.cacheWriteTokens + next.cacheWriteTokens,
	};
}

// #region event reading

/** The route recorded on an assistant message. */
function messageRoute(message) {
	const source = message?.source;
	if (source === null || typeof source !== 'object') return null;
	const provider = typeof source.provider === 'string' ? source.provider : '';
	const model = typeof source.model === 'string' ? source.model : '';
	if (provider === '' || model === '') return null;
	return { provider, model };
}

/** A stable key for a route. */
function routeKey(route) {
	return route === null || route === undefined ? '' : `${route.provider}/${route.model}`;
}

/** The usage chunk carried by one settlement stream, if any. */
function streamUsageOf(stream) {
	if (stream === null || stream === undefined) return undefined;
	try {
		return lastAssistantStreamChunk(stream, 'usage')?.usage;
	} catch {
		return undefined;
	}
}

/**
 * The usage payload carried by an event.
 *
 * `assistant/message` supersedes the streamed attempt usage, and is the only
 * event a message route can be read from.
 */
function usageOf(event) {
	const type = event?.type;
	if (type === 'assistant/message' && event.data?.usage !== undefined) return event.data.usage;
	if (type !== 'assistant/message' && type !== 'assistant/attempt') return undefined;
	return streamUsageOf(event.data?.stream);
}

/**
 * Reduce a durable session event to the fields `deriveTurnTokenUsage` reads.
 *
 * The official fold is handed a turn-local slice of durable events. Keeping the
 * whole slice would pin message bodies and streams in the projection state, so
 * each event is compacted to its lifecycle numbers plus, for settlements, the
 * usage payload and the route-bearing source.
 *
 * @returns the compact event, or null for events the fold ignores.
 */
function compactEvent(event) {
	const type = event?.type;
	const data = event?.data ?? {};
	if (type === 'turn/start' || type === 'turn/end') {
		return typeof data.turn === 'number' ? { type, data: { turn: data.turn } } : null;
	}
	if (type === 'step/start' || type === 'step/end' || type === 'llm/retry' || type === 'llm/retry-started') {
		return typeof data.turn === 'number' && typeof data.step === 'number'
			? { type, data: { turn: data.turn, step: data.step } }
			: null;
	}
	if (type !== 'assistant/attempt' && type !== 'assistant/message') return null;
	if (typeof data.turn !== 'number' || typeof data.step !== 'number') return null;
	const compact = { turn: data.turn, step: data.step };
	if (data.usage !== undefined) compact.usage = data.usage;
	if (type === 'assistant/message') {
		const route = messageRoute(data.message);
		compact.message = { source: route ?? { provider: '', model: '' } };
	}
	const sample = streamUsageOf(data.stream);
	if (sample !== undefined) compact.stream = [{ type: 'chunk', chunk: { type: 'usage', usage: sample } }];
	return { type, data: compact };
}

// #endregion

// #region schemas

const int = z.number().int().nonnegative();

const bucketSchema = z
	.object({
		uncachedInputTokens: int,
		outputTokens: int,
		cacheReadTokens: int,
		cacheWriteTokens: int,
	})
	.strict();

const routeSchema = z.object({ provider: z.string(), model: z.string() }).strict();

const lastSlotSchema = z
	.object({ turn: int, step: int, buckets: bucketSchema, route: routeSchema.nullable() })
	.strict();

const turnRecordSchema = z
	.object({
		totalTokens: int,
		tokens: bucketSchema,
		byRoute: z.record(z.string(), bucketSchema),
		recovered: z.boolean(),
	})
	.strict();

/** Serialisable projection state. */
export const stateSchema = z
	.object({
		totals: bucketSchema,
		byRoute: z.record(z.string(), bucketSchema),
		last: lastSlotSchema.nullable(),
		buffer: z.array(z.any()),
		bufferTurn: z.number().int().nullable(),
		turns: z.record(z.string(), turnRecordSchema),
		skippedTurns: int,
	})
	.strict();

const wireTokensSchema = z.object({ input: int, output: int, read: int, write: int }).strict();

const wireTurnSchema = z
	.object({
		micros: int,
		totalTokens: int,
		route: z.string(),
		tokens: wireTokensSchema,
		bucketMicros: wireTokensSchema,
		priced: z.boolean(),
		recovered: z.boolean(),
	})
	.strict();

const wireRouteSchema = z.object({ route: z.string(), micros: int, totalTokens: int, priced: z.boolean() }).strict();

/** Client-facing projection view. */
export const viewSchema = z
	.object({
		accounting: z
			.object({
				totals: bucketSchema,
				byRoute: z.record(z.string(), bucketSchema),
				turns: z.record(z.string(), turnRecordSchema),
				skippedTurns: int,
			})
			.strict(),
		currency: z.string(),
		cnyPerUsd: z.number(),
		totalMicros: int,
		totalTokens: int,
		tokens: wireTokensSchema,
		bucketMicros: wireTokensSchema,
		cacheHitPct: z.number().nullable(),
		skippedTurns: int,
		unpricedTokens: int,
		showDock: z.boolean(),
		showTurn: z.boolean(),
		routes: z.array(wireRouteSchema),
		turns: z.record(z.string(), wireTurnSchema),
	})
	.strict();

// #endregion

// #region projection

/** Initial projection state. */
function initialState() {
	return {
		totals: zeroBuckets(),
		byRoute: {},
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

/** Append one event to the turn buffer that feeds the official fold. */
function appendBuffer(state, compact) {
	if (compact === null) return state;
	const turn = compact.data.turn;
	if (state.bufferTurn !== null && turn !== state.bufferTurn) return { ...state, buffer: [compact], bufferTurn: turn };
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
	const previous = state.last !== null && state.last.turn === turn && state.last.step === step ? state.last : null;
	const nextRoute = route ?? previous?.route ?? null;
	if (
		previous !== null &&
		bucketsEqual(previous.buckets, buckets) &&
		routeKey(previous.route) === routeKey(nextRoute)
	) {
		return state;
	}
	let totals = state.totals;
	let byRoute = state.byRoute;
	if (previous !== null) {
		totals = bucketsReplace(totals, previous.buckets, buckets);
		byRoute = shiftByRoute(byRoute, routeKey(previous.route), previous.buckets, -1);
	} else {
		totals = bucketsAdd(totals, buckets);
	}
	byRoute = shiftByRoute(byRoute, routeKey(nextRoute), buckets, 1);
	return {
		...state,
		totals,
		byRoute,
		last: { turn, step, buckets, route: nextRoute },
	};
}

/**
 * Complete the cache split of an official per-turn aggregate.
 *
 * A provider that omits cache attribution on one attempt makes the official
 * aggregate drop `cacheReadTokens`/`cacheWriteTokens` while keeping an exact
 * `totalTokens`. The prompt-side total is still known, so the missing split is
 * recovered from the aggregate's own numbers instead of pricing it as zero.
 */
function recoverBuckets(aggregate) {
	const input = aggregate.uncachedInputTokens;
	const output = aggregate.outputTokens;
	const prompt = Math.max(0, aggregate.totalTokens - output);
	let read = typeof aggregate.cacheReadTokens === 'number' ? aggregate.cacheReadTokens : null;
	let write = typeof aggregate.cacheWriteTokens === 'number' ? aggregate.cacheWriteTokens : null;
	const recovered = read === null || write === null;
	if (read === null && write === null) {
		read = Math.max(0, prompt - input);
		write = 0;
	} else if (read === null) {
		read = Math.max(0, prompt - input - write);
	} else if (write === null) {
		write = Math.max(0, prompt - input - read);
	}
	return {
		buckets: {
			uncachedInputTokens: input,
			outputTokens: output,
			cacheReadTokens: read,
			cacheWriteTokens: write,
		},
		recovered,
	};
}

/** Use the official fold for each attempt, preserving its model attribution. */
function turnBucketsByRoute(events) {
	let byRoute = {};
	let attempt = [];
	for (const event of events) {
		if (event.type === 'step/start' || event.type === 'llm/retry-started') attempt = [];
		if (event.type === 'assistant/message' || event.type === 'assistant/attempt' || event.type === 'llm/retry') {
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
		}
		attempt = [];
	}
	return byRoute;
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
		byRoute: turnBucketsByRoute(state.buffer),
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
		if (sampled.last === null || sampled.last.turn !== event.data?.turn || sampled.last.step !== event.data?.step) {
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
export function createCostUsageProjection(readResolvedConfig = readConfig) {
	const readConfigNow = typeof readResolvedConfig === 'function' ? readResolvedConfig : () => readConfig();
	const views = new WeakMap();
	return {
		key: PROJECTION_KEY,
		stateVersion: 2,
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
				const signature = configSignature(resolved);
				const cached = views.get(state);
				if (cached !== undefined && cached.signature === signature) return cached.view;
				const accounting = {
					totals: state.totals,
					byRoute: state.byRoute,
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
	return JSON.stringify([config.currency, config.cnyPerUsd, config.showDockChip, config.showTurnChip, config.pricing]);
}

// #endregion

// #region config HTTP route

/** Send one JSON response. */
function respond(res, status, payload) {
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	});
	res.end(JSON.stringify(payload));
}

/** Collect a request body with an upper bound. */
function readBody(req, limit) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new Error('config body too large'));
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

/** The payload shared by both methods: live config plus auto-fill sources. */
const revisionOf = (config) => createHash('sha256').update(JSON.stringify(config)).digest('hex');
const rateSchema = z
	.object({
		input: z.number().nonnegative(),
		output: z.number().nonnegative(),
		cacheRead: z.number().nonnegative(),
		cacheWrite: z.number().nonnegative(),
	})
	.strict();
const configInputSchema = z
	.object({
		currency: z.enum(['USD', 'CNY']),
		cnyPerUsd: z.number().positive(),
		showDockChip: z.boolean(),
		showTurnChip: z.boolean(),
		pricing: z.record(z.string(), rateSchema),
	})
	.strict();
async function configPayload(history) {
	const config = await history.config();
	return { config, models: history.list(), revision: revisionOf(config), path: CONFIG_PATH };
}

/** Serve configuration and persist validated JSON writes. */
export function createConfigHandler(connection, history, prices = createModelsDev()) {
	return async (req, res) => {
		const rejection = connection.requestRejection(req);
		if (rejection !== undefined) {
			respond(res, rejection, { error: rejection === 401 ? 'authentication required' : 'forbidden' });
			return;
		}
		const sync = req.url?.split('?')[0] === '/dsh-cost-meter/pricing/sync';
		if (req.method === 'GET' || req.method === 'HEAD') {
			try {
				respond(res, 200, await configPayload(history));
			} catch (error) {
				respond(res, 503, { error: error.message });
			}
			return;
		}
		if (req.method === 'POST') {
			if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
				respond(res, 415, { error: 'application/json required' });
				return;
			}
			let parsed;
			try {
				parsed = JSON.parse(await readBody(req, MAX_BODY_BYTES));
			} catch (error) {
				respond(res, 400, { error: error instanceof Error ? error.message : String(error) });
				return;
			}
			try {
				const before = await configPayload(history);
				if (parsed.revision !== before.revision) {
					respond(res, 409, { error: 'Configuration changed. Reload before saving.' });
					return;
				}
				let next, report;
				if (sync) {
					if (parsed.source !== 'models.dev') throw new Error('Unsupported price source');
					({ config: next, report } = await prices.prices(before.config));
					if ((await configPayload(history)).revision !== before.revision) {
						respond(res, 409, { error: 'Configuration changed during sync. Reload and retry.' });
						return;
					}
				} else next = configInputSchema.parse(parsed.config);
				history.save(next);
				respond(res, 200, { ...(await configPayload(history)), ...(report ? { report } : {}) });
			} catch (error) {
				respond(res, error instanceof z.ZodError ? 400 : 502, { error: error.message });
			}
			return;
		}
		respond(res, 405, { error: 'method not allowed' });
	};
}

// #endregion

/**
 * Register the cost projection and the config HTTP route.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
	seedConfigFile(ctx.logger);
	ctx.sessionProjections.register(createCostUsageProjection());
	// Headless profiles still get the projection; HTTP requires browser auth.
	ctx.inject(['sessionQuery'], (queryCtx) => {
		const prices = createModelsDev(undefined, join(dirname(CONFIG_PATH), 'data', 'models.dev.json'));
		const history = createHistoryModels(queryCtx.sessionQuery, {
			readConfig,
			writeConfig,
			initializePrices: prices.initialize,
			onError: (error) => ctx.logger?.warn('Could not initialize model prices', error),
			backupConfig: () => {
				const backup = `${CONFIG_PATH}.v0.1.1.bak`;
				if (existsSync(CONFIG_PATH) && !existsSync(backup)) copyFileSync(CONFIG_PATH, backup);
			},
		});
		queryCtx.on('session/event', (_session, event) => {
			history.observe(event).catch((error) => ctx.logger?.warn('Could not persist historical model', error));
		});
		history.config().catch((error) => ctx.logger?.warn('Could not discover historical models', error));
		queryCtx.inject(['webServer', 'connection'], (webCtx) => {
			const handler = createConfigHandler(webCtx.connection, history, prices);
			for (const path of [CONFIG_ROUTE, '/dsh-cost-meter/pricing/sync']) {
				webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path, handler }), `dsh-cost-meter: ${path}`);
			}
		});
	});
}

// Keep named exports: Cordis unwraps a default function and loses `inject`.
