import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exampleOverviewPayload } from './example-scenario.mjs';

/**
 * Render the market overview image: the cost overview page at desktop width
 * in a dark theme, topped by the trend card, with the scatter card as a
 * second panel, over a designed backdrop. The same run also drops the plain
 * light cost overview page, which the plugin market shows as a screenshot.
 * The scenario is invented (see example-scenario.mjs), so no real data
 * reaches the images. Requires Playwright and REACT_MODULE_ROOT.
 */
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const runtimeRequire = createRequire(pathToFileURL(join(process.env.REACT_MODULE_ROOT, 'package.json')));
const words = {
	title: '费用统计<br><em>一眼看清钱花在哪</em>',
	lead: '基于 DSH 本地会话日志的真实用量，按官方单价估算每一笔 token 费用。',
	items: [
		['费用与 Token 双指标', '构成、时段分布、模型占比一起换算，缓存命中率随时可见。'],
		['点击趋势柱回查时间段', '单日、区间、整月都支持，点击即回填日期范围并重新统计。'],
		['模型性价比散点图', '颜色越浅每 1M token 越便宜，点图例可隐藏模型。'],
	],
	foot: '中文 / English · 峰谷价与多币种 · 会话面板与本轮费用胶囊',
	install: 'dsh plugin --profile web add -w @guojinpeng/dsh-cost-meter',
};
const itemHtml = words.items.map(([title, text]) => '<div class="item"><i class="dot"></i><div><b>' + title + '</b><span>' + text + '</span></div></div>').join('');
const shotDir = process.env.SCREENSHOT_DIR ?? 'docs/images';
const payloadText = JSON.stringify(exampleOverviewPayload);
const partsDir = await mkdtemp(join(tmpdir(), 'gdcc-overview-'));
mkdirSync(shotDir, { recursive: true });
const pageSource = [
	"import React from " + JSON.stringify(runtimeRequire.resolve('react')) + ";",
	"import { createRoot } from " + JSON.stringify(runtimeRequire.resolve('react-dom/client')) + ";",
	"import { createCostOverviewPage } from './client/cost-overview.js';",
	"import { installStyles } from './client/styles.js';",
	"import { zh } from './client/locales.js';",
	'installStyles();',
	'const payload = ' + payloadText + ';',
	'window.fetch = async () => ({ ok: true, status: 200, json: async () => payload });',
	"const snapshot = { config: { currency: 'CNY', cnyPerUsd: 7.2 } };",
	'const store = { subscribe: () => () => {}, getSnapshot: () => snapshot, load: async () => {} };',
	'const Page = createCostOverviewPage(React, store);',
	'const t = (key, values = {}) => String(zh[key] ?? key).replace(/\\{(\\w+)\\}/g, (_, name) => values[name] ?? \'\');',
	"createRoot(document.getElementById('root')).render(React.createElement(Page, { t, openSession() {}, openSettings() {} }));",
].join('\n');

const bundle = await build({
	stdin: { contents: pageSource, resolveDir: resolve('src'), loader: 'js' },
	bundle: true, write: false, platform: 'browser', loader: { '.css': 'text' }, format: 'iife',
	define: { 'process.env.NODE_ENV': '"production"' },
});
const script = bundle.outputFiles[0].text;
console.log('bundle bytes', script.length);

const DARK = [
	'--dsw-alias-bg-base:#1a1d22', '--dsw-alias-bg-layer-1:#20242a', '--dsw-alias-bg-layer-3:#2a2f37',
	'--dsw-alias-label-primary:#eef1f6', '--dsw-alias-label-secondary:#b3bac5', '--dsw-alias-label-tertiary:#8a929e',
	'--dsw-alias-border-l1:#343a43', '--dsw-alias-border-l2:#2b3038', '--dsw-alias-border-l3:#3b424c', '--dsw-alias-border-l4:#47505b',
	'--dsw-alias-interactive-bg-hover:#2a3038', '--dsw-alias-state-business-primary:#3b82f6', '--dsw-alias-state-error-primary:#ef4444',
	'--dsw-elevation-prominent:0 18px 44px #000a', '--dsw-elevation-stroke-color:#ffffff1f', '--dsw-focus-ring-color:#3b82f6', '--dsw-focus-ring-width:2px',
	'--dsw-menu-backdrop-filter:blur(12px)', '--dsw-specific-menu:#262b33', '--dsw-shadow-l2:0 8px 24px #0007',
	'--dsw-radius-xl:14px', '--dsw-radius-lg:12px', '--dsw-radius-md:10px', '--dsw-radius-sm:8px', '--dsw-radius-xs:6px',
];
const LIGHT = [
	'--dsw-alias-bg-base:#f6f7f9', '--dsw-alias-bg-layer-1:#ffffff', '--dsw-alias-bg-layer-3:#f2f4f7',
	'--dsw-alias-label-primary:#1b1f24', '--dsw-alias-label-secondary:#4b5563', '--dsw-alias-label-tertiary:#8b929c',
	'--dsw-alias-border-l1:#e4e7ec', '--dsw-alias-border-l2:#eef0f3', '--dsw-alias-border-l3:#e8ebef', '--dsw-alias-border-l4:#dfe3e8',
	'--dsw-alias-interactive-bg-hover:#f1f3f6', '--dsw-alias-state-business-primary:#2563eb', '--dsw-alias-state-error-primary:#dc2626',
	'--dsw-elevation-prominent:0 16px 40px #0f172a1f,0 2px 8px #0f172a14', '--dsw-elevation-stroke-color:#0f172a1f', '--dsw-focus-ring-color:#2563eb', '--dsw-focus-ring-width:2px',
	'--dsw-menu-backdrop-filter:blur(12px)', '--dsw-specific-menu:#ffffff', '--dsw-shadow-l2:0 8px 24px #0f172a1a',
	'--dsw-radius-xl:14px', '--dsw-radius-lg:12px', '--dsw-radius-md:10px', '--dsw-radius-sm:8px', '--dsw-radius-xs:6px',
];
const shell = (vars) => [
	'<!doctype html><html><head><meta charset="utf-8"><style>',
	':root{' + vars.join(';') + '}',
	'*{box-sizing:border-box}',
	'html,body{margin:0;padding:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);',
	'font-family:"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}',
	'#root{min-height:100vh}',
	'</style></head><body><div id="root"></div></body></html>',
].join('');

mkdirSync('docs/images', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const errors = [];
try {
	const dark = await browser.newPage({ viewport: { width: 1240, height: 1520 }, deviceScaleFactor: 2 });
	dark.on('pageerror', (error) => { errors.push('dark: ' + error.message); console.log('pageerror', error.message.slice(0, 300)); });
	await dark.setContent(shell(DARK));
	await dark.addScriptTag({ content: script });
	await dark.locator('.gdcc_ovScatterPlot').waitFor({ timeout: 20000 });
	await dark.waitForTimeout(1200);
	const darkBox = await dark.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, cards: document.querySelectorAll('.gdcc_ovCard').length }));
	console.log('dark page', JSON.stringify(darkBox));
	const trendCard = dark.locator('.gdcc_ovCard').filter({ has: dark.locator('.gdcc_ovBarSeg--input') }).first();
	const trendBox = await trendCard.boundingBox();
	const clipHeight = Math.round(trendBox.y + trendBox.height + 26);
	await dark.screenshot({ path: join(partsDir, 'panel-main.png'), clip: { x: 0, y: 0, width: 1240, height: clipHeight } });
	const scatterCard = dark.locator('.gdcc_ovCard').filter({ has: dark.locator('.gdcc_ovScatterPlot') }).first();
	const scatterBox = await scatterCard.boundingBox();
	// The legend under the plot is taller than the hero has room for, so the
	// scatter panel stops at the plot, x labels included.
	const scatterContentBottom = await dark.evaluate(() => {
		const card = [...document.querySelectorAll('.gdcc_ovCard')].find((element) =>
			element.querySelector('.gdcc_ovScatterPlot'),
		);
		const boxes = [card.querySelector('.gdcc_ovScatterPlot'), ...card.querySelectorAll('.gdcc_ovScatterTick--x')].map(
			(element) => element.getBoundingClientRect(),
		);
		return { top: card.getBoundingClientRect().top, bottom: Math.max(...boxes.map((box) => box.bottom)) };
	});
	const scatterShotHeight = Math.round(scatterContentBottom.bottom - scatterContentBottom.top + 28);
	await dark.screenshot({
		path: join(partsDir, 'scatter-card.png'),
		clip: { x: scatterBox.x, y: scatterBox.y, width: scatterBox.width, height: scatterShotHeight },
	});
	console.log('clip', clipHeight, 'scatter', JSON.stringify(scatterBox), 'scatter shot', scatterShotHeight);

	const light = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
	light.on('pageerror', (error) => errors.push('light: ' + error.message));
	await light.setContent(shell(LIGHT));
	await light.addScriptTag({ content: script });
	await light.locator('.gdcc_ovScatterPlot').waitFor({ timeout: 20000 });
	await light.waitForTimeout(1200);
	console.log('light page', JSON.stringify(await light.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }))));
	await light.screenshot({ path: join(shotDir, 'cost-overview.png'), fullPage: true });

	const panelWidth = 940;
	const mainHeight = Math.round(clipHeight * (panelWidth / 1240));
	const scatterHeight = Math.round((scatterShotHeight / scatterBox.width) * panelWidth);
	const canvasHeight = 1000;
	const gap = 22;
	const mainTop = Math.max(34, Math.round((canvasHeight - (mainHeight + gap + scatterHeight)) / 2));
	const scatterTop = mainTop + mainHeight + gap;
	const scatterClip = Math.min(scatterHeight, canvasHeight - scatterTop - 26);
	console.log('hero layout', JSON.stringify({ clipHeight, mainHeight, scatterHeight, scatterClip, mainTop, scatterTop }));
	const heroHtml = [
		'<!doctype html><html><head><meta charset="utf-8"><style>',
		'html,body{margin:0;width:1600px;height:' + canvasHeight + 'px;overflow:hidden;background:#0b0f14;color:#eef2f8;',
		'font-family:"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}',
		'.canvas{position:absolute;inset:0;background:radial-gradient(880px 620px at 72% 10%,rgba(56,110,255,.18),transparent 62%),radial-gradient(680px 520px at 6% 98%,rgba(80,220,220,.12),transparent 62%),linear-gradient(150deg,#0b0f14 0%,#0d131b 56%,#0a0f16 100%)}',
		'.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:48px 48px;-webkit-mask-image:radial-gradient(circle at 66% 42%,#000 0%,transparent 78%)}',
		'.hero{position:absolute;left:86px;top:116px;width:446px}',
		'.eyebrow{display:flex;align-items:center;gap:10px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#7fa6ff}',
		'.eyebrow .tag{border:1px solid rgba(127,166,255,.42);border-radius:999px;padding:3px 10px;letter-spacing:.04em;color:#a8c2ff;text-transform:none;font-size:12.5px}',
		'h1{margin:24px 0 15px;font-size:45px;line-height:1.22;font-weight:600;letter-spacing:-.015em}',
		'h1 em{font-style:normal;background:linear-gradient(96deg,#8ff0e2,#7fa6ff 58%,#b98cff);-webkit-background-clip:text;background-clip:text;color:transparent}',
		'.lead{margin:0 0 26px;font-size:15px;line-height:1.72;color:#97a4b6}',
		'.items{display:flex;flex-direction:column;gap:14px}',
		'.item{display:flex;gap:11px;align-items:flex-start}',
		'.dot{margin-top:7px;width:6px;height:6px;border-radius:50%;background:#6ea8ff;box-shadow:0 0 12px #6ea8ff;flex:none}',
		'.item b{display:block;font-size:15px;font-weight:600;color:#e8eef7;margin-bottom:3px}',
		'.item span{font-size:12.5px;line-height:1.55;color:#8b98a8}',
		'.foot{position:absolute;left:86px;bottom:54px;font-size:12.5px;color:#6b7889}',
		'.cmd{position:absolute;left:86px;bottom:108px;display:flex;align-items:center;gap:12px;font-size:12px;color:#6b7889}',
		'.cmd code{font:12.5px/1 Consolas,"Courier New",monospace;color:#c6d4ea;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.09);border-radius:9px;padding:10px 14px}',
		'.panel{position:absolute;left:596px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#14181f;box-shadow:0 34px 80px rgba(0,0,0,.6),0 4px 16px rgba(0,0,0,.4)}',
		'.panel img{display:block;width:100%;height:auto}',
		'.main{top:' + mainTop + 'px;width:' + panelWidth + 'px;height:' + mainHeight + 'px}',
		'.main .fade{position:absolute;left:0;right:0;bottom:0;height:120px;background:linear-gradient(to bottom,rgba(20,24,31,0),rgba(20,24,31,.95))}',
		'.scatter{top:' + scatterTop + 'px;width:' + panelWidth + 'px;height:' + scatterClip + 'px}',
		'</style></head><body><div class="canvas"></div><div class="grid"></div>',
		'<div class="hero">',
		'<div class="eyebrow"><span class="tag">dsh-cost-meter</span><span>v0.4.7</span></div>',
		'<h1>' + words.title + '</h1>',
		'<p class="lead">' + words.lead + '</p>',
		'<div class="items">' + itemHtml + '</div></div>',
		'<div class="cmd"><span>安装</span><code>' + words.install + '</code></div>',
		'<div class="foot">' + words.foot + '</div>',
		'<div class="panel main"><img src="panel-main.png" alt=""><div class="fade"></div></div>',
		'<div class="panel scatter"><img src="scatter-card.png" alt=""></div>',
		'</body></html>',
	].join('');
	writeFileSync(join(partsDir, 'hero.html'), heroHtml);
	const hero = await browser.newPage({ viewport: { width: 1600, height: canvasHeight }, deviceScaleFactor: 1.5 });
	await hero.goto(pathToFileURL(join(partsDir, 'hero.html')).href);
	await hero.waitForFunction(() => { const img = document.querySelector('.panel img'); return img && img.complete && img.naturalWidth > 0; }, null, { timeout: 20000 });
	await hero.waitForTimeout(300);
	await hero.screenshot({ path: join(shotDir, 'overview.png') });
	console.log('hero ok');
	console.log('errors', JSON.stringify(errors));
} finally {
	await browser.close();
}
