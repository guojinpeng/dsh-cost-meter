import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createConfigStore } from '../src/client/config-store.js';

const home = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-smoke-'));
const legacyConfig = {
	formatVersion: 2,
	currency: 'USD',
	cnyPerUsd: 7.8,
	showDockChip: true,
	showTurnChip: true,
	pricing: {},
};
mkdirSync(join(home, 'dsh-cost-meter'), { recursive: true });
writeFileSync(join(home, 'dsh-cost-meter', 'config.json'), JSON.stringify(legacyConfig));
const runtime =
	process.env.DSH_RUNTIME_ROOT ??
	join(
		execFileSync('npm.cmd', ['root', '-g'], { encoding: 'utf8', shell: true }).trim(),
		'@deepseek-ai',
		'dsh',
	);
const bin = join(runtime, 'lib', 'bin.js');
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED' };
const profile = 'cost-meter-smoke';
const cli = (args) =>
	execFileSync(process.execPath, [bin, ...args], { env, encoding: 'utf8', stdio: 'pipe' });
cli(['--profile', profile, '--from-default-profile', 'web', '--dump-config']);
const { name: packageName, version } = JSON.parse(readFileSync('package.json', 'utf8'));
const tarball = `${packageName.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
cli(['plugin', '--profile', profile, 'add', '-w', resolve(tarball)]);
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
	assert.equal((await fetch(origin + '/guojinpeng/dsh-cost-meter/config')).status, 401);
	const auth = await fetch(url, { redirect: 'manual' });
	const cookie = auth.headers.get('set-cookie').split(';')[0];
	const headers = { cookie, 'content-type': 'application/json', origin };
	const get = await fetch(origin + '/guojinpeng/dsh-cost-meter/config', { headers });
	assert.equal(get.status, 200);
	const payload = await get.json();
	assert.equal(payload.config.cnyPerUsd, 7.8, 'legacy config is copied to the namespaced directory');
	assert.equal(payload.config.currency, 'USD');
	assert.deepEqual(payload.models, []);
	const save = await fetch(origin + '/guojinpeng/dsh-cost-meter/config', {
		method: 'POST',
		headers,
		body: JSON.stringify({
			revision: payload.revision,
			config: { ...payload.config, cnyPerUsd: 7.3, formatVersion: undefined },
		}),
	});
	assert.equal(save.status, 200);
	assert.deepEqual(
		JSON.parse(readFileSync(join(home, 'dsh-cost-meter', 'config.json'), 'utf8')),
		legacyConfig,
		'legacy config remains unchanged',
	);
	const page = await (await fetch(origin, { headers })).text();
	const boot = JSON.parse(page.match(/globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/)[1]);
	let entry;
	const visit = (value) => {
		if (!value || typeof value !== 'object') return;
		if (value.id === '@guojinpeng/dsh-cost-meter' && value.url) entry = value;
		for (const item of Object.values(value)) visit(item);
	};
	visit(boot);
	assert.ok(entry, 'plugin client in boot graph');
	const client = await fetch(new URL(entry.url, origin), { headers });
	assert.equal(client.status, 200);
	const js = await client.text();
	assert.match(js, /__ModuleLoader__/);
	assert.doesNotMatch(js, /from\s*["']\.\//, 'client bundle must not depend on inaccessible sibling assets');
	assert.equal(
		existsSync(join(home, 'guojinpeng', 'dsh-cost-meter', 'data', 'models.dev.json')),
		false,
		'first startup does not fetch model prices',
	);
	await save.json();
	const liveStore = createConfigStore((path, options = {}) =>
		fetch(origin + path, { ...options, headers: { ...headers, ...options.headers } }),
	);
	await liveStore.load();
	await liveStore.update({ cnyPerUsd: 7.4 });
	assert.equal(
		JSON.parse(readFileSync(join(home, 'guojinpeng', 'dsh-cost-meter', 'config.json'), 'utf8')).cnyPerUsd,
		7.4,
		'queued edits work through the real authenticated API',
	);
	let current = liveStore.getSnapshot();
	for (const source of ['models.dev', 'openrouter.ai', 'api.deepinfra.com']) {
		if (source !== 'models.dev') await liveStore.update({ priceSource: source });
		current = liveStore.getSnapshot();
		const sync = await fetch(origin + '/guojinpeng/dsh-cost-meter/pricing/sync', {
			method: 'POST',
			headers,
			body: JSON.stringify({ source, revision: current.revision }),
		});
		assert.equal(sync.status, 200);
		assert.deepEqual((await sync.json()).config.pricing, {});
		assert.ok(
			existsSync(join(home, 'guojinpeng', 'dsh-cost-meter', 'data', `${source}.json`)),
			'manual sync caches model prices',
		);
		await liveStore.load();
	}
	current = liveStore.getSnapshot();
	if (process.env.PLAYWRIGHT_MODULE) {
		const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
		const browser = await chromium.launch({
			executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
			headless: true,
		});
		try {
			const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
			const { checkConfigPage } = await import('./browser-config-check.mjs');
			await checkConfigPage(page, url, current, join(home, 'desktop.png'));
		} finally {
			await browser.close();
		}
	}
	console.log(
		'Isolated DSH install/startup, auth, config save, client assets and all three price sources passed.',
	);
	console.log('Isolated test home: ' + home);
} finally {
	if (child.exitCode === null)
		execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
}
