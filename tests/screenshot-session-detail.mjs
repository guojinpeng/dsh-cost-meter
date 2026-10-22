import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Render the session cost panel with the price formula hint open, using an
 * invented model and usage so the image carries no real data. Requires
 * Playwright and REACT_MODULE_ROOT.
 */

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const runtimeRequire = createRequire(pathToFileURL(join(process.env.REACT_MODULE_ROOT, 'package.json')));
const config = {
	currency: 'CNY', cnyPerUsd: 7.2, showDockChip: true, showTurnChip: true,
	pricing: { 'nebula-labs/nebula-4-lite': { currency: 'CNY', input: 21.6, output: 108, cacheRead: 2.16, cacheWrite: 27 } },
};
const buckets = { uncachedInputTokens: 200000, outputTokens: 10000, cacheReadTokens: 100000, cacheWriteTokens: 1000 };
const accounting = { totals: { ...buckets }, byRoute: { 'nebula-labs/nebula-4-lite': buckets }, turns: {}, skippedTurns: 0 };
const source = [
	"import React from " + JSON.stringify(runtimeRequire.resolve('react')) + ";",
	"import * as ReactDom from " + JSON.stringify(runtimeRequire.resolve('react-dom')) + ";",
	"import { createRoot } from " + JSON.stringify(runtimeRequire.resolve('react-dom/client')) + ";",
	'window.fetch = async () => {',
	'  const body = { config: ' + JSON.stringify(config) + ", models: " + JSON.stringify(['nebula-labs/nebula-4-lite']) + ", revision: 'example' };",
	'  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };',
	'};',
	"import { buildCostView } from './pricing.js';",
	"import { createConfigStore } from './client/config-store.js';",
	"import { createUseCostView } from './client/cost-view.js';",
	"import { createCostDialog } from './client/cost-dialog.js';",
	"import { createCostChips } from './client/cost-chips.js';",
	"import { installStyles } from './client/styles.js';",
	"import { zh } from './client/locales.js';",
	'installStyles();',
	'window.costCards = { ...createCostChips(React, createUseCostView(React, createConfigStore()), createCostDialog(React, ReactDom)), zh };',
	'const raw = { ...buildCostView(' + JSON.stringify(accounting) + ', ' + JSON.stringify(config) + '), accounting: ' + JSON.stringify(accounting) + ' };',
	'const props = { t: (key, values = {}) => String(zh[key] ?? key).replace(/\\{(\\w+)\\}/g, (_, name) => values[name] ?? \'\'), useProjection: () => raw };',
	"createRoot(document.getElementById('root')).render(React.createElement(window.costCards.CostDockChip, props));",
].join('\n');
const bundle = await build({
	stdin: { contents: source, resolveDir: resolve('src'), loader: 'js' },
	bundle: true, write: false, platform: 'browser', loader: { '.css': 'text' }, format: 'iife',
	define: { 'process.env.NODE_ENV': '"production"' },
});
const shotDir = process.env.SCREENSHOT_DIR ?? 'docs/images';
mkdirSync(shotDir, { recursive: true });
const browser = await chromium.launch({
	executablePath:
		process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	headless: true,
});
try {
	const page = await browser.newPage({ viewport: { width: 860, height: 620 }, deviceScaleFactor: 2 });
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>' +
		':root{--dsw-alias-label-primary:#1b1f24;--dsw-alias-label-secondary:#4b5563;--dsw-alias-label-tertiary:#8b929c;--dsw-specific-menu:#fff;' +
		'--dsw-alias-border-l1:#e4e7ec;--dsw-alias-border-l2:#eef0f3;--dsw-radius-lg:10px;--dsw-radius-sm:4px;' +
		'--dsw-elevation-prominent:0 16px 40px #0f172a1f,0 2px 8px #0f172a14;--dsw-alias-interactive-bg-hover:#f1f3f6}' +
		'*{box-sizing:border-box}html,body{margin:0;background:#f6f7f9;font-family:"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",Arial,sans-serif}' +
		'#root{position:absolute;left:56px;top:150px}</style></head><body><div id="root"></div></body></html>');
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.locator('.gdcc_dockPill').click();
	await page.locator('.gdcc_panel').getByText('会话费用', { exact: true }).waitFor();
	await page.locator('.gdcc_panel .gdcc_amount .gdcc_info').first().hover();
	await page.locator('.gdcc_hintPanel').waitFor();
	const panel = await page.locator('.gdcc_panel:not(.gdcc_hintPanel)').boundingBox();
	const hint = await page.locator('.gdcc_hintPanel').boundingBox();
	console.log('panel', JSON.stringify(panel), 'hint', JSON.stringify(hint));
	const pad = 22;
	const clip = {
		x: Math.max(0, Math.round(Math.min(panel.x, hint.x) - pad)),
		y: Math.max(0, Math.round(Math.min(panel.y, hint.y) - pad)),
	};
	clip.width = Math.round(Math.max(panel.x + panel.width, hint.x + hint.width) + pad - clip.x);
	clip.height = Math.round(Math.max(panel.y + panel.height, hint.y + hint.height) + pad - clip.y);
	console.log('clip', JSON.stringify(clip));
	await page.screenshot({ path: join(shotDir, 'session-cost-detail.png'), clip });
	console.log('errors', JSON.stringify(errors));
} finally {
	await browser.close();
}
