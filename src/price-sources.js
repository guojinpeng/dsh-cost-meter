export const PRICE_SOURCES = ['models.dev', 'openrouter.ai', 'api.deepinfra.com'];
export const DEFAULT_PRICE_SOURCE = PRICE_SOURCES[0];

export function resolvedPriceSource(config) {
	return PRICE_SOURCES.includes(config.priceSource) ? config.priceSource : DEFAULT_PRICE_SOURCE;
}
