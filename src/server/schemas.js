import { z } from 'zod';
import { PRICE_SOURCES } from '../price-sources.js';
import { PEAK_RULE_IDS } from '../time-of-use.js';

const int = z.number().int().nonnegative();

const bucketSchema = z
	.object({
		uncachedInputTokens: int,
		outputTokens: int,
		cacheReadTokens: int,
		cacheWriteTokens: int,
	})
	.strict();
const byTimeSchema = z.record(z.string(), z.record(z.string(), bucketSchema));
const calendarsSchema = z.record(z.string(), z.array(z.string()));

const routeSchema = z.object({ provider: z.string(), model: z.string() }).strict();

const lastSlotSchema = z
	.object({ turn: int, step: int, buckets: bucketSchema, route: routeSchema.nullable(), time: z.string() })
	.strict();

const turnRecordSchema = z
	.object({
		totalTokens: int,
		tokens: bucketSchema,
		byRoute: z.record(z.string(), bucketSchema),
		byTime: byTimeSchema,
		recovered: z.boolean(),
	})
	.strict();

/** Serialisable projection state. */
export const stateSchema = z
	.object({
		totals: bucketSchema,
		byRoute: z.record(z.string(), bucketSchema),
		byTime: byTimeSchema,
		last: lastSlotSchema.nullable(),
		buffer: z.array(z.any()),
		bufferTurn: z.number().int().nullable(),
		turns: z.record(z.string(), turnRecordSchema),
		skippedTurns: int,
	})
	.strict();

const wireTokensSchema = z.object({ input: int, output: int, read: int, write: int }).strict();
const wirePeriodSchema = z
	.object({
		peak: wireTokensSchema,
		offPeak: wireTokensSchema,
		fixed: wireTokensSchema,
		unknown: wireTokensSchema,
	})
	.strict();
const wireRatesSchema = z
	.object({
		input: z.number().nonnegative(),
		output: z.number().nonnegative(),
		read: z.number().nonnegative(),
		write: z.number().nonnegative(),
		factor: z.number().nonnegative(),
		rule: z.enum(PEAK_RULE_IDS),
	})
	.strict();
const amountsSchema = z.array(
	z
		.object({
			currency: z.enum(['USD', 'CNY']),
			micros: int,
			bucketMicros: wireTokensSchema,
			periodMicros: wirePeriodSchema,
		})
		.strict(),
);

const wireRouteSchema = z
	.object({
		route: z.string(),
		micros: int,
		currency: z.enum(['USD', 'CNY']),
		amountMicros: int,
		totalTokens: int,
		priced: z.boolean(),
		periodMicros: wirePeriodSchema,
		tokensByPeriod: wirePeriodSchema,
		rates: wireRatesSchema.optional(),
	})
	.strict();

const wireTurnSchema = z
	.object({
		micros: int,
		amounts: amountsSchema,
		peakTokens: int,
		offPeakTokens: int,
		uncertainTokens: int,
		totalTokens: int,
		route: z.string(),
		routes: z.array(wireRouteSchema),
		tokens: wireTokensSchema,
		bucketMicros: wireTokensSchema,
		priced: z.boolean(),
		recovered: z.boolean(),
	})
	.strict();

/** Client-facing projection view. */
export const viewSchema = z
	.object({
		accounting: z
			.object({
				totals: bucketSchema,
				byRoute: z.record(z.string(), bucketSchema),
				byTime: byTimeSchema,
				calendars: calendarsSchema,
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
		amounts: amountsSchema,
		peakTokens: int,
		offPeakTokens: int,
		uncertainTokens: int,
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
		currency: z.enum(['USD', 'CNY']).optional(),
		autoOffPeak: z.boolean().optional(),
		peakRule: z.enum(PEAK_RULE_IDS).optional(),
		source: z.enum([...PRICE_SOURCES, 'manual']).optional(),
	})
	.strict();
export const configInputSchema = z
	.object({
		currency: z.enum(['USD', 'CNY']).optional(),
		priceSource: z.enum(PRICE_SOURCES).optional(),
		cnyPerUsd: z.number().positive(),
		showDockChip: z.boolean(),
		showTurnChip: z.boolean(),
		pricing: z.record(z.string(), rateSchema),
	})
	.strict();