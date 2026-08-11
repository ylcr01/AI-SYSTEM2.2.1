import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileIndex = process.argv.indexOf('--profile');
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : 'baseline';
const profiles = new Set(['tests', 'baseline', 'release']);
if (!profiles.has(profile)) throw new Error(`验证档位无效: ${profile ?? ''}`);
const groupIndex = process.argv.indexOf('--group');
const requestedGroup = groupIndex >= 0 ? process.argv[groupIndex + 1] : null;
const availableGroups = ['core', 'integration', 'scenarios'];
if (requestedGroup && !availableGroups.includes(requestedGroup)) throw new Error(`测试分组无效: ${requestedGroup}`);

function testFiles(group) {
  const directory = path.join(ROOT, '60-测试', group);
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => path.join(directory, name));
}

function run(name, args, timeout = 600000) {
  console.log(`\n[verify] ${name}`);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
    timeout
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${name} 失败${result.error ? `: ${result.error.message}` : `，退出码 ${result.status}`}`);
  }
}

if (profile !== 'tests') run('系统自检', ['./40-脚本/check-system.mjs']);
for (const group of requestedGroup ? [requestedGroup] : availableGroups) {
  run(`${group} 测试`, ['--test', ...testFiles(group)]);
}
if (profile === 'release' && !requestedGroup) {
  run('发布清单', ['./40-脚本/build-release-inventory.mjs']);
  run('实现契约', ['./40-脚本/verify-implementation.mjs']);
}

console.log(JSON.stringify({ ok: true, profile, group: requestedGroup }, null, 2));
