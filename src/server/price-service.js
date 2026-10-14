import { join } from 'node:path';
import { resolvedPriceSource } from '../price-sources.js';
import { modelsDev } from '../price-sources/models-dev.js';
import { openRouter } from '../price-sources/openrouter.js';
import { deepInfra } from '../price-sources/deepinfra.js';
import { createCatalogCache } from '../price-sources/catalog-cache.js';
import { syncPrices, emptyReport } from '../price-sources/sync.js';

export function createPriceService(directory, fetcher = (...args) => fetch(...args)) {
	const sources = new Map(
		[modelsDev, openRouter, deepInfra].map((adapter) => [
			adapter.id,
			{
				adapter,
				catalog: createCatalogCache(
					adapter,
					fetcher,
					directory ? join(directory, `${adapter.id}.json`) : undefined,
				),
			},
		]),
	);
	async function apply(config, force, source = resolvedPriceSource(config)) {
		const service = sources.get(source);
		if (!service) throw new Error('Unsupported price source');
		const catalog = await service.catalog(force);
		return catalog ? syncPrices(config, catalog, service.adapter) : { config, report: emptyReport() };
	}
	return {
		initialize: (config) => apply(config, false),
		prices: (config, source) => apply(config, true, source),
	};
}
