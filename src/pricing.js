export const RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'];
export const zeroRate = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function normalizeRate(entry) {
	if (!entry || typeof entry !== 'object') return null;
	if (
		!['input', 'output'].every(
			(key) => typeof entry[key] === 'number' && Number.isFinite(entry[key]) && entry[key] >= 0,
		)
	)
		return null;
	return Object.fromEntries(
		RATE_KEYS.map((key) => [key, Number.isFinite(entry[key]) && entry[key] >= 0 ? entry[key] : 0]),
	);
}

export function parseRouteKey(key) {
	const slash = key.indexOf('/');
	return slash > 0 && slash < key.length - 1 ? { provider: key.slice(0, slash), model: key.slice(slash + 1) } : null;
}

export function tokensOf(buckets) {
	return buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
}

function wireTokens(buckets) {
	return {
		input: buckets.uncachedInputTokens,
		output: buckets.outputTokens,
		read: buckets.cacheReadTokens,
		write: buckets.cacheWriteTokens,
	};
}

function priceRoutes(byRoute, pricing) {
	let micros = 0,
		unpricedTokens = 0;
	const bucketMicros = { input: 0, output: 0, read: 0, write: 0 };
	const routes = [];
	for (const [key, buckets] of Object.entries(byRoute)) {
		const rate = normalizeRate(pricing[key]);
		const totalTokens = tokensOf(buckets);
		let amount = 0;
		if (rate === null) unpricedTokens += totalTokens;
		else {
			const parts = {
				input: buckets.uncachedInputTokens * rate.input,
				output: buckets.outputTokens * rate.output,
				read: buckets.cacheReadTokens * rate.cacheRead,
				write: buckets.cacheWriteTokens * rate.cacheWrite,
			};
			amount = Math.round(Object.values(parts).reduce((sum, value) => sum + value, 0));
			micros += amount;
			for (const field of Object.keys(parts)) bucketMicros[field] += parts[field];
		}
		routes.push({ route: key, micros: amount, totalTokens, priced: rate !== null });
	}
	for (const key of Object.keys(bucketMicros)) bucketMicros[key] = Math.round(bucketMicros[key]);
	return { micros, unpricedTokens, bucketMicros, routes };
}

/** The same calculation serves host projections and reactive client displays. */
export function buildCostView(accounting, config) {
	const { micros: totalMicros, unpricedTokens, bucketMicros, routes } = priceRoutes(accounting.byRoute, config.pricing);
	routes.sort((a, b) => b.micros - a.micros || b.totalTokens - a.totalTokens);
	const turns = {};
	for (const [key, entry] of Object.entries(accounting.turns)) {
		const priced = priceRoutes(entry.byRoute, config.pricing);
		turns[key] = {
			micros: priced.micros,
			totalTokens: entry.totalTokens,
			route: Object.keys(entry.byRoute).join(', '),
			tokens: wireTokens(entry.tokens),
			bucketMicros: priced.bucketMicros,
			priced: priced.unpricedTokens === 0,
			recovered: entry.recovered,
		};
	}
	const prompt = tokensOf(accounting.totals) - accounting.totals.outputTokens;
	return {
		currency: config.currency,
		cnyPerUsd: config.cnyPerUsd,
		totalMicros,
		totalTokens: tokensOf(accounting.totals),
		tokens: wireTokens(accounting.totals),
		bucketMicros,
		cacheHitPct: prompt === 0 ? null : Math.round((accounting.totals.cacheReadTokens / prompt) * 1000) / 10,
		skippedTurns: accounting.skippedTurns,
		unpricedTokens,
		showDock: config.showDockChip !== false,
		showTurn: config.showTurnChip !== false,
		routes: routes.slice(0, 8),
		turns,
	};
}
