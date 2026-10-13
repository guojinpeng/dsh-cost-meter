import { z } from 'zod';

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

const rateSchema = z
	.object({
		input: z.number().nonnegative(),
		output: z.number().nonnegative(),
		cacheRead: z.number().nonnegative(),
		cacheWrite: z.number().nonnegative(),
	})
	.strict();
export const configInputSchema = z
	.object({
		currency: z.enum(['USD', 'CNY']),
		cnyPerUsd: z.number().positive(),
		showDockChip: z.boolean(),
		showTurnChip: z.boolean(),
		pricing: z.record(z.string(), rateSchema),
	})
	.strict();
