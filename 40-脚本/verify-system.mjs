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
const fullOutput = process.argv.includes('--full');

function testFiles(group) {
  const directory = path.join(ROOT, '60-测试', group);
  return fs.readdirSync(directory)
    .filter(name => name.endsWith('.test.mjs'))
    .sort()
    .map(name => path.join(directory, name));
}

function testCount(output) {
  const matches = [...String(output ?? '').matchAll(/(?:^|\n)(?:ℹ|#)\s*tests\s+(\d+)/gu)];
  return matches.length ? Number(matches.at(-1)[1]) : null;
}

function writeFailureOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function run(name, args, timeout = 600000) {
  const started = Date.now();
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: childEnv,
    ...(fullOutput ? { stdio: 'inherit' } : { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }),
    windowsHide: true,
    shell: false,
    timeout,
  });
  const durationMs = Date.now() - started;

  if (result.error || result.status !== 0) {
    if (!fullOutput) writeFailureOutput(result);
    throw new Error(`${name} 失败${result.error ? `: ${result.error.message}` : `，退出码 ${result.status}`}`);
  }

  if (!fullOutput) {
    const count = testCount(result.stdout);
    console.log(`[verify] ${name}: passed${count === null ? '' : `, ${count} tests`} (${durationMs} ms)`);
  }
}

if (profile !== 'tests') run('系统自检', ['./40-脚本/check-system.mjs']);
for (const group of requestedGroup ? [requestedGroup] : availableGroups) {
  run(`${group} 测试`, ['--test', ...testFiles(group)]);
}
if (profile === 'release' && !requestedGroup) {
  run('发布清单', ['./40-脚本/build-release-inventory.mjs']);
}

console.log(JSON.stringify({ ok: true, profile, group: requestedGroup }, null, 2));
