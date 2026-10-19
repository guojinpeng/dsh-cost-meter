import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const runtime =
	process.env.DSH_RUNTIME_ROOT ??
	join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@deepseek-ai', 'dsh');
const runtimeRequire = createRequire(
	pathToFileURL(join(process.env.REACT_MODULE_ROOT ?? runtime, 'package.json')),
);
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const language = process.env.SCREENSHOT_LOCALE === 'en' ? 'en' : 'zh';
const buckets = {
	uncachedInputTokens: 200000,
	outputTokens: 10000,
	cacheReadTokens: 100000,
	cacheWriteTokens: 1000,
};
const turnBuckets = {
	uncachedInputTokens: 20000,
	outputTokens: 1000,
	cacheReadTokens: 50000,
	cacheWriteTokens: 500,
};
const config = {
	currency: 'CNY',
	cnyPerUsd: 7.2,
	showDockChip: true,
	showTurnChip: true,
	pricing: {
		'com-aliyun/qwen3.8-max': { currency: 'CNY', input: 14.4, output: 43.2, cacheRead: 1.8, cacheWrite: 18 },
	},
};
const accounting = {
	totals: { ...buckets },
	byRoute: { 'com-aliyun/qwen3.8-max': buckets },
	turns: {
		1: {
			totalTokens: 71500,
			tokens: { ...turnBuckets },
			byRoute: { 'com-aliyun/qwen3.8-max': turnBuckets },
			recovered: false,
		},
	},
	skippedTurns: 0,
};
const mixed = process.env.SCREENSHOT_SCENARIO === 'mixed';
if (mixed) {
	const key = 'deepseek-official/deepseek-flash';
	config.pricing[key] = {
		currency: 'USD',
		autoOffPeak: true,
		input: 0.3,
		output: 1.2,
		cacheRead: 0.006,
		cacheWrite: 0,
	};
	const ds = {
		uncachedInputTokens: 400000,
		outputTokens: 3000,
		cacheReadTokens: 100000,
		cacheWriteTokens: 0,
	};
	accounting.byRoute[key] = ds;
	accounting.calendars = { 2026: ['2026-10-01'] };
	accounting.byTime = {
		[key]: {
			'2026-10-01/am': Object.fromEntries(Object.entries(ds).map(([field, count]) => [field, count / 2])),
			'2026-10-14/am': Object.fromEntries(Object.entries(ds).map(([field, count]) => [field, count / 2])),
		},
	};
	for (const field of Object.keys(ds)) accounting.totals[field] += ds[field];
	accounting.turns['1'].byRoute[key] = ds;
	accounting.turns['1'].byTime = accounting.byTime;
	for (const field of Object.keys(ds)) accounting.turns['1'].tokens[field] += ds[field];
	accounting.turns['1'].totalTokens += Object.values(ds).reduce((sum, value) => sum + value, 0);
}
const source = `
import React from ${JSON.stringify(runtimeRequire.resolve('react'))};
import * as ReactDom from ${JSON.stringify(runtimeRequire.resolve('react-dom'))};
import { createRoot } from ${JSON.stringify(runtimeRequire.resolve('react-dom/client'))};
window.configRequests = 0;
const configReady = new Promise(resolve => { window.completeConfigLoad = resolve; });
window.fetch = async () => {
 window.configRequests++;
 await configReady;
 return { ok: true, json: async () => ({ config: ${JSON.stringify(config)}, models: ${JSON.stringify(Object.keys(config.pricing))}, revision: 'example' }) };
};
import { buildCostView } from './pricing.js';
import { createConfigStore } from './client/config-store.js';
import { createUseCostView } from './client/cost-view.js';
import { createCostDialog } from './client/cost-dialog.js';
import { createCostChips } from './client/cost-chips.js';
import { installStyles } from './client/styles.js';
import { zh, en } from './client/locales.js';
installStyles();
window.costCards = { ...createCostChips(React, createUseCostView(React, createConfigStore()), createCostDialog(React, ReactDom)), zh, en };
const accounting = ${JSON.stringify(accounting)};
const raw = { ...buildCostView(accounting, ${JSON.stringify(config)}), accounting };
const props = { t: (key, values = {}) => window.costCards[${JSON.stringify(language)}][key].replace(/\\{(\\w+)\\}/g, (_, key) => values[key] ?? ''), useProjection: () => raw };
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
	executablePath:
		process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	headless: true,
});
try {
	const page = await browser.newPage({ viewport: { width: 720, height: 640 }, deviceScaleFactor: 2 });
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.setContent(
		`<html><head><style>:root{--dsw-alias-label-primary:#202124;--dsw-alias-label-secondary:#555;--dsw-alias-label-tertiary:#80868b;--dsw-specific-menu:#fff;--dsw-alias-border-l1:#e2e3e5;--dsw-alias-border-l2:#eceef0;--dsw-radius-lg:8px;--dsw-radius-sm:4px;--dsw-elevation-prominent:0 2px 12px #0002}body{margin:0;font-family:Arial,sans-serif;background:#fff}
.hostRow{position:fixed;left:32px;top:32px;display:flex;align-items:center;gap:8px;font:13px Arial;color:#80868b}
.xD_KDq_actions{display:flex;align-items:center;gap:8px;height:28px}
.xD_KDq_endInfo{min-width:0;display:inline-flex;align-items:center;gap:8px;margin-left:8px}
.hostRow button{font:inherit;color:inherit;background:0 0;border:0;padding:0;cursor:pointer}
</style></head><body><div id="root"></div>
<div class="hostRow" id="hostRow"><span class="xD_KDq_actions" id="hostActions"><button type="button" id="copy">copy</button><div data-slot="conversation.chat.assistant-actions" style="display:contents"><span class="gdcc_turnRoot" id="hostChip"><button type="button" class="gdcc_turnTrigger" id="hostTrigger">¥0.43</button></span></div><button type="button" id="branch">branch</button><span class="xD_KDq_endInfo" id="hostEnd"><button type="button" id="usage">1.5M tok</button><span class="xD_KDq_timeEnd" id="hostTime">16:06</span></span></span></div>
</body></html>`,
	);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.locator('#root .gdcc_dockPill').waitFor();
	await page.locator('#root .gdcc_turnTrigger').waitFor();
	assert.equal(
		await page.locator('.gdcc_initializing').count(),
		0,
		'configured fees show while GET is pending',
	);
	assert.equal(
		await page.evaluate(() => window.configRequests),
		1,
		'both chips share the pending config request',
	);
	await page.evaluate(() => window.completeConfigLoad());
	// The chip sits between the official usage pill and the clock: the slot
	// anchor and the footer span both become pass-throughs, then flex order
	// places the three items. The anchor div mirrors the host slot wrapper, so
	// a direct-child selector on the actions row fails here as it does there.
	const hostBox = async (selector) => await page.locator(selector).boundingBox();
	const chipBox = await hostBox('#hostChip');
	const usageBox = await hostBox('#usage');
	const branchBox = await hostBox('#branch');
	const timeBox = await hostBox('#hostTime');
	assert.equal(
		await page.locator('#hostEnd').evaluate((element) => getComputedStyle(element).display),
		'contents',
		'the host footer span becomes a pass-through',
	);
	assert.ok(branchBox.x < usageBox.x, 'the branch button keeps the host order');
	assert.ok(usageBox.x < chipBox.x, 'the chip follows the official usage pill');
	assert.ok(chipBox.x + chipBox.width <= timeBox.x, 'the clock stays last');
	await page.locator('#usage').evaluate((element) => element.remove());
	const bareChip = await hostBox('#hostChip');
	const bareTime = await hostBox('#hostTime');
	assert.ok(bareChip.x + bareChip.width <= bareTime.x, 'without a usage pill the chip still precedes the clock');
	const screenshotDir = process.env.SCREENSHOT_DIR ?? 'docs/images';
	mkdirSync(screenshotDir, { recursive: true });
	await page.locator('#root .gdcc_dockPill').click();
	await page
		.locator('.gdcc_panel')
		.getByText(language === 'en' ? 'Session cost' : '会话费用', { exact: true })
		.waitFor();
	if (mixed) {
		assert.ok((await page.locator('.gdcc_titleValue').textContent()).includes('¥'));
		assert.ok((await page.locator('.gdcc_titleValue').textContent()).includes('$'));
		for (const label of [
			language === 'en' ? 'Peak price' : '峰价',
			language === 'en' ? 'Off-peak price' : '谷价',
			language === 'en' ? 'Fixed price' : '固定价',
		])
			assert.ok(
				await page.locator('.gdcc_panel').getByText(label, { exact: true }).first().isVisible(),
				label + ' group is shown',
			);
	}
	const info = page.locator('.gdcc_panel .gdcc_amount .gdcc_info').first();
	const hint = page.locator('.gdcc_hintPanel');
	await info.hover();
	await hint.waitFor();
	const hintText = await hint.textContent();
	assert.ok(hintText.includes('÷'), 'the hint panel shows the price formula');
	assert.ok(!hintText.includes('1M tok'), 'the hint panel holds the formula only');
	await info.click();
	assert.equal(await hint.count(), 1, 'a click does not pin the hint');
	await page.mouse.move(0, 0);
	await hint.waitFor({ state: 'detached' });
	await page.locator('.gdcc_panel').screenshot({ path: join(screenshotDir, 'session-cost.png') });
	await page.keyboard.press('Escape');
	await page.locator('#root .gdcc_turnTrigger').click();
	await page
		.locator('.gdcc_panel')
		.getByText(language === 'en' ? 'Turn cost' : '本轮费用', { exact: true })
		.waitFor();
	if (mixed) {
		for (const label of [
			language === 'en' ? 'Uncached input' : '未缓存输入',
			language === 'en' ? 'Output' : '输出',
		])
			assert.ok(
				await page.locator('.gdcc_panel').getByText(label, { exact: true }).first().isVisible(),
				'the turn panel shows the ' + label + ' price row',
			);
	}
	await page.locator('.gdcc_panel').screenshot({ path: join(screenshotDir, 'turn-cost.png') });
	if (mixed) {
		await page.locator('.gdcc_panel .gdcc_amount .gdcc_info').first().hover();
		await hint.waitFor();
		assert.ok((await hint.textContent()).includes('÷'), 'the turn hint panel shows the price formula');
		await page.mouse.move(0, 0);
		await hint.waitFor({ state: 'detached' });
	}
	assert.deepEqual(errors, []);
	console.log('Session and turn cost screenshots created from real components with example accounting.');
} finally {
	await browser.close();
}
