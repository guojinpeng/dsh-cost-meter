import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HTTP_BASE } from '../identity.js';
import { createModelsDev } from '../models-dev.js';
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
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new Error('config body too large'));
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

/** The payload shared by both methods: live config plus auto-fill sources. */
const revisionOf = (config) => createHash('sha256').update(JSON.stringify(config)).digest('hex');
async function configPayload(history) {
	const config = await history.config();
	return { config, models: history.list(), revision: revisionOf(config), path: CONFIG_PATH };
}

/** Serve configuration and persist validated JSON writes. */
export function createConfigHandler(connection, history, prices = createModelsDev()) {
	return async (req, res) => {
		const rejection = connection.requestRejection(req);
		if (rejection !== undefined) {
			respond(res, rejection, { error: rejection === 401 ? 'authentication required' : 'forbidden' });
			return;
		}
		const sync = req.url?.split('?')[0] === `${HTTP_BASE}/pricing/sync`;
		if (req.method === 'GET' || req.method === 'HEAD') {
			try {
				respond(res, 200, await configPayload(history));
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
			try {
				const before = await configPayload(history);
				if (parsed.revision !== before.revision) {
					respond(res, 409, { error: 'Configuration changed. Reload before saving.' });
					return;
				}
				let next, report;
				if (sync) {
					if (parsed.source !== 'models.dev') throw new Error('Unsupported price source');
					({ config: next, report } = await prices.prices(before.config));
					if ((await configPayload(history)).revision !== before.revision) {
						respond(res, 409, { error: 'Configuration changed during sync. Reload and retry.' });
						return;
					}
				} else next = configInputSchema.parse(parsed.config);
				history.save(next);
				respond(res, 200, { ...(await configPayload(history)), ...(report ? { report } : {}) });
			} catch (error) {
				respond(res, error instanceof z.ZodError ? 400 : 502, { error: error.message });
			}
			return;
		}
		respond(res, 405, { error: 'method not allowed' });
	};
}
