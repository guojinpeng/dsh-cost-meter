import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm';

/** An empty token bucket. */
export function zeroBuckets() {
	return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

/** A usage field that is safe to accumulate. */
function countOf(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Normalise a provider usage payload into a bucket. */
export function bucketsFrom(usage) {
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
export function bucketsEqual(left, right) {
	return (
		left.uncachedInputTokens === right.uncachedInputTokens &&
		left.outputTokens === right.outputTokens &&
		left.cacheReadTokens === right.cacheReadTokens &&
		left.cacheWriteTokens === right.cacheWriteTokens
	);
}

/** Bucket addition. */
export function bucketsAdd(left, right) {
	return {
		uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
		cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
		cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
	};
}

/** Replace one sample inside a running total, like the official projection. */
export function bucketsReplace(total, previous, next) {
	return {
		uncachedInputTokens: total.uncachedInputTokens - previous.uncachedInputTokens + next.uncachedInputTokens,
		outputTokens: total.outputTokens - previous.outputTokens + next.outputTokens,
		cacheReadTokens: total.cacheReadTokens - previous.cacheReadTokens + next.cacheReadTokens,
		cacheWriteTokens: total.cacheWriteTokens - previous.cacheWriteTokens + next.cacheWriteTokens,
	};
}

/** The route recorded on an assistant message. */
export function messageRoute(message) {
	const source = message?.source;
	if (source === null || typeof source !== 'object') return null;
	const provider = typeof source.provider === 'string' ? source.provider : '';
	const model = typeof source.model === 'string' ? source.model : '';
	if (provider === '' || model === '') return null;
	return { provider, model };
}

/** A stable key for a route. */
export function routeKey(route) {
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
export function usageOf(event) {
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
export function compactEvent(event) {
	const type = event?.type;
	const data = event?.data ?? {};
	if (type === 'turn/start' || type === 'turn/end') {
		return typeof data.turn === 'number' ? { type, time: event.time, data: { turn: data.turn } } : null;
	}
	if (type === 'step/start' || type === 'step/end' || type === 'llm/retry' || type === 'llm/retry-started') {
		return typeof data.turn === 'number' && typeof data.step === 'number'
			? { type, time: event.time, data: { turn: data.turn, step: data.step } }
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
	return { type, time: event.time, data: compact };
}

/** Recover missing cache attribution from the official aggregate's prompt total. */
export function recoverBuckets(aggregate) {
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
