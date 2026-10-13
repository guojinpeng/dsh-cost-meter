import { parseRouteKey } from './pricing.js';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CATALOG_URL = 'https://models.dev/api.json';

function validCatalog(value) {
	return (
		value &&
		!Array.isArray(value) &&
		typeof value === 'object' &&
		Object.values(value).some((p) => p?.models && typeof p.models === 'object')
	);
}

export function createModelsDev(fetcher = (...args) => fetch(...args), cachePath) {
	let cached = null,
		pending = null;
	async function catalog(force = false) {
		if (!force && !cached && cachePath) {
			try {
				const value = JSON.parse(readFileSync(cachePath, 'utf8'));
				if (validCatalog(value)) cached = value;
			} catch {}
		}
		if (!force && cached) return cached;
		if (pending) return pending;
		pending = (async () => {
			const response = await fetcher(CATALOG_URL, { signal: AbortSignal.timeout(20000), redirect: 'error' });
			if (!response.ok) throw new Error(`models.dev HTTP ${response.status}`);
			const value = await response.json();
			if (!validCatalog(value)) {
				throw new Error('Invalid models.dev catalog');
			}
			if (cachePath) {
				mkdirSync(dirname(cachePath), { recursive: true });
				const temporary = `${cachePath}.tmp-${process.pid}`;
				writeFileSync(temporary, JSON.stringify(value), 'utf8');
				renameSync(temporary, cachePath);
			}
			cached = value;
			return value;
		})().finally(() => {
			pending = null;
		});
		return pending;
	}
	return {
		initialize: async (config) => syncModelsDev(config, await catalog()),
		prices: async (config) => syncModelsDev(config, await catalog(true)),
	};
}

// Source ownership only selects an offer; local DSH provider IDs are never used.
const OWNERS = [
	[/^qwen/i, 'alibaba'],
	[/^deepseek/i, 'deepseek'],
	[/^glm/i, 'zhipuai'],
	[/^kimi|^moonshot/i, 'moonshotai'],
	[/^claude/i, 'anthropic'],
	[/^gpt-|^chatgpt-|^o[134]-|^o[134]$/i, 'openai'],
	[/^gemini/i, 'google'],
];
function modelOffer(model, catalog) {
	const candidates = Object.entries(catalog).filter(
		([provider, entry]) => !/(?:plan|subscription|opencode-go)/i.test(provider) && entry?.models?.[model]?.cost,
	);
	const owner = OWNERS.find(([pattern]) => pattern.test(model))?.[1];
	const original = candidates.find(([provider]) => provider === owner);
	if (original) return { cost: original[1].models[model].cost };
	if (!candidates.length) return { status: 'unmatched' };
	const prices = new Set(candidates.map(([, entry]) => JSON.stringify(entry.models[model].cost)));
	if (prices.size !== 1) return { status: 'ambiguous' };
	return { cost: candidates[0][1].models[model].cost };
}

/** Match model IDs only and apply one selected offer to every local provider. */
export function syncModelsDev(config, catalog) {
	const pricing = { ...config.pricing };
	const report = { updated: [], unmatched: [], unsupported: [], ambiguous: [] };
	for (const [key, previous] of Object.entries(config.pricing)) {
		const route = parseRouteKey(key);
		const offer = route ? modelOffer(route.model, catalog) : { status: 'unmatched' };
		const cost = offer.cost;
		if (!cost) {
			report[offer.status].push(key);
			continue;
		}
		if (
			(cost.tiers?.length ?? 0) > 0 ||
			cost.context_over_200k !== undefined ||
			(cost.reasoning !== undefined && cost.reasoning !== cost.output) ||
			!['input', 'output'].every(
				(field) => typeof cost[field] === 'number' && Number.isFinite(cost[field]) && cost[field] >= 0,
			)
		) {
			report.unsupported.push(key);
			continue;
		}
		const next = { ...previous, input: cost.input, output: cost.output };
		let valid = true;
		for (const [source, target] of [
			['cache_read', 'cacheRead'],
			['cache_write', 'cacheWrite'],
		]) {
			if (cost[source] === undefined) continue;
			if (typeof cost[source] !== 'number' || !Number.isFinite(cost[source]) || cost[source] < 0) {
				valid = false;
				break;
			}
			next[target] = cost[source];
		}
		if (!valid) {
			report.unsupported.push(key);
			continue;
		}
		pricing[key] = next;
		report.updated.push(key);
	}
	return { config: { ...config, pricing }, report };
}
