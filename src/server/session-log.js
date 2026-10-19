import { readdirSync, readFileSync, statSync } from 'node:fs';
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
function pushLine(events, line) {
	const text = line.trim();
	if (text === '') return;
	try {
		events.push(JSON.parse(text));
	} catch {
		// A torn tail line is not an event.
	}
}

/**
 * Read the events of one session log. Complete compressed frames are decoded
 * one by one, so a damaged tail keeps the events before it.
 * @param location - a location from the session log reader.
 * @returns the session events that could be read.
 */
function eventsOf(location) {
	const buffer = readFileSync(location.path);
	if (!location.zstd) {
		const events = [];
		for (const line of buffer.toString('utf8').split('\n')) pushLine(events, line);
		return events;
	}
	if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('zstd is not available in this Node.js');
	const frames = completeFrames(buffer);
	if (frames.length === 0 && buffer.length > 0) throw new Error('unreadable session log');
	const events = [];
	let carry = '';
	for (const frame of frames) {
		let text;
		try {
			text = zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8');
		} catch {
			// A corrupt frame ends the readable part of the log.
			break;
		}
		carry += text;
		const lines = carry.split('\n');
		carry = lines.pop();
		for (const line of lines) pushLine(events, line);
	}
	if (carry !== '') pushLine(events, carry);
	return events;
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
 * @param options - root overrides the sessions directory, onError receives
 * each read failure.
 * @returns the log reader: locate, stampOf, fold, titleOf.
 */
export function createSessionLogs({ root, onError = () => {} } = {}) {
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
	function fold(location, definition) {
		let events;
		try {
			events = eventsOf(location);
		} catch (error) {
			onError(error);
			return null;
		}
		let state = definition.init();
		let title;
		for (const event of events) {
			if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title !== '')
				title = event.data.title;
			state = definition.apply(state, event);
		}
		return { state, title };
	}

	/** The last logged title of one session, when the log holds one. */
	function titleOf(location) {
		const folded = fold(location, TITLE_ONLY);
		return folded === null ? undefined : folded.title;
	}

	return { locate, stampOf, fold, titleOf };
}
