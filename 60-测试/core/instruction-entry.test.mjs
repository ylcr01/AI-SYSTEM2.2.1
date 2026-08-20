import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runNode, tempDir } from '../helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, '40-脚本', 'configure-model-entry.mjs');

test('大模型入口检查确认 V2.2.2 关键文件', () => {
  const result = runNode(SCRIPT, ['检查', '--root', ROOT], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.version, '2.2.2');
});

test('生成的自定义指令仅保留入口导航和不可绕过边界', () => {
  const result = runNode(SCRIPT, ['生成', '--fallback', ROOT], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AI_RD_OS_ROOT/u);
  assert.match(result.stdout, /AGENTS\.md/u);
  assert.match(result.stdout, /Scope or Evidence gates/u);
  assert.match(result.stdout, /waiting_acceptance/u);
  assert.match(result.stdout, /external writes without explicit user authorization/u);
  assert.doesNotMatch(result.stdout, /build-context\.mjs/u);
  assert.doesNotMatch(result.stdout, /task\.mjs/u);
  assert.ok(Buffer.byteLength(result.stdout) < 500);
});

test('项目入口初始化保持轻量且默认不覆盖', (t) => {
  const project = tempDir(t);
  const first = runNode(SCRIPT, ['初始化项目', '--cwd', project], { cwd: ROOT });
  assert.equal(first.status, 0, first.stderr);
  const file = path.join(project, 'AGENTS.md');
  assert.equal(fs.existsSync(file), true);
  assert.match(fs.readFileSync(file, 'utf8'), /AI_RD_OS_ROOT/u);
  const second = runNode(SCRIPT, ['初始化项目', '--cwd', project], { cwd: ROOT });
  assert.notEqual(second.status, 0);
});

test('系统入口保持轻量并将低频规则按需路由', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.ok(Buffer.byteLength(agents) < 5000);
  assert.match(agents, /70-文档\/25-按需任务规则\.md/u);
  assert.equal(fs.existsSync(path.join(ROOT, '70-文档', '25-按需任务规则.md')), true);
});

test('系统入口固化浏览器冒烟预算和熔断规则', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /最多 4 条核心链路/u);
  assert.match(agents, /单条最长 15 秒/u);
  assert.match(agents, /整批执行预算 2 分钟/u);
  assert.match(agents, /3 分钟不可放宽的硬超时/u);
  assert.match(agents, /任一用例失败或超时立即停止/u);
  assert.match(agents, /连续 30 秒无有效输出立即终止/u);
  assert.match(agents, /每 30 秒报告/u);
  assert.match(agents, /必须拆为单独任务并在启动前取得用户明确授权/u);
  assert.match(agents, /不能只依赖本文件/u);
});
