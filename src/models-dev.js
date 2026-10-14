import { createCatalogCache } from './price-sources/catalog-cache.js';
import { modelsDev } from './price-sources/models-dev.js';
import { syncPrices, emptyReport } from './price-sources/sync.js';

// Preserve the existing entry point for callers of the models.dev service.
export const syncModelsDev = (config, catalog) => syncPrices(config, catalog, modelsDev);

export function createModelsDev(fetcher = (...args) => fetch(...args), cachePath) {
	const catalog = createCatalogCache(modelsDev, fetcher, cachePath);
	return {
		initialize: async (config) => {
			const data = await catalog();
			return data ? syncModelsDev(config, data) : { config, report: emptyReport() };
		},
		prices: async (config) => syncModelsDev(config, await catalog(true)),
	};
}
