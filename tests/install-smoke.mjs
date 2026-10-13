import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const home = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-012-'));
const runtime =
	process.env.DSH_RUNTIME_ROOT ??
	join(execFileSync('npm.cmd', ['root', '-g'], { encoding: 'utf8', shell: true }).trim(), '@deepseek-ai', 'dsh');
const bin = join(runtime, 'lib', 'bin.js');
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED' };
const profile = 'cost-meter-smoke';
const cli = (args) => execFileSync(process.execPath, [bin, ...args], { env, encoding: 'utf8', stdio: 'pipe' });
cli(['--profile', profile, '--from-default-profile', 'web', '--dump-config']);
cli(['plugin', '--profile', profile, 'add', '-w', resolve('dsh-cost-meter-0.1.2.tgz')]);
const child = spawn(process.execPath, [bin, '--profile', profile, '--no-open', '--port', '0'], {
	env,
	stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => {
	output += chunk;
});
child.stderr.on('data', (chunk) => {
	output += chunk;
});
try {
	const started = Date.now();
	let url;
	while (!url && Date.now() - started < 45000) {
		if (child.exitCode !== null)
			throw new Error('DSH exited before startup: ' + output.replace(/http:\/\/\S+/g, '[URL]'));
		url = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?[^\s]+/)?.[0];
		if (!url) await new Promise((resolve) => setTimeout(resolve, 200));
	}
	assert.ok(url, 'DSH authenticated startup URL');
	const origin = new URL(url).origin;
	assert.equal((await fetch(origin + '/dsh-cost-meter/config')).status, 401);
	const auth = await fetch(url, { redirect: 'manual' });
	const cookie = auth.headers.get('set-cookie').split(';')[0];
	const headers = { cookie, 'content-type': 'application/json', origin };
	const get = await fetch(origin + '/dsh-cost-meter/config', { headers });
	assert.equal(get.status, 200);
	const payload = await get.json();
	assert.deepEqual(payload.models, []);
	const save = await fetch(origin + '/dsh-cost-meter/config', {
		method: 'POST',
		headers,
		body: JSON.stringify({
			revision: payload.revision,
			config: { ...payload.config, cnyPerUsd: 7.3, formatVersion: undefined },
		}),
	});
	assert.equal(save.status, 200);
	const page = await (await fetch(origin, { headers })).text();
	const boot = JSON.parse(page.match(/globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/)[1]);
	let entry;
	const visit = (value) => {
		if (!value || typeof value !== 'object') return;
		if (value.id === 'dsh-cost-meter' && value.url) entry = value;
		for (const item of Object.values(value)) visit(item);
	};
	visit(boot);
	assert.ok(entry, 'plugin client in boot graph');
	const client = await fetch(new URL(entry.url, origin), { headers });
	assert.equal(client.status, 200);
	const js = await client.text();
	assert.match(js, /__ModuleLoader__/);
	assert.doesNotMatch(js, /from\s*["']\.\//, 'client bundle must not depend on inaccessible sibling assets');
	assert.ok(existsSync(join(home, 'dsh-cost-meter', 'data', 'models.dev.json')), 'first startup caches the catalog');
	const current = await save.json();
	const sync = await fetch(origin + '/dsh-cost-meter/pricing/sync', {
		method: 'POST',
		headers,
		body: JSON.stringify({ source: 'models.dev', revision: current.revision }),
	});
	assert.equal(sync.status, 200);
	assert.deepEqual((await sync.json()).config.pricing, {});
	if (process.env.PLAYWRIGHT_MODULE) {
		const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
		const browser = await chromium.launch({
			executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
			headless: true,
		});
		try {
			const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
			const errors = [];
			page.on('pageerror', (e) => errors.push(e.message));
			await page.goto(url);
			await page.waitForTimeout(2000);
			for (let step = 0; step < 20; step++) {
				const next = page.getByRole('button', { name: /^(继续|下一步|完成|开始使用|跳过|稍后配置)$/ }).last();
				if (await next.isVisible()) await next.click();
				await page.waitForTimeout(500);
				if (step > 5 && !(await page.locator('[role="dialog"]').count())) break;
			}
			await page.getByRole('button', { name: '插件', exact: true }).click();
			await page.keyboard.press('Escape');
			await page.waitForTimeout(300);
			await page.getByText('dsh-cost-meter', { exact: true }).first().click();
			await page.waitForTimeout(1000);
			await page.getByText('暂无模型调用历史', { exact: true }).waitFor();
			let fixture = {
				...current,
				models: ['A/qwen3.8-max', 'B/a-very-long-model-name-for-responsive-layout-check-20261013'],
				config: {
					...current.config,
					pricing: {
						'A/qwen3.8-max': { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
						'B/a-very-long-model-name-for-responsive-layout-check-20261013': {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
						},
					},
				},
			};
			let syncCalls = 0;
			await page.route('**/dsh-cost-meter/config', async (route) => {
				if (route.request().method() === 'POST')
					fixture = { ...fixture, config: route.request().postDataJSON().config, revision: 'fixture-saved' };
				await route.fulfill({ json: fixture });
			});
			await page.route('**/dsh-cost-meter/pricing/sync', async (route) => {
				syncCalls++;
				await route.fulfill({
					json: { ...fixture, report: { updated: fixture.models, unmatched: [], unsupported: [], ambiguous: [] } },
				});
			});
			await page.getByRole('button', { name: '重新加载', exact: true }).click();
			await page.getByText('qwen3.8-max', { exact: true }).waitFor();
			assert.deepEqual(await page.locator('.dcc_provider').allTextContents(), ['A', 'B']);
			assert.equal(await page.locator('.dcc_model').first().getAttribute('title'), 'A/qwen3.8-max');
			assert.equal(await page.locator('.dcc_model small').count(), 0);
			assert.ok(await page.getByText('模型单价 (USD / 1M tokens)', { exact: true }).isVisible());
			page.once('dialog', (dialog) => dialog.dismiss());
			await page.getByRole('button', { name: '同步价格', exact: true }).click();
			assert.equal(syncCalls, 0);
			await page.getByTitle('价格归零').first().click();
			assert.ok(await page.getByRole('button', { name: '同步价格', exact: true }).isDisabled());
			await page.getByRole('button', { name: '保存', exact: true }).click();
			await page.getByText('已保存', { exact: true }).waitFor();
			assert.equal(fixture.config.pricing['A/qwen3.8-max'].input, 0);
			page.once('dialog', (dialog) => dialog.accept());
			await page.getByRole('button', { name: '同步价格', exact: true }).click();
			await page.getByText(/已更新/).waitFor();
			assert.equal(syncCalls, 1);
			await page.screenshot({ path: join(home, 'desktop.png'), fullPage: true });
			await page.setViewportSize({ width: 390, height: 844 });
			await page.waitForTimeout(300);
			assert.ok(await page.getByRole('button', { name: '保存', exact: true }).isVisible());
			const widths = await page.evaluate(() => ({
				width: document.documentElement.clientWidth,
				scroll: document.documentElement.scrollWidth,
			}));
			assert.ok(widths.scroll <= widths.width + 1, 'mobile page must not overflow horizontally');
			await page.screenshot({ path: join(home, 'mobile.png'), fullPage: true });
			console.log('Browser errors: ' + JSON.stringify(errors));
			assert.deepEqual(errors, []);
		} finally {
			await browser.close();
		}
	}
	console.log('Isolated DSH install/startup, auth, config save, client assets and models.dev sync passed.');
	console.log('Isolated test home: ' + home);
} finally {
	if (child.exitCode === null) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
}
