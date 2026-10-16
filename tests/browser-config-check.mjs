import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { modelsDev } from '../src/price-sources/models-dev.js';
import { openRouter } from '../src/price-sources/openrouter.js';
import { deepInfra } from '../src/price-sources/deepinfra.js';
import { syncPrices } from '../src/price-sources/sync.js';
import { resolvedPriceSource } from '../src/price-sources.js';
import { configInputSchema } from '../src/server/schemas.js';

const catalogs = {
	'models.dev': {
		alibaba: {
			models: { 'qwen3.8-max': { cost: { input: 2, output: 6, cache_read: 0.25, cache_write: 2.5 } } },
		},
		deepseek: { models: { 'deepseek-flash': { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } } } },
	},
	'openrouter.ai': {
		data: [
			{
				id: 'qwen/qwen3.8-max',
				pricing: { prompt: '0.000003', completion: '0.000006', input_cache_read: '0.0000001' },
			},
			{ id: 'deepseek/deepseek-flash', pricing: { prompt: '0.000001', completion: '0.000002' } },
		],
	},
	'api.deepinfra.com': [
		{
			model_name: 'Qwen/qwen3.8-max',
			type: 'text-generation',
			pricing: {
				type: 'tokens',
				cents_per_input_token: 0.00004,
				cents_per_output_token: 0.00006,
				rate_per_input_token_cached: 0.25,
			},
		},
		{
			model_name: 'deepseek-ai/DeepSeek-Flash',
			type: 'text-generation',
			pricing: { type: 'tokens', cents_per_input_token: 0.00002, cents_per_output_token: 0.00006 },
		},
	],
};

/**
 * Drive the staged configuration card in a real DSH page: host primitives,
 * explicit save, price preview, inline model list and discard on leave.
 */
export async function checkConfigPage(page, url, initial, screenshot) {
	const key = 'com-aliyun/qwen3.8-max',
		expiring = 'com-aliyun/deepseek-v4.1-flash-expires-on-0910',
		ds = 'deepseek-official/deepseek-flash',
		added = 'zhipu/glm-4.6';
	const discovered = [key, expiring, ds];
	let fixture = {
		...initial,
		historyPending: false,
		calendarPending: [],
		calendars: { 2026: ['2026-10-01'] },
		models: [...discovered],
		discovered: [...discovered],
		config: {
			...initial.config,
			priceSource: 'models.dev',
			pricing: {
				[key]: { currency: 'USD', input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
				[expiring]: { currency: 'USD', input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				[ds]: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0, autoOffPeak: false },
			},
		},
	};
	let writes = 0,
		syncCalls = 0,
		failNext = false;
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('dialog', async (dialog) => {
		errors.push('unexpected dialog: ' + dialog.message());
		await dialog.dismiss();
	});
	await page.route('**/guojinpeng/dsh-cost-meter/config', async (route) => {
		if (route.request().method() === 'POST') {
			writes++;
			if (failNext) {
				failNext = false;
				await route.fulfill({ status: 503, json: { error: 'Test save failure' } });
				return;
			}
			const body = route.request().postDataJSON();
			configInputSchema.parse(body.config);
			assert.equal(body.revision, fixture.revision, 'saves use the current revision');
			fixture = {
				...fixture,
				config: body.config,
				models: [...new Set([...discovered, ...Object.keys(body.config.pricing)])].sort(),
				revision: String(writes),
			};
		}
		await route.fulfill({ json: fixture });
	});
	await page.route('**/guojinpeng/dsh-cost-meter/pricing/sync', async (route) => {
		syncCalls++;
		const body = route.request().postDataJSON();
		assert.equal(body.revision, fixture.revision, 'a preview carries the loaded revision');
		const base = configInputSchema.parse(body.config);
		assert.ok(base, 'a preview syncs the staged configuration, not the stored one');
		assert.equal(body.source, resolvedPriceSource(base));
		const adapter = [modelsDev, openRouter, deepInfra].find((entry) => entry.id === body.source);
		const synced = syncPrices(base, catalogs[body.source], adapter);
		// Preview only: the stored fixture changes when the card saves.
		await route.fulfill({ json: { ...fixture, report: synced.report, preview: synced.config } });
	});

	await page.goto(url);
	for (let step = 0; step < 20; step++) {
		const next = page.getByRole('button', { name: /^(继续|下一步|完成|开始使用|跳过|稍后配置)$/ }).last();
		if (await next.isVisible()) await next.click();
		await page.waitForTimeout(300);
		if (step > 5 && !(await page.locator('[role="dialog"]').count())) break;
	}
	const openCard = async () => {
		await page.getByRole('button', { name: '插件', exact: true }).click();
		await page.keyboard.press('Escape');
		await page.locator('[data-plugin-package="@guojinpeng/dsh-cost-meter"]').click();
		await page.locator('.gdcc_configCard').waitFor();
		await page.getByText('qwen3.8-max', { exact: true }).waitFor();
	};
	await openCard();

	// --- layout: flat sections built from the host primitives ---
	const layout = await page.evaluate(() => {
		const card = document.querySelector('.gdcc_configCard');
		const size = (node) => {
			const box = node.getBoundingClientRect();
			return [Math.round(box.width), Math.round(box.height)];
		};
		return {
			width: Math.round(card.getBoundingClientRect().width),
			sections: card.querySelectorAll('.gdcc_section').length,
			collapsed: card.querySelectorAll('details, summary').length,
			headings: [...card.querySelectorAll('h3')].map((node) => node.innerText),
			switch: size(card.querySelector('[role=switch]')),
			fieldRadius: getComputedStyle(card.querySelector('#gdcc-cny-per-usd')).borderRadius,
			cellAlign: getComputedStyle(card.querySelector('.gdcc_cell')).textAlign,
		};
	});
	assert.deepEqual(layout.headings, ['模型单价', '通用'], 'both sections are open on arrival');
	assert.equal(layout.sections, 2);
	assert.equal(layout.collapsed, 0, 'no collapsed section hides the prices');
	assert.deepEqual(layout.switch, [36, 20], 'the host Switch primitive is used');
	assert.equal(layout.fieldRadius, '12px', 'the host settings field metrics are used');
	assert.equal(layout.cellAlign, 'right', 'prices are right aligned');
	assert.ok(layout.width <= 760, 'the card keeps the host settings width: ' + layout.width);
	assert.equal(await page.getByRole('button', { name: '保存', exact: true }).count(), 1);
	assert.equal(await page.getByRole('button', { name: '重新加载', exact: true }).count(), 0);
	assert.deepEqual(await page.locator('.gdcc_provider').allTextContents(), ['com-aliyun', 'deepseek-official']);
	assert.ok(
		(await page.getByRole('button', { name: '同步价格', exact: true }).boundingBox()).y <
			(await page.locator('.gdcc_modelItem').first().boundingBox()).y,
		'the sync controls sit above the rates table',
	);
	const source = page.getByRole('combobox', { name: '价格来源', exact: true });
	assert.deepEqual(await source.locator('option').allTextContents(), [
		'models.dev',
		'openrouter.ai',
		'api.deepinfra.com',
	]);

	const saveButton = page.getByRole('button', { name: '保存', exact: true });
	const syncButton = page.getByRole('button', { name: '同步价格', exact: true });
	const price = (route, label) => page.getByRole('textbox', { name: `${route} ${label}`, exact: true });
	const clean = () =>
		page.waitForFunction(
			() => {
				const node = [...document.querySelectorAll('.gdcc_configCard button')].find(
					(button) => button.innerText.trim() === '保存',
				);
				return node?.disabled === true;
			},
			null,
			{ timeout: 8000 },
		);
	const save = async () => {
		const written = page.waitForResponse(
			(response) => response.url().endsWith('/config') && response.request().method() === 'POST',
		);
		await saveButton.click();
		await written;
		await clean();
	};
	const sync = async (id) => {
		const previewed = page.waitForResponse((response) => response.url().endsWith('/pricing/sync'));
		await syncButton.click();
		await previewed;
		await page.getByText(new RegExp(`已按 ${id.replace(/\./g, '\\.')} 生成预览`)).waitFor();
	};

	// --- the exchange rate: invalid blocks the save, valid stages it ---
	const rate = page.getByRole('textbox', { name: '汇率(1 USD = ? CNY)', exact: true });
	await rate.fill('0');
	await page.getByText('汇率必须是大于零的数字。', { exact: true }).waitFor();
	assert.equal(await rate.getAttribute('aria-invalid'), 'true');
	assert.equal(await saveButton.isDisabled(), true);
	assert.equal(await syncButton.isDisabled(), true);
	assert.equal(writes, 0, 'an invalid value is never written');
	await rate.fill('7');
	assert.equal(await page.getByText('汇率必须是大于零的数字。').count(), 0);
	await save();
	assert.equal(fixture.config.cnyPerUsd, 7);
	assert.equal(writes, 1, 'only the save button writes');

	// --- editing a price stages it and marks it manual ---
	const input = price(key, '未缓存输入');
	await input.fill('4');
	await page.waitForTimeout(600);
	assert.equal(writes, 1, 'typing no longer autosaves');
	assert.equal(await saveButton.isDisabled(), false);
	await save();
	assert.equal(fixture.config.pricing[key].input, 4);
	assert.equal(fixture.config.pricing[key].source, 'manual');
	await page.getByRole('button', { name: `${key} 更多单价`, exact: true }).click();
	await page.getByText('已手动设置', { exact: true }).waitFor();
	assert.equal(Number(await price(key, '缓存写入').inputValue()), 2.5);

	// --- an empty price is invalid in place ---
	const written = writes;
	await input.fill('');
	await page.locator('#gdcc-price-error').waitFor();
	assert.equal(await page.locator('#gdcc-price-error').innerText(), '请输入非负数字。');
	assert.equal(await input.getAttribute('aria-invalid'), 'true');
	assert.equal(await input.getAttribute('aria-describedby'), 'gdcc-price-error');
	assert.ok(
		(await input.evaluate((node) => getComputedStyle(node).borderTopColor)).includes('236, 19, 19'),
		'the invalid cell uses the host error color',
	);
	assert.equal(await saveButton.isDisabled(), true);
	assert.equal(await syncButton.isDisabled(), true);
	assert.equal(writes, written, 'an invalid price is never written');
	await input.fill('5');
	assert.equal(await page.locator('#gdcc-price-error').count(), 0);

	// --- a failed save keeps the draft and can be repeated ---
	failNext = true;
	await saveButton.click();
	await page.getByText('保存失败:Test save failure', { exact: true }).waitFor();
	assert.equal(await input.inputValue(), '5', 'a failed save keeps the draft');
	assert.equal(await saveButton.isDisabled(), false);
	await save();
	assert.equal(fixture.config.pricing[key].input, 5);
	assert.equal(await page.getByText('保存失败:Test save failure').count(), 0);

	// --- a currency conversion restages every rate and keeps the origin ---
	await page.getByRole('combobox', { name: `${key} 币种`, exact: true }).selectOption('CNY');
	await page.waitForTimeout(300);
	assert.equal(Number(await input.inputValue()), 35, 'the staged rate follows the exchange rate');
	assert.equal(Number(await price(key, '缓存写入').inputValue()), 17.5);
	await save();
	assert.equal(fixture.config.pricing[key].currency, 'CNY');
	assert.equal(fixture.config.pricing[key].input, 35);
	assert.equal(fixture.config.pricing[key].source, 'manual', 'a unit conversion keeps the recorded origin');

	// --- peak rule and its explanation ---
	const peak = page.getByRole('switch', { name: `${ds} 自动计算谷价`, exact: true });
	await page.getByRole('button', { name: `${ds} 更多单价`, exact: true }).click();
	assert.equal(await peak.isChecked(), false);
	await peak.check();
	const rule = page.getByRole('combobox', { name: `${ds} 峰谷计费规则`, exact: true });
	assert.deepEqual(await rule.locator('option').allTextContents(), [
		'DeepSeek 峰谷规则',
		'阿里云峰谷规则',
		'智谱 GLM 峰谷规则',
	]);
	assert.equal(await rule.inputValue(), 'deepseek');
	await rule.selectOption('aliyun');
	await save();
	assert.equal(fixture.config.pricing[ds].peakRule, 'aliyun');
	await page.getByRole('button', { name: `${ds} 峰谷时段说明`, exact: true }).click();
	await page.waitForTimeout(300);
	const hint = await page.getByRole('dialog').innerText();
	assert.ok(hint.includes('阿里云峰谷规则') && hint.includes('22:00'), hint);
	await page.keyboard.press('Escape');
	assert.equal(await page.getByRole('dialog').count(), 0);
	await peak.uncheck();
	assert.equal(await rule.count(), 0, 'the rule follows the switch');
	await save();
	assert.ok(!fixture.config.pricing[ds].autoOffPeak);
	await peak.check();
	await rule.selectOption('aliyun');
	await save();
	assert.equal(fixture.config.pricing[ds].autoOffPeak, true);
	assert.equal(fixture.config.pricing[ds].peakRule, 'aliyun');
	await rule.selectOption('deepseek');
	await save();
	assert.equal(fixture.config.pricing[ds].peakRule, 'deepseek');

	// --- the display switches ---
	await page.getByRole('switch', { name: '显示轮次费用胶囊', exact: true }).click();
	await save();
	assert.equal(fixture.config.showTurnChip, false);

	// --- an empty history is not a dead end: declare a model inline ---
	const modelInput = page.getByRole('textbox', { name: '添加模型', exact: true });
	await modelInput.fill('nonsense');
	await modelInput.press('Enter');
	await page.getByText('请输入不重复的 provider/model 模型 ID。', { exact: true }).waitFor();
	assert.equal(await page.locator('.gdcc_modelItem').count(), 3);
	await modelInput.fill(key);
	await modelInput.press('Enter');
	assert.equal(await page.locator('.gdcc_modelItem').count(), 3, 'a known model is not added twice');
	await modelInput.fill(added);
	await modelInput.press('Enter');
	assert.equal(await page.getByText('请输入不重复的 provider/model 模型 ID。').count(), 0);
	assert.equal(await modelInput.inputValue(), '', 'the field clears after a successful add');
	await page.getByText('glm-4.6', { exact: true }).waitFor();
	await page.getByRole('button', { name: `${added} 更多单价`, exact: true }).click();
	assert.equal(await page.locator('.gdcc_remove').count(), 1, 'only a declared model can be removed');
	await save();
	assert.deepEqual(fixture.config.pricing[added], {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		currency: 'USD',
	});
	assert.ok(fixture.models.includes(added), 'a declared model stays in the list');
	await page.locator('.gdcc_remove').click();
	await save();
	assert.equal(fixture.config.pricing[added], undefined);
	assert.equal(fixture.models.includes(added), false);

	// --- sync stages a preview; the save applies it ---
	await sync('models.dev');
	assert.equal(syncCalls, 1);
	assert.ok(
		(await page.locator('.gdcc_syncReport').boundingBox()).y <
			(await page.locator('.gdcc_modelItem').first().boundingBox()).y,
		'the sync report sits above the rates table',
	);
	assert.equal(Number(await input.inputValue()), 14, 'the preview converts to the row currency');
	assert.equal(Number(await price(ds, '未缓存输入').inputValue()), 0.3);
	assert.equal(fixture.config.pricing[key].input, 35, 'a preview writes nothing');
	await save();
	assert.equal(fixture.config.pricing[key].input, 14);
	assert.equal(fixture.config.pricing[key].source, 'models.dev');
	assert.equal(await page.getByText('已手动设置', { exact: true }).count(), 0);

	// The peak rule stays on for the DeepSeek row: an uncertain peak basis must survive a sync.
	const dsPeak = page.getByRole('switch', { name: `${ds} 自动计算谷价` });
	if ((await dsPeak.count()) === 0) await page.getByRole('button', { name: `${ds} 更多单价` }).click();
	if ((await dsPeak.getAttribute('aria-checked')) !== 'true') {
		await dsPeak.click();
		await save();
	}
	assert.equal(fixture.config.pricing[ds].autoOffPeak, true);

	let staged = Number(await input.inputValue());
	for (const [id, expected] of [
		['openrouter.ai', 21],
		['api.deepinfra.com', 2.8],
	]) {
		await source.selectOption(id);
		await save();
		assert.equal(fixture.config.priceSource, id);
		assert.equal(fixture.config.pricing[key].input, staged, 'the source alone rewrites no price');
		await sync(id);
		assert.equal(Number(await input.inputValue()), expected);
		await page.locator('.gdcc_syncReport').getByText(/无法确认官方高峰基准价/).waitFor();
		await save();
		assert.equal(fixture.config.pricing[key].input, expected);
		assert.equal(fixture.config.pricing[key].source, id);
		assert.equal(fixture.config.pricing[ds].input, 0.3, 'an uncertain peak basis preserves the price');
		staged = expected;
	}

	if (screenshot) {
		await page.screenshot({ path: screenshot, fullPage: true });
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'));
		await page.screenshot({ path: join(dirname(screenshot), 'desktop-dark.png'), fullPage: true });
		await page.setViewportSize({ width: 1024, height: 900 });
		await page.screenshot({ path: join(dirname(screenshot), 'desktop-1024.png'), fullPage: true });
		assert.ok(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
			'table overflow stays inside the settings page',
		);
	}

	// --- leaving the page discards the staged draft ---
	const before = writes;
	await input.fill('6');
	assert.equal(await saveButton.isDisabled(), false);
	await page.getByText('插件列表', { exact: true }).evaluate((link) => link.click());
	await page.locator('.gdcc_configCard').waitFor({ state: 'detached' });
	await page.waitForTimeout(500);
	assert.equal(writes, before, 'leaving the page writes nothing');
	await openCard();
	assert.equal(Number(await input.inputValue()), fixture.config.pricing[key].input, 'the card reopens clean');
	assert.equal(await saveButton.isDisabled(), true);
	assert.deepEqual(errors, []);
	console.log(
		'Desktop configuration: host primitives, staged edits with explicit save, price previews, inline model list, invalid input and discard on leave passed.',
	);
}
