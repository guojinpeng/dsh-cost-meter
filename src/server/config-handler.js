import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HTTP_BASE } from '../identity.js';
import { createPriceService } from './price-service.js';
import { PRICE_SOURCES, resolvedPriceSource } from '../price-sources.js';
import { CONFIG_PATH } from './config-store.js';
import { configInputSchema } from './schemas.js';

const MAX_BODY_BYTES = 1024 * 1024;

/** Send one JSON response. */
function respond(res, status, payload) {
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	});
	res.end(JSON.stringify(payload));
}

/** Collect a request body with an upper bound. */
function readBody(req, limit) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		let settled = false;
		const settle = (action, value) => {
			if (settled) return;
			settled = true;
			action(value);
		};
		req.on('data', (chunk) => {
			if (settled) return;
			size += chunk.length;
			if (size > limit) {
				// Keep reading to drain the socket; the caller answers with 400.
				settle(reject, new Error('config body too large'));
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => settle(resolve, Buffer.concat(chunks).toString('utf8')));
		req.on('error', (error) => settle(reject, error));
	});
}

/** The payload shared by both methods: live config plus auto-fill sources. */
const revisionOf = (config) => createHash('sha256').update(JSON.stringify(config)).digest('hex');
async function configPayload(history, holidays, wait = false) {
	const config = wait || !history.snapshot ? await history.config() : history.snapshot();
	for (const year of history.years?.() ?? []) holidays?.ensure(year);
	return {
		config,
		models: history.list(),
		discovered: history.discovered?.() ?? history.list(),
		revision: revisionOf(config),
		path: CONFIG_PATH,
		...(holidays ? { calendars: holidays.snapshot(), calendarPending: holidays.pending() } : {}),
		historyPending: history.pending ? history.pending() : history.ready ? !history.ready() : false,
	};
}

/** Serve configuration and persist validated JSON writes. */
export function createConfigHandler(connection, history, prices = createPriceService(), holidays) {
	let writes = Promise.resolve();
	return async (req, res) => {
		const rejection = connection.requestRejection(req);
		if (rejection !== undefined) {
			respond(res, rejection, { error: rejection === 401 ? 'authentication required' : 'forbidden' });
			return;
		}
		const sync = req.url?.split('?')[0] === `${HTTP_BASE}/pricing/sync`;
		if (req.method === 'GET' || req.method === 'HEAD') {
			try {
				respond(res, 200, await configPayload(history, holidays));
			} catch (error) {
				respond(res, 503, { error: error.message });
			}
			return;
		}
		if (req.method === 'POST') {
			if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
				respond(res, 415, { error: 'application/json required' });
				return;
			}
			let parsed;
			try {
				parsed = JSON.parse(await readBody(req, MAX_BODY_BYTES));
			} catch (error) {
				respond(res, 400, { error: error instanceof Error ? error.message : String(error) });
				return;
			}
			const operation = writes
				.catch(() => {})
				.then(async () => {
					try {
						const before = await configPayload(history, holidays, true);
						if (parsed.revision !== before.revision) {
							respond(res, 409, { error: 'Configuration changed. Reload before saving.' });
							return;
						}
						let next, report;
						if (sync) {
							if (!PRICE_SOURCES.includes(parsed.source)) {
								respond(res, 400, { error: 'Unsupported price source' });
								return;
							}
							// A staged config means preview only: the client saves the result itself.
							const staged = parsed.config !== undefined;
							const base = staged ? configInputSchema.parse(parsed.config) : before.config;
							if (parsed.source !== resolvedPriceSource(base)) {
								respond(res, 409, { error: 'Price source changed. Reload and retry.' });
								return;
							}
							({ config: next, report } = await prices.prices(base, parsed.source));
							if (staged) {
								respond(res, 200, { ...before, report, preview: next });
								return;
							}
							if ((await configPayload(history, holidays, true)).revision !== before.revision) {
								respond(res, 409, { error: 'Configuration changed during sync. Reload and retry.' });
								return;
							}
						} else next = configInputSchema.parse(parsed.config);
						history.save(next);
						respond(res, 200, {
							...(await configPayload(history, holidays, true)),
							...(report ? { report } : {}),
						});
					} catch (error) {
						respond(res, error instanceof z.ZodError ? 400 : 502, { error: error.message });
					}
				});
			writes = operation;
			await operation;
			return;
		}
		respond(res, 405, { error: 'method not allowed' });
	};
}