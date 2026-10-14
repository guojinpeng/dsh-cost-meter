import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function createCatalogCache(adapter, fetcher, cachePath) {
	let cached = null,
		pending = null;
	return async function catalog(force = false) {
		if (!force && !cached && cachePath) {
			try {
				const value = JSON.parse(readFileSync(cachePath, 'utf8'));
				if (adapter.validCatalog(value)) cached = value;
			} catch {}
		}
		if (!force) return cached;
		if (pending) return pending;
		pending = (async () => {
			const response = await fetcher(adapter.url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
			if (!response.ok) throw new Error(`${adapter.id} HTTP ${response.status}`);
			const value = await response.json();
			if (!adapter.validCatalog(value)) throw new Error(`Invalid ${adapter.id} catalog`);
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
	};
}
