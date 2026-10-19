import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Cached overview payloads older than this are recomputed. */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/** Cache file name: the range name plus this suffix, for example 30-day-statistics.json. */
export const CACHE_FILE_SUFFIX = 'day-statistics.json';

/**
 * Cache one overview payload per range inside the plugin data directory.
 * The file modification time is the age; the config stamp invalidates the file
 * when prices or the exchange rate change.
 */
export function createOverviewCache(dir, { ttlMs = CACHE_TTL_MS, now = Date.now } = {}) {
	const pathOf = (range) => join(dir, range + '-' + CACHE_FILE_SUFFIX);
	return {
		pathOf,
		/** Return the cached payload, or null when missing, old, or stale. */
		read(range, configStamp) {
			try {
				const stats = statSync(pathOf(range));
				if (now() - stats.mtimeMs > ttlMs) return null;
				const entry = JSON.parse(readFileSync(pathOf(range), 'utf8'));
				if (entry === null || typeof entry !== 'object') return null;
				if (entry.configStamp !== configStamp) return null;
				return entry.payload ?? null;
			} catch {
				return null;
			}
		},
		/** Replace the cache file; failures never break the response. */
		write(range, configStamp, payload) {
			try {
				mkdirSync(dir, { recursive: true });
				const path = pathOf(range);
				const tmp = path + '.tmp-' + String(process.pid);
				writeFileSync(tmp, JSON.stringify({ version: 1, savedAt: now(), configStamp, payload }), 'utf8');
				renameSync(tmp, path);
				return true;
			} catch {
				return false;
			}
		},
	};
}
