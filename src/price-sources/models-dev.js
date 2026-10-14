const OWNERS = [
	[/^qwen/i, 'alibaba'],
	[/^deepseek/i, 'deepseek'],
	[/^glm/i, 'zhipuai'],
	[/^kimi|^moonshot/i, 'moonshotai'],
	[/^claude/i, 'anthropic'],
	[/^gpt-|^chatgpt-|^o[134]-|^o[134]$/i, 'openai'],
	[/^gemini/i, 'google'],
];

// These original-vendor entries quote the documented off-peak rate.
const DEEPSEEK_OFF_PEAK_IDS = new Set([
	'deepseek-flash',
	'deepseek-v4-flash',
	'deepseek-v4-flash-vision-exp',
	'deepseek-v4-pro',
]);

export const modelsDev = {
	id: 'models.dev',
	url: 'https://models.dev/api.json',
	validCatalog: (value) =>
		value &&
		!Array.isArray(value) &&
		typeof value === 'object' &&
		Object.values(value).some((provider) => provider?.models && typeof provider.models === 'object'),
	offer(model, catalog) {
		const candidates = Object.entries(catalog).filter(
			([provider, entry]) =>
				!/(?:plan|subscription|opencode-go)/i.test(provider) && entry?.models?.[model]?.cost,
		);
		const owner = OWNERS.find(([pattern]) => pattern.test(model))?.[1];
		let selected = candidates.find(([provider]) => provider === owner);
		if (!selected) {
			if (!candidates.length) return { status: 'unmatched' };
			if (new Set(candidates.map(([, entry]) => JSON.stringify(entry.models[model].cost))).size !== 1)
				return { status: 'ambiguous' };
			selected = candidates[0];
		}
		const cost = selected[1].models[model].cost;
		if (
			(cost.tiers?.length ?? 0) > 0 ||
			cost.context_over_200k !== undefined ||
			(cost.reasoning !== undefined && cost.reasoning !== cost.output)
		)
			return { status: 'unsupported', reason: 'conditionalPricing' };
		const peakBasis = selected[0] === 'deepseek' && DEEPSEEK_OFF_PEAK_IDS.has(model);
		const factor = peakBasis ? 2 : 1;
		const rate = {};
		for (const [source, target] of [
			['input', 'input'],
			['output', 'output'],
			['cache_read', 'cacheRead'],
			['cache_write', 'cacheWrite'],
		]) {
			if (cost[source] === undefined && target.startsWith('cache')) continue;
			if (typeof cost[source] !== 'number' || !Number.isFinite(cost[source]) || cost[source] < 0)
				return { status: 'unsupported', reason: 'invalidPrice' };
			rate[target] = cost[source] * factor;
		}
		return { rate, peakBasis };
	},
};
