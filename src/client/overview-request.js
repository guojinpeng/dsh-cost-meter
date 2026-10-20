import { HTTP_BASE } from '../identity.js';

/** Selectable range ids, in display order. */
export const OVERVIEW_RANGES = ['today', '7', '30', '90', 'all'];

/**
 * Load one overview payload. A preset range can bypass the server cache once.
 * @param {string} range preset range id.
 * @param {object} options
 * @param {boolean} [options.refresh] ask the server to recompute instead of reading its cache.
 * @param {string} [options.start] custom range start date.
 * @param {string} [options.end] custom range end date.
 * @param {Function} [options.fetcher] injected fetch, for tests.
 */
export async function fetchOverview(range, { refresh = false, start, end, fetcher = (...args) => fetch(...args) } = {}) {
	const custom = start !== undefined && end !== undefined;
	const query = custom ? 'start=' + start + '&end=' + end : 'days=' + range;
	const suffix = refresh && !custom ? '&refresh=1' : '';
	const response = await fetcher(HTTP_BASE + '/overview?' + query + suffix);
	const payload = await response.json();
	if (!response.ok) throw new Error(payload?.error ?? 'HTTP ' + response.status);
	return payload;
}
