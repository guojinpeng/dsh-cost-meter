import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { normalizeRate } from '../pricing.js';
import { PRICE_SOURCES, DEFAULT_PRICE_SOURCE } from '../price-sources.js';
import { normalizeRefreshMinutes } from '../refresh.js';

const STAT_INTERVAL_MS = 1000;

/** Directory name under the DSH home, matching the package name. */
const CONFIG_DIR_NAME = 'dsh-cost-meter';

/** Config file name under {@link CONFIG_DIR_NAME}. */
const CONFIG_FILE_NAME = 'config.json';

/**
 * Resolve the DSH home directory with the official precedence:
 * `$DSH_HOME` when set and non-empty, otherwise `~/.dsh`.
 * Mirrors `@deepseek-ai/dsh-home-paths` `resolveDshHome` without depending on it,
 * so installing this plugin never adds an npm dependency.
 */
export function resolveDshHome(env = process.env) {
	const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
	if (configured !== '') return configured;
	return join(homedir(), '.dsh');
}

/** Absolute path of the unified config file. */
export const CONFIG_PATH = join(resolveDshHome(), 'guojinpeng', CONFIG_DIR_NAME, CONFIG_FILE_NAME);
const LEGACY_CONFIG_PATH = join(resolveDshHome(), CONFIG_DIR_NAME, CONFIG_FILE_NAME);

/** Coerce any parsed JSON value into a complete configuration object. */
function normalizeConfig(raw) {
	const source = raw !== null && typeof raw === 'object' ? raw : {};
	const currency = source.currency === 'USD' || source.currency === 'CNY' ? source.currency : undefined;
	const cnyPerUsd = Number(source.cnyPerUsd);
	const pricing = {};
	const rawPricing = source.pricing !== null && typeof source.pricing === 'object' ? source.pricing : {};
	for (const [key, entry] of Object.entries(rawPricing)) {
		const trimmed = typeof key === 'string' ? key.trim() : '';
		if (trimmed === '') continue;
		const rate = normalizeRate(entry);
		if (rate !== null) pricing[trimmed] = rate;
	}
	return {
		formatVersion: source.formatVersion === 2 ? 2 : 1,
		...(currency ? { currency } : {}),
		...(PRICE_SOURCES.includes(source.priceSource) ? { priceSource: source.priceSource } : {}),
		cnyPerUsd: Number.isFinite(cnyPerUsd) && cnyPerUsd > 0 ? cnyPerUsd : 7.2,
		showDockChip: source.showDockChip !== false,
		showTurnChip: source.showTurnChip !== false,
		showSidebarCost: source.showSidebarCost !== false,
		autoRefreshCost: source.autoRefreshCost !== false,
		autoRefreshMinutes: normalizeRefreshMinutes(source.autoRefreshMinutes),
		pricing,
	};
}

/** The mtime/size-cached config plus the parsed snapshot. */
let configCache = null;
let lastStatAt = 0;

/** Read the config file, honouring the mtime/size cache. */
export function readConfig(force = false) {
	const now = Date.now();
	if (!force && configCache !== null && now - lastStatAt < STAT_INTERVAL_MS) return configCache.config;
	lastStatAt = now;
	try {
		const stats = statSync(CONFIG_PATH);
		if (
			!force &&
			configCache !== null &&
			stats.mtimeMs === configCache.mtimeMs &&
			stats.size === configCache.size
		) {
			return configCache.config;
		}
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
		const config = normalizeConfig(parsed);
		configCache = { mtimeMs: stats.mtimeMs, size: stats.size, config };
		return config;
	} catch (error) {
		if (force) throw error;
		if (configCache !== null) return configCache.config;
		const config = normalizeConfig({});
		configCache = { mtimeMs: -1, size: -1, config };
		return config;
	}
}

/**
 * Cheap identity of the config file, used to invalidate derived caches such as
 * the overview cache when prices change.
 */
export function configStamp() {
	try {
		const stats = statSync(CONFIG_PATH);
		return String(stats.mtimeMs) + ':' + String(stats.size);
	} catch {
		return '';
	}
}

/** Atomically replace the config file and refresh the cache. */
export function writeConfig(config) {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	const tmp = `${CONFIG_PATH}.tmp-${String(process.pid)}`;
	writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
	renameSync(tmp, CONFIG_PATH);
	const stats = statSync(CONFIG_PATH);
	configCache = { mtimeMs: stats.mtimeMs, size: stats.size, config };
	lastStatAt = Date.now();
	return config;
}

/** Create an empty pricing configuration when it does not exist. */
export function seedConfigFile(logger) {
	try {
		if (existsSync(CONFIG_PATH)) return;
		if (existsSync(LEGACY_CONFIG_PATH)) {
			mkdirSync(dirname(CONFIG_PATH), { recursive: true });
			copyFileSync(LEGACY_CONFIG_PATH, CONFIG_PATH);
			return;
		}
		writeConfig(normalizeConfig({ formatVersion: 2, priceSource: DEFAULT_PRICE_SOURCE }));
	} catch (error) {
		logger?.warn(
			'guojinpeng/dsh-cost-meter: could not seed config file',
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}
