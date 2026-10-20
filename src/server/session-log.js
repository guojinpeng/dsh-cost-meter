import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as zlib from 'node:zlib';
import { resolveDshHome } from './config-store.js';

/** Zstandard frame magic, as written by the session log writer. */
const ZSTD_MAGIC = 4247762216;
/** The session directory listing is reused for this long. */
const LAYOUT_TTL_MS = 1000;
/** Session log file names, with and without compression. */
const LOG_FILE = /^session\.v(\d+)\.jsonl(\.zstd)?$/;
/** A projection that only needs the title event. */
const TITLE_ONLY = { init: () => null, apply: (state) => state };
/** Frames decoded per turn of the event loop: keeps a large log interactive. */
const FRAME_BATCH = 32;
/** Uncompressed lines read per turn of the event loop. */
const LINE_BATCH = 2000;
/** Cache file format version. */
const CACHE_VERSION = 1;
/** Cache directory names must be plain path segments. */
const CACHE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Let pending I/O and timers run between slices of a large fold. */
const breathe = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Locate the complete Zstandard frames of a log without decompressing them.
 * A truncated final frame is dropped; the earlier frames stay readable.
 * @param buffer - the bytes of one session log.
 * @returns byte ranges of the complete frames.
 */
function completeFrames(buffer) {
	const frames = [];
	let offset = 0;
	while (offset < buffer.length) {
		const start = offset;
		if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
		offset += 4;
		if (offset === buffer.length) break;
		const descriptor = buffer.readUInt8(offset);
		offset += 1;
		if ((descriptor & 24) !== 0) break;
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictionaryFlag = descriptor & 3;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
		offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		if (offset > buffer.length) break;
		let complete = true;
		for (;;) {
			if (buffer.length - offset < 3) {
				complete = false;
				break;
			}
			const blockHeader = buffer.readUIntLE(offset, 3);
			offset += 3;
			const blockType = (blockHeader >>> 1) & 3;
			const blockSize = blockHeader >>> 3;
			if (blockType === 3) {
				complete = false;
				break;
			}
			offset += blockType === 1 ? 1 : blockSize;
			if (offset > buffer.length) {
				complete = false;
				break;
			}
			if ((blockHeader & 1) !== 0) break;
		}
		if (!complete) break;
		if (checksum) {
			if (buffer.length - offset < 4) break;
			offset += 4;
		}
		frames.push({ start, end: offset });
	}
	return frames;
}

/** Parse one JSONL line; a torn or invalid line is ignored. */
function parseLine(text) {
	const line = text.trim();
	if (line === '') return undefined;
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

/**
 * Read the events of one session log, one slice at a time, and hand each event
 * to the callback. The log is never fully parsed into an array, so the peak
 * memory stays near the size of the compressed file.
 *
 * @param location - a location from the session log reader.
 * @param onEvent - receives each parsed event.
 */
async function eachEvent(location, onEvent) {
	const buffer = await readFile(location.path);
	if (!location.zstd) {
		const text = buffer.toString('utf8');
		let start = 0;
		let count = 0;
		for (;;) {
			const end = text.indexOf('\n', start);
			const line = end === -1 ? text.slice(start) : text.slice(start, end);
			const event = parseLine(line);
			if (event !== undefined) onEvent(event);
			if (end === -1) return;
			start = end + 1;
			if (++count % LINE_BATCH === 0) await breathe();
		}
	}
	if (typeof zlib.zstdDecompressSync !== 'function')
		throw new Error('zstd is not available in this Node.js');
	const frames = completeFrames(buffer);
	if (frames.length === 0 && buffer.length > 0) throw new Error('unreadable session log');
	let carry = '';
	let truncated = false;
	for (let index = 0; index < frames.length; index += FRAME_BATCH) {
		// Decode a small group, then let the event loop run: a synchronous frame
		// decode is several times faster than the asynchronous one, and a group
		// is short enough to keep the page responsive.
		for (const frame of frames.slice(index, index + FRAME_BATCH)) {
			let text;
			try {
				text = zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8');
			} catch {
				// A corrupt frame ends the readable part of the log.
				truncated = true;
				break;
			}
			const lines = (carry + text).split('\n');
			carry = lines.pop() ?? '';
			for (const line of lines) {
				const event = parseLine(line);
				if (event !== undefined) onEvent(event);
			}
		}
		if (truncated) break;
		if (index + FRAME_BATCH < frames.length) await breathe();
	}
	if (carry !== '') {
		const event = parseLine(carry);
		if (event !== undefined) onEvent(event);
	}
}

/** The newest log file of one session directory. */
function newestLog(dir) {
	let names;
	try {
		names = readdirSync(dir);
	} catch {
		return null;
	}
	let best = null;
	for (const name of names) {
		const match = LOG_FILE.exec(name);
		if (match === null) continue;
		const version = Number(match[1]);
		const zstd = match[2] !== undefined;
		if (best === null || version > best.version || (version === best.version && zstd && !best.zstd)) {
			best = { version, zstd, path: join(dir, name) };
		}
	}
	return best === null ? null : { path: best.path, zstd: best.zstd };
}

/**
 * Read session logs directly from the DSH home, instead of replaying them
 * through the host query service. The host validates every event, which costs
 * about a minute for a large history; decoding the log files costs a few
 * seconds and also exposes the logged session titles.
 *
 * Folds are asynchronous and slice their work, so a cold history does not
 * block the event loop. With a cache directory, each folded session state is
 * written to disk and reused until the log changes.
 *
 * @param options - root overrides the sessions directory, cacheDir enables the
 * disk cache, onError receives each read failure.
 * @returns the log reader: locate, stampOf, fold, foldCached, titleOf.
 */
export function createSessionLogs({ root, cacheDir, onError = () => {} } = {}) {
	const base = root ?? join(resolveDshHome(), 'sessions');
	let layout = new Map();
	let listedAt = 0;

	/** Map a session id to its newest log file, with a short listing cache. */
	function locate(force = false) {
		const now = Date.now();
		if (!force && now - listedAt < LAYOUT_TTL_MS) return layout;
		const next = new Map();
		let workspaces;
		try {
			workspaces = readdirSync(base, { withFileTypes: true });
		} catch (error) {
			onError(error);
			workspaces = [];
		}
		for (const workspace of workspaces) {
			if (!workspace.isDirectory()) continue;
			let sessions;
			try {
				sessions = readdirSync(join(base, workspace.name), { withFileTypes: true });
			} catch {
				continue;
			}
			for (const session of sessions) {
				if (!session.isDirectory()) continue;
				const location = newestLog(join(base, workspace.name, session.name));
				if (location !== null) next.set(session.name, location);
			}
		}
		layout = next;
		listedAt = now;
		return layout;
	}

	/** A change stamp of one log, or null when it is gone. */
	function stampOf(location) {
		try {
			const stat = statSync(location.path);
			return String(stat.mtimeMs) + ':' + String(stat.size);
		} catch {
			return null;
		}
	}

	/** Replay one log through a projection definition; null when unreadable. */
	async function fold(location, definition) {
		let state = definition.init();
		let title;
		try {
			await eachEvent(location, (event) => {
				if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title !== '')
					title = event.data.title;
				state = definition.apply(state, event);
			});
		} catch (error) {
			onError(error);
			return null;
		}
		return { state, title };
	}

	/** The cache file of one session state, or null when caching is off. */
	function cachePath(name, id) {
		if (cacheDir === undefined || !CACHE_NAME.test(name)) return null;
		if (typeof id !== 'string' || id === '' || id.includes('/') || id.includes('\\')) return null;
		return join(cacheDir, name, id + '.json');
	}

	/** A cached fold result, or null when missing, stale, or unreadable. */
	function readCache(path, stamp, definition) {
		try {
			const entry = JSON.parse(readFileSync(path, 'utf8'));
			if (entry === null || typeof entry !== 'object') return null;
			if (entry.version !== CACHE_VERSION || entry.stamp !== stamp) return null;
			if (entry.stateVersion !== (definition.stateVersion ?? null)) return null;
			if (definition.stateSchema !== undefined && !definition.stateSchema.safeParse(entry.state).success)
				return null;
			return { state: entry.state, title: entry.title };
		} catch {
			return null;
		}
	}

	/** Persist one fold result; a write failure never breaks the read. */
	function writeCache(path, stamp, definition, folded) {
		try {
			mkdirSync(join(path, '..'), { recursive: true });
			const temporary = path + '.tmp-' + String(process.pid);
			writeFileSync(
				temporary,
				JSON.stringify({
					version: CACHE_VERSION,
					stamp,
					stateVersion: definition.stateVersion ?? null,
					title: folded.title,
					state: folded.state,
				}),
				'utf8',
			);
			renameSync(temporary, path);
		} catch {
			// The cache is an optimisation: failing to write it is not an error.
		}
	}

	/**
	 * Fold one log, reusing the on-disk state of an unchanged log.
	 * @param id - session id, used as the cache file name.
	 * @param location - the newest log file of the session.
	 * @param stamp - the change stamp of that log.
	 * @param definition - the projection definition.
	 * @param name - cache directory name, for example "cost".
	 */
	async function foldCached(id, location, stamp, definition, name) {
		const path = stamp === null ? null : cachePath(name, id);
		if (path !== null) {
			const cached = readCache(path, stamp, definition);
			if (cached !== null) return cached;
		}
		const folded = await fold(location, definition);
		if (folded !== null && path !== null) writeCache(path, stamp, definition, folded);
		return folded;
	}

	/** The last logged title of one session, when the log holds one. */
	async function titleOf(location) {
		const folded = await fold(location, TITLE_ONLY);
		return folded === null ? undefined : folded.title;
	}

	return { locate, stampOf, fold, foldCached, titleOf };
}
