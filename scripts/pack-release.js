import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const result = spawnSync('npm pack', { cwd: root, shell: true, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const basename = name.replace(/^@/, '').replace('/', '-');
copyFileSync(`${root}${basename}-${version}.tgz`, `${root}${basename}.tgz`);
console.log(`GitHub Release asset: ${basename}.tgz`);
