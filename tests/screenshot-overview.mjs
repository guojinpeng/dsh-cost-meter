import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

/**
 * Render the market overview image: the two cards in their real components,
 * opened at once, the price formula popover of one row, and the two chips that
 * anchor the cards, over a designed backdrop. The image is 16:10 because the
 * plugin market shows screenshots in that frame.
 */
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
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const width = 1600;
const height = 1000;
const cardGap = 64;
// The formula popover opens on this hint row of the right card: the off-peak
// uncached input, so the formula shows the rate and the off-peak factor. A
// popover always opens 6px above its hint, so the shot lifts that card by the
// height of the row and the popover ends up one formulaGap above the card top
// (see the tail).
const hintIndex = 7;
const slotTop = 848;
const formulaGap = 14;
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
// A second route with off-peak pricing shows the peak and off-peak groups and
// the mixed currency title in the same shot.
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

const words = {
	zh: {
		title: '会话与本轮费用，一眼看清',
		lead: '按官方单价估算 token 费用 · 峰谷价与多币种 · 与 DSH 控件同风格',
		note: '点开胶囊，查看每个模型、每个价格时段的明细与价格公式',
	},
	en: {
		title: 'Session and turn cost at a glance',
		lead: 'Token cost from official prices · Peak and off-peak rates · Multilingual',
		note: 'Open a chip for the detail and the price formula of each model and price window',
	},
}[language];
const source = `
import React from ${JSON.stringify(runtimeRequire.resolve('react'))};
import * as ReactDom from ${JSON.stringify(runtimeRequire.resolve('react-dom'))};
import { createRoot } from ${JSON.stringify(runtimeRequire.resolve('react-dom/client'))};
window.configRequests = 0;
const configReady = new Promise(resolve => { window.completeConfigLoad = resolve; });
window.fetch = async () => {
 window.configRequests++;
 await configReady;
 const body = { config: ${JSON.stringify(config)}, models: ${JSON.stringify(Object.keys(config.pricing))}, revision: 'example' };
	return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
};
import { buildCostView } from './pricing.js';
import { createConfigStore } from './client/config-store.js';
import { createUseCostView } from './client/cost-view.js';
import { createCostDialog } from './client/cost-dialog.js';
import { createCostChips } from './client/cost-chips.js';
import { createCostIcon } from './client/icons.js';
import { installStyles } from './client/styles.js';
import { zh, en } from './client/locales.js';
installStyles();
window.costOverview = { ...createCostChips(React, createUseCostView(React, createConfigStore()), createCostDialog(React, ReactDom)), CostIcon: createCostIcon(React), zh, en };
const raw = { ...buildCostView(${JSON.stringify(accounting)}, ${JSON.stringify(config)}), accounting: ${JSON.stringify(accounting)} };
const props = { t: (key, values = {}) => window.costOverview[${JSON.stringify(language)}][key].replace(/\\{(\\w+)\\}/g, (_, name) => values[name] ?? ''), useProjection: () => raw };
createRoot(document.getElementById('brand')).render(React.createElement(window.costOverview.CostIcon, { size: 15 }));
createRoot(document.getElementById('dockChip')).render(React.createElement(window.costOverview.CostDockChip, props));
createRoot(document.getElementById('turnChip')).render(React.createElement(window.costOverview.CostTurnChip, { ...props, turn: 1 }));
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
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1.5 });
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const openCards = () =>
		page.evaluate(() => {
			for (const element of document.querySelectorAll('.gdcc_dockPill, .gdcc_turnTrigger')) element.click();
		});
	const closeCards = () =>
		page.evaluate(() => {
			for (const element of document.querySelectorAll('.gdcc_dockPill, .gdcc_turnTrigger'))
				if (element.getAttribute('aria-expanded') === 'true') element.click();
		});
	const measure = () =>
		page.evaluate(() => {
			const boxes = [];
			for (const panel of document.querySelectorAll('.gdcc_panel')) {
				const rect = panel.getBoundingClientRect();
				boxes.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
			}
			return boxes;
		});
	await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
:root{--dsw-alias-label-primary:#1b1f24;--dsw-alias-label-secondary:#4b5563;--dsw-alias-label-tertiary:#8b929c;--dsw-specific-menu:#fff;--dsw-alias-border-l1:#e4e7ec;--dsw-alias-border-l2:#eef0f3;--dsw-radius-lg:10px;--dsw-radius-sm:4px;--dsw-elevation-prominent:0 16px 40px #0f172a1f,0 2px 8px #0f172a14;--dsw-alias-interactive-bg-hover:#f1f3f6}
*{box-sizing:border-box}
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
body{background:#f6f7f9;font-family:"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",Arial,sans-serif;color:#1b1f24;-webkit-font-smoothing:antialiased}
.canvas{position:absolute;inset:0;background:linear-gradient(135deg,#ffffff 0%,#f5f7fa 44%,#e7ecf4 100%)}
.glow{position:absolute;border-radius:50%;filter:blur(90px);opacity:.6}
.glow.a{width:560px;height:560px;left:-160px;top:-220px;background:#dce8ff}
.glow.b{width:680px;height:680px;right:-220px;top:40px;background:#e6eefc}
.hero{position:absolute;left:88px;top:70px;max-width:760px}
.brandRow{display:flex;align-items:center;gap:8px;color:#8b929c;font-size:13px;letter-spacing:.14em;text-transform:uppercase}
.brandName{font-weight:600}
h1{margin:18px 0 12px;font-size:42px;line-height:1.22;letter-spacing:-.01em;font-weight:600}
.lead{margin:0;font-size:16px;line-height:1.6;color:#5b6472}
.badge{position:absolute;right:88px;top:74px;font-size:13px;color:#8b929c;border:1px solid #e4e7ec;border-radius:999px;padding:6px 12px;background:#ffffffc0}
.note{position:absolute;left:0;right:0;top:${slotTop + 52}px;margin:0;text-align:center;font-size:14px;color:#8b929c}
.slot{position:absolute;top:${slotTop}px;display:flex;align-items:flex-end}
</style></head><body><div class="canvas">
<div class="glow a"></div><div class="glow b"></div>
<div class="hero">
<div class="brandRow"><span id="brand"></span><span class="brandName">dsh-cost-meter</span></div>
<h1>${words.title}</h1>
<p class="lead">${words.lead}</p>
</div>
<div class="badge">v${version}</div>
<p class="note" id="note">${words.note}</p>
<div class="slot" id="slotDock"><div id="dockChip"></div></div>
<div class="slot" id="slotTurn"><div id="turnChip"></div></div>
</div></body></html>`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.locator('#dockChip .gdcc_dockPill').waitFor();
	await page.locator('#turnChip .gdcc_turnTrigger').waitFor();
	await page.evaluate(() => window.completeConfigLoad());
	// Measure the card widths, then centre the pair and open both again.
	await openCards();
	for (const panel of await page.locator('.gdcc_panel').all()) await panel.waitFor();
	const first = await measure();
	await closeCards();
	for (const panel of await page.locator('.gdcc_panel').all()) await panel.waitFor({ state: 'detached' });
	const total = first[0].width + first[1].width + cardGap;
	const left = Math.round((width - total) / 2);
	await page.evaluate(
		(values) => {
			document.getElementById('slotDock').style.left = values.left + 'px';
			document.getElementById('slotTurn').style.left = values.left + values.firstWidth + values.gap + 'px';
		},
		{ left, firstWidth: first[0].width, gap: cardGap },
	);
	await openCards();
	for (const panel of await page.locator('.gdcc_panel').all()) await panel.waitFor();
	const boxes = await measure();
	assert.equal(boxes.length, 2, 'both cards stay open at once');
	assert.ok(boxes[0].x + boxes[0].width <= boxes[1].x, 'the cards do not overlap: ' + JSON.stringify(boxes));
	assert.ok(boxes[0].y > 240, 'the cards clear the heading: ' + JSON.stringify(boxes[0]));
	assert.ok(
		Math.abs(boxes[0].x - (width - (boxes[1].x + boxes[1].width))) < 2,
		'the pair is centred: ' + JSON.stringify(boxes),
	);
	// The real hover still proves that the info button opens its formula.
	const row = () =>
		page.evaluate((index) => {
			const panels = [...document.querySelectorAll('.gdcc_panel')]
				.filter((panel) => !panel.classList.contains('gdcc_hintPanel'))
				.sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
			const card = panels[panels.length - 1];
			const roots = [...card.querySelectorAll('.gdcc_hintRoot')].sort(
				(a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y,
			);
			const rect = roots[index].getBoundingClientRect();
			return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, cardY: card.getBoundingClientRect().y };
		}, hintIndex);
	const popover = () =>
		page.evaluate(() => {
			const panel = document.querySelector('.gdcc_hintPanel');
			if (panel === null) return null;
			const rect = panel.getBoundingClientRect();
			return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, text: panel.textContent };
		});
	const hintRow = await row();
	await page.mouse.move(5, 5);
	await page.mouse.move(hintRow.x + hintRow.width / 2, hintRow.y + hintRow.height / 2);
	await page.locator('.gdcc_hintPanel').waitFor();
	const hovered = await popover();
	assert.ok(hovered.text.includes('÷ 1,000,000'), 'the hint shows the price formula: ' + hovered.text);
	assert.ok(hovered.text.includes('× 50%'), 'the formula shows the off-peak factor: ' + hovered.text);
	await page.mouse.move(5, 5);
	await page.locator('.gdcc_hintPanel').waitFor({ state: 'detached' });
	// A popover opens 6px above its hint, so a row low in a card puts the popover
	// over that card. Lift only the hint row: the popover places from the moved
	// row, and the row returns to its place in the card with no layout event, so
	// the cards stay put and the popover keeps the place it got. A real hover
	// cannot survive that drop, because the pointer leaves the hint and the
	// popover closes, so the shot opens the row with a mouseover event instead.
	const lift = hintRow.y - hintRow.cardY + formulaGap - 6;
	await page.evaluate(
		({ index, offset }) => {
			const cards = [...document.querySelectorAll('.gdcc_panel')]
				.filter((panel) => !panel.classList.contains('gdcc_hintPanel'))
				.sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
			const roots = [...cards[cards.length - 1].querySelectorAll('.gdcc_hintRoot')].sort(
				(a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y,
			);
			const root = roots[index];
			root.style.transform = 'translateY(-' + offset + 'px)';
			root.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
		},
		{ index: hintIndex, offset: lift },
	);
	await page.locator('.gdcc_hintPanel').waitFor();
	// The panel places again when its own ResizeObserver reports the first frame.
	// Both placements read the raised row, so this wait is safe.
	await page.waitForTimeout(150);
	await page.evaluate(() => {
		for (const root of document.querySelectorAll('.gdcc_hintRoot')) root.style.transform = '';
	});
	await page.waitForTimeout(300);
	const frame = await page.evaluate(() => {
		const rect = (element) => {
			const box = element.getBoundingClientRect();
			return { x: box.x, y: box.y, width: box.width, height: box.height };
		};
		const panels = [...document.querySelectorAll('.gdcc_panel')];
		const popovers = panels.filter((panel) => panel.classList.contains('gdcc_hintPanel'));
		return {
			cards: panels.filter((panel) => !panel.classList.contains('gdcc_hintPanel')).map(rect),
			popovers: popovers.map(rect),
			text: popovers.length === 0 ? '' : popovers[0].textContent,
			dock: rect(document.querySelector('.gdcc_dockPill')),
			turn: rect(document.querySelector('.gdcc_turnTrigger')),
			note: rect(document.getElementById('note')),
			hero: rect(document.querySelector('.hero')),
		};
	});
	const [sessionCard, turnCard] = frame.cards;
	const formula = frame.popovers[0];
	const overlaps = (a, b) =>
		Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
		Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
	assert.equal(frame.cards.length, 2, 'both cards stay open at once');
	assert.equal(frame.popovers.length, 1, 'the formula popover is in the frame');
	assert.ok(
		frame.text.includes('÷ 1,000,000') && frame.text.includes('× 50%'),
		'the frame shows the price formula: ' + frame.text,
	);
	for (const box of frame.cards) assert.ok(!overlaps(formula, box), 'the popover covers no card: ' + JSON.stringify(box));
	const gap = turnCard.y - (formula.y + formula.height);
	assert.ok(gap >= 8 && gap <= 28, 'the popover sits just above the right card: gap ' + gap);
	assert.ok(
		formula.x < turnCard.x + turnCard.width && formula.x + formula.width > turnCard.x,
		'the popover hangs over the card whose row it explains',
	);
	assert.ok(formula.y - (frame.hero.y + frame.hero.height) >= 12, 'the popover clears the heading');
	const headerGap = sessionCard.y - (frame.hero.y + frame.hero.height);
	assert.ok(headerGap <= 120, 'the cards start near the heading: gap ' + headerGap);
	assert.ok(
		Math.abs(sessionCard.y + sessionCard.height - (turnCard.y + turnCard.height)) < 1,
		'the two cards are bottom-aligned: ' + JSON.stringify(frame.cards),
	);
	for (const [name, box] of [
		['session card', sessionCard],
		['turn card', turnCard],
		['popover', formula],
		['dock chip', frame.dock],
		['turn chip', frame.turn],
		['note', frame.note],
		['hero', frame.hero],
	])
		assert.ok(
			box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height,
			name + ' stays inside the canvas: ' + JSON.stringify(box),
		);
	assert.ok(
		frame.dock.y > sessionCard.y + sessionCard.height && frame.turn.y > turnCard.y + turnCard.height,
		'the chips sit below their cards',
	);
	assert.ok(
		Math.abs(frame.dock.x - sessionCard.x) < 1 && Math.abs(frame.turn.x - turnCard.x) < 1,
		'each chip is the anchor of its card: ' + JSON.stringify({ cards: frame.cards, dock: frame.dock, turn: frame.turn }),
	);
	assert.ok(
		frame.note.y > frame.dock.y + frame.dock.height && frame.note.y > frame.turn.y + frame.turn.height,
		'the note caption sits below the chips',
	);
	assert.ok(Math.abs(frame.dock.y - frame.turn.y) < 1, 'the chips share one row');
	const captionGap = frame.note.y - Math.max(frame.dock.y + frame.dock.height, frame.turn.y + frame.turn.height);
	assert.ok(captionGap >= 12 && captionGap <= 40, 'the note caption sits under the chips: gap ' + captionGap);
	assert.ok(height - (frame.note.y + frame.note.height) >= 24, 'the note keeps a bottom margin');
	assert.deepEqual(errors, []);
	const screenshotDir = process.env.SCREENSHOT_DIR ?? 'docs/images';
	mkdirSync(screenshotDir, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(screenshotDir, process.env.SCREENSHOT_NAME ?? 'overview.png') });
	console.log('cards', JSON.stringify(frame.cards), 'hero', JSON.stringify(frame.hero));
	console.log('popover', JSON.stringify(formula), 'gap', gap, JSON.stringify(frame.text));
	console.log('chips', JSON.stringify({ dock: frame.dock, turn: frame.turn }), 'note', JSON.stringify(frame.note));
	console.log('Overview image created: ' + join(screenshotDir, process.env.SCREENSHOT_NAME ?? 'overview.png'));
} finally {
	await browser.close();
}
