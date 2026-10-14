import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { modelsDev } from '../src/price-sources/models-dev.js';
import { openRouter } from '../src/price-sources/openrouter.js';
import { deepInfra } from '../src/price-sources/deepinfra.js';
import { syncPrices } from '../src/price-sources/sync.js';
import { configInputSchema } from '../src/server/schemas.js';

export async function checkConfigPage(page, url, initial, screenshot) {
	const key = 'com-aliyun/qwen3.8-max',
		ds = 'deepseek-official/deepseek-flash';
	let fixture = {
		...initial,
		historyPending: false,
		calendarPending: [],
		calendars: { 2026: ['2026-10-01'] },
		models: [key, 'com-aliyun/deepseek-v4.1-flash-expires-on-0910', ds],
		config: {
			...initial.config,
			priceSource: 'models.dev',
			pricing: {
				[key]: { currency: 'USD', input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
				'com-aliyun/deepseek-v4.1-flash-expires-on-0910': {
					currency: 'USD',
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				[ds]: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
			},
		},
	};
	let writes = 0,
		syncCalls = 0,
		delayNext = 0,
		failNext = false;
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
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
			const delay = delayNext;
			delayNext = 0;
			if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
			fixture = { ...fixture, config: body.config, revision: String(writes) };
		}
		await route.fulfill({ json: fixture });
	});
	await page.route('**/guojinpeng/dsh-cost-meter/pricing/sync', async (route) => {
		syncCalls++;
		const body = route.request().postDataJSON();
		assert.equal(body.revision, fixture.revision);
		assert.equal(body.source, fixture.config.priceSource);
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
		const adapter = [modelsDev, openRouter, deepInfra].find((entry) => entry.id === body.source);
		const synced = syncPrices(fixture.config, catalogs[body.source], adapter);
		fixture = { ...fixture, config: synced.config, revision: `sync-${syncCalls}` };
		await route.fulfill({ json: { ...fixture, report: synced.report } });
	});
	await page.goto(url);
	for (let step = 0; step < 20; step++) {
		const next = page.getByRole('button', { name: /^(继续|下一步|完成|开始使用|跳过|稍后配置)$/ }).last();
		if (await next.isVisible()) await next.click();
		await page.waitForTimeout(300);
		if (step > 5 && !(await page.locator('[role="dialog"]').count())) break;
	}
	await page.getByRole('button', { name: '插件', exact: true }).click();
	await page.keyboard.press('Escape');
	await page.getByText('@guojinpeng/dsh-cost-meter', { exact: true }).first().click();
	await page.getByText('qwen3.8-max', { exact: true }).waitFor();
	assert.deepEqual(await page.locator('.gdcc_provider').allTextContents(), [
		'com-aliyun',
		'deepseek-official',
	]);
	assert.equal(await page.locator('.gdcc_section').first().getAttribute('open'), '');
	assert.equal(await page.locator('.gdcc_section').last().getAttribute('open'), null);
	assert.equal(await page.getByRole('button', { name: /^(保存|重新加载)$/ }).count(), 0);
	assert.equal(await page.getByTitle('价格归零').count(), 0);
	assert.equal(await page.getByText('显示货币', { exact: true }).count(), 0);
	const source = page.getByRole('combobox', { name: '价格来源', exact: true });
	assert.deepEqual(await source.locator('option').allTextContents(), [
		'models.dev',
		'openrouter.ai',
		'api.deepinfra.com',
	]);
	const input = page.getByRole('spinbutton', { name: `${key} 未缓存输入`, exact: true });
	delayNext = 800;
	const firstSave = page.waitForResponse(
		(response) => response.url().endsWith('/config') && response.request().method() === 'POST',
	);
	await input.fill('3');
	await page.waitForTimeout(500);
	await input.fill('4');
	await firstSave;
	assert.equal(await input.inputValue(), '4', 'late save must preserve the new draft');
	await page.getByText('已保存', { exact: true }).waitFor();
	await page.waitForTimeout(700);
	assert.equal(fixture.config.pricing[key].input, 4);
	assert.equal(fixture.config.pricing[key].source, 'manual');
	await page.getByRole('combobox', { name: `${key} 币种`, exact: true }).selectOption('CNY');
	await page.waitForTimeout(500);
	assert.equal(fixture.config.pricing[key].currency, 'CNY');
	assert.equal(fixture.config.pricing[key].input, 4 * fixture.config.cnyPerUsd);
	assert.equal(await page.getByRole('spinbutton', { name: `${key} 缓存写入`, exact: true }).count(), 0);
	await page.getByRole('button', { name: `${key} 高级配置`, exact: true }).click();
	assert.equal(
		await page.getByRole('spinbutton', { name: `${key} 缓存写入`, exact: true }).inputValue(),
		String(2.5 * fixture.config.cnyPerUsd),
	);
	await page.getByRole('button', { name: `${ds} 高级配置`, exact: true }).click();
	assert.equal(
		await page.getByRole('switch', { name: `${ds} 自动计算峰谷`, exact: true }).isChecked(),
		false,
	);
	assert.equal(await page.getByRole('switch', { name: `${key} 自动计算峰谷`, exact: true }).count(), 0);
	page.once('dialog', (dialog) => dialog.dismiss());
	await page.getByRole('button', { name: '同步价格', exact: true }).click();
	assert.equal(syncCalls, 0);
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: '同步价格', exact: true }).click();
	await page.getByText(/已更新:/).waitFor();
	assert.equal(syncCalls, 1);
	assert.equal(fixture.config.pricing[ds].input, 0.3);
	assert.equal(fixture.config.pricing[ds].autoOffPeak, true);
	assert.equal(fixture.config.pricing[key].input, 2 * fixture.config.cnyPerUsd);
	assert.equal(fixture.config.pricing[key].source, 'models.dev');
	await input.fill('');
	await page.waitForTimeout(500);
	assert.equal(
		fixture.config.pricing[key].input,
		2 * fixture.config.cnyPerUsd,
		'empty input never saves zero',
	);
	assert.equal(await page.getByRole('button', { name: '同步价格', exact: true }).isDisabled(), true);
	failNext = true;
	await input.fill('5');
	await page.getByText('Test save failure', { exact: true }).waitFor();
	assert.equal(await input.inputValue(), '5');
	await page.getByRole('button', { name: '重试保存', exact: true }).click();
	await page.getByText('已保存', { exact: true }).waitFor();
	assert.equal(fixture.config.pricing[key].input, 5);
	await page.locator('.gdcc_section').last().locator('summary').click();
	await page.getByRole('switch', { name: '显示轮次费用胶囊', exact: true }).click();
	await page.waitForTimeout(400);
	assert.equal(fixture.config.showTurnChip, false);
	await page.getByRole('spinbutton', { name: '汇率(1 USD = ? CNY)', exact: true }).fill('7');
	await page.waitForTimeout(700);
	assert.equal(fixture.config.cnyPerUsd, 7);
	assert.equal(fixture.config.pricing[key].input, 5, 'exchange changes do not rewrite saved prices');
	for (const [id, expected] of [
		['openrouter.ai', 21],
		['api.deepinfra.com', 2.8],
	]) {
		const selection = page.waitForResponse(
			(response) => response.url().endsWith('/config') && response.request().method() === 'POST',
		);
		await source.selectOption(id);
		await selection;
		assert.equal(fixture.config.priceSource, id);
		assert.equal(
			fixture.config.pricing[key].input,
			id === 'openrouter.ai' ? 5 : 21,
			'source selection alone keeps model prices',
		);
		page.once('dialog', async (dialog) => {
			assert.ok(dialog.message().includes(id));
			await dialog.accept();
		});
		const synced = page.waitForResponse((response) => response.url().endsWith('/pricing/sync'));
		await page.getByRole('button', { name: '同步价格', exact: true }).click();
		await synced;
		await page.getByText(/已更新:/).waitFor();
		assert.equal(fixture.config.pricing[key].input, expected);
		assert.equal(fixture.config.pricing[key].source, id);
		assert.equal(fixture.config.pricing[ds].input, 0.3);
		await page
			.locator('.gdcc_syncReport')
			.getByText(/无法确认官方高峰基准价/)
			.waitFor();
	}
	await page.getByRole('combobox', { name: `${key} 币种`, exact: true }).selectOption('USD');
	await page.getByText('已保存', { exact: true }).waitFor();
	assert.equal(
		fixture.config.pricing[key].source,
		'api.deepinfra.com',
		'currency conversion keeps the import source',
	);
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
	const unloadSave = page.waitForResponse(
		(response) => response.url().endsWith('/config') && response.request().method() === 'POST',
	);
	await input.fill('6');
	await page.getByText('插件列表', { exact: true }).evaluate((link) => link.click());
	await page.locator('.gdcc_form').waitFor({ state: 'detached' });
	await unloadSave;
	assert.equal(fixture.config.pricing[key].input, 6, 'leaving the page flushes the pending input');
	assert.equal(fixture.config.pricing[key].source, 'manual');
	assert.deepEqual(errors, []);
	console.log(
		'Desktop configuration: serial autosave, currency conversion, sync confirmation, peak toggle, invalid inputs and retry passed.',
	);
}
