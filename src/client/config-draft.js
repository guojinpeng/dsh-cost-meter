import { RATE_KEYS, zeroRate } from '../pricing.js';

export function buildDraft(payload) {
	const config = payload.config;
	return {
		currency: config.currency,
		cnyPerUsd: config.cnyPerUsd,
		showDockChip: config.showDockChip,
		showTurnChip: config.showTurnChip,
		rows: payload.models.map((key) => ({ key, ...(config.pricing[key] ?? zeroRate()) })),
	};
}

export function configOf(draft) {
	const cnyPerUsd = Number(draft.cnyPerUsd);
	if (!Number.isFinite(cnyPerUsd) || cnyPerUsd <= 0) throw new Error('Invalid USD/CNY exchange rate');
	const pricing = {};
	for (const row of draft.rows) {
		if (
			RATE_KEYS.some(
				(key) => String(row[key]).trim() === '' || !Number.isFinite(Number(row[key])) || Number(row[key]) < 0,
			)
		) {
			throw new Error(`Invalid rate: ${row.key}`);
		}
		pricing[row.key] = Object.fromEntries(RATE_KEYS.map((key) => [key, Number(row[key])]));
	}
	return {
		currency: draft.currency,
		cnyPerUsd,
		showDockChip: draft.showDockChip,
		showTurnChip: draft.showTurnChip,
		pricing,
	};
}
