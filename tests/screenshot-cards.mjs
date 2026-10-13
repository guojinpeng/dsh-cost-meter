import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const runtime =
	process.env.DSH_RUNTIME_ROOT ?? join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@deepseek-ai', 'dsh');
const runtimeRequire = createRequire(pathToFileURL(join(process.env.REACT_MODULE_ROOT ?? runtime, 'package.json')));
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const language = process.env.SCREENSHOT_LOCALE === 'en' ? 'en' : 'zh';
const buckets = { uncachedInputTokens: 200000, outputTokens: 10000, cacheReadTokens: 100000, cacheWriteTokens: 1000 };
const turnBuckets = { uncachedInputTokens: 20000, outputTokens: 1000, cacheReadTokens: 50000, cacheWriteTokens: 500 };
const config = {
	currency: 'CNY',
	cnyPerUsd: 7.2,
	showDockChip: true,
	showTurnChip: true,
	pricing: { 'com-aliyun/qwen3.8-max': { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 } },
};
const accounting = {
	totals: buckets,
	byRoute: { 'com-aliyun/qwen3.8-max': buckets },
	turns: {
		1: {
			totalTokens: 71500,
			tokens: turnBuckets,
			byRoute: { 'com-aliyun/qwen3.8-max': turnBuckets },
			recovered: false,
		},
	},
	skippedTurns: 0,
};
const source = `
import React from ${JSON.stringify(runtimeRequire.resolve('react'))};
import * as ReactDom from ${JSON.stringify(runtimeRequire.resolve('react-dom'))};
import { createRoot } from ${JSON.stringify(runtimeRequire.resolve('react-dom/client'))};
window.fetch = async () => ({ ok: true, json: async () => ({ config: ${JSON.stringify(config)}, models: ['com-aliyun/qwen3.8-max'], revision: 'example' }) });
import { createConfigStore } from './client/config-store.js';
import { createUseCostView } from './client/cost-view.js';
import { createCostDialog } from './client/cost-dialog.js';
import { createCostChips } from './client/cost-chips.js';
import { installStyles } from './client/styles.js';
import { zh, en } from './client/locales.js';
installStyles();
window.costCards = { ...createCostChips(React, createUseCostView(React, createConfigStore()), createCostDialog(React, ReactDom)), zh, en };
const accounting = ${JSON.stringify(accounting)};
const props = { t: (key, values = {}) => window.costCards[${JSON.stringify(language)}][key].replace(/\\{(\\w+)\\}/g, (_, key) => values[key] ?? ''), useProjection: () => ({ accounting }) };
createRoot(document.getElementById('root')).render(React.createElement('div', { style: { position: 'fixed', bottom: 32, left: 32, display: 'flex', gap: 24 } }, [
 React.createElement(window.costCards.CostDockChip, { ...props, key: 'session' }),
 React.createElement(window.costCards.CostTurnChip, { ...props, key: 'turn', turn: 1 }),
]));
`;
const bundle = await build({
	stdin: { contents: source, resolveDir: resolve('src'), loader: 'js' },
	bundle: true,
	write: false,
	platform: 'browser',
	loader: { '.css': 'text' },
	format: 'iife',
	define: { 'process.env.NODE_ENV': '"production"' },
});
const browser = await chromium.launch({
	executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	headless: true,
});
try {
	const page = await browser.newPage({ viewport: { width: 720, height: 640 }, deviceScaleFactor: 2 });
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.setContent(
		`<html><head><style>:root{--dsw-alias-label-primary:#202124;--dsw-alias-label-secondary:#555;--dsw-alias-label-tertiary:#80868b;--dsw-specific-menu:#fff;--dsw-alias-border-l1:#e2e3e5;--dsw-alias-border-l2:#eceef0;--dsw-radius-lg:8px;--dsw-radius-sm:4px;--dsw-elevation-prominent:0 2px 12px #0002}body{margin:0;font-family:Arial,sans-serif;background:#fff}</style></head><body><div id="root"></div></body></html>`,
	);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	const screenshotDir = process.env.SCREENSHOT_DIR ?? 'docs/images';
	mkdirSync(screenshotDir, { recursive: true });
	await page.locator('.gdcc_dockPill').click();
	await page.locator('.gdcc_panel').getByText(language === 'en' ? 'Session cost' : '会话费用', { exact: true }).waitFor();
	await page.locator('.gdcc_panel').screenshot({ path: join(screenshotDir, 'session-cost.png') });
	await page.keyboard.press('Escape');
	await page.locator('.gdcc_turnTrigger').click();
	await page.locator('.gdcc_panel').getByText(language === 'en' ? 'Turn cost' : '本轮费用', { exact: true }).waitFor();
	await page.locator('.gdcc_panel').screenshot({ path: join(screenshotDir, 'turn-cost.png') });
	assert.deepEqual(errors, []);
	console.log('Session and turn cost screenshots created from real components with example accounting.');
} finally {
	await browser.close();
}
