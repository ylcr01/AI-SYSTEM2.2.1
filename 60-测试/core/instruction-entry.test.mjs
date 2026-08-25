import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runNode, tempDir } from '../helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, '40-脚本', 'configure-model-entry.mjs');

test('大模型入口检查确认 V2.3.0 关键文件', () => {
  const result = runNode(SCRIPT, ['检查', '--root', ROOT], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.version, '2.3.0');
});

test('生成的自定义指令仅保留入口导航和不可绕过边界', () => {
  const result = runNode(SCRIPT, ['生成', '--fallback', ROOT], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AI_RD_OS_ROOT/u);
  assert.match(result.stdout, /AGENTS\.md/u);
  assert.match(result.stdout, /lightweight direct changes separately from formal Tasks/u);
  assert.match(result.stdout, /task-dedicated Worktree/u);
  assert.match(result.stdout, /deterministic detached fallback/u);
  assert.match(result.stdout, /Never write or silently fall back to Local\/main/u);
  assert.match(result.stdout, /Scope\/Evidence gates/u);
  assert.match(result.stdout, /waiting_acceptance/u);
  assert.match(result.stdout, /exact prior `continuation`/u);
  assert.match(result.stdout, /never scan for a pending Task/u);
  assert.match(result.stdout, /external writes without explicit user authorization/u);
  assert.match(result.stdout, /report degraded state/u);
  assert.match(result.stdout, /Browser hard limits remain global/u);
  assert.match(result.stdout, /at most 4 smoke flows/u);
  assert.match(result.stdout, /hard 3-minute outer timeout/u);
  assert.match(result.stdout, /Stop on the first failure or timeout/u);
  assert.match(result.stdout, /full regression requires explicit user authorization/u);
  assert.match(result.stdout, /Other checks never substitute for browser verification/u);
  assert.doesNotMatch(result.stdout, /build-context\.mjs/u);
  assert.doesNotMatch(result.stdout, /task\.mjs/u);
  assert.ok(Buffer.byteLength(result.stdout) < 1400);
});

test('项目入口初始化保持轻量且默认不覆盖', (t) => {
  const project = tempDir(t);
  const first = runNode(SCRIPT, ['初始化项目', '--cwd', project], { cwd: ROOT });
  assert.equal(first.status, 0, first.stderr);
  const file = path.join(project, 'AGENTS.md');
  assert.equal(fs.existsSync(file), true);
  assert.match(fs.readFileSync(file, 'utf8'), /AI_RD_OS_ROOT/u);
  assert.match(fs.readFileSync(file, 'utf8'), /本文件只登记当前项目特有/u);
  const second = runNode(SCRIPT, ['初始化项目', '--cwd', project], { cwd: ROOT });
  assert.notEqual(second.status, 0);
});

test('系统入口保持轻量并将低频规则按需路由', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.ok(Buffer.byteLength(agents) < 5000);
  assert.match(agents, /70-文档\/25-按需任务规则\.md/u);
  assert.match(agents, /git diff --stat\/--numstat/u);
  assert.match(agents, /不加载整份 Task JSON/u);
  assert.match(agents, /裁剪不得隐藏首个失败/u);
  assert.match(agents, /continuity=ephemeral/u);
  assert.match(agents, /不创建 Task/u);
  assert.doesNotMatch(agents, /仓库写任务必须先准备/u);
  assert.equal(fs.existsSync(path.join(ROOT, '70-文档', '25-按需任务规则.md')), true);
});

test('系统入口固化浏览器冒烟预算和熔断规则', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /最多 4 条核心链路/u);
  assert.match(agents, /单条最长 15 秒/u);
  assert.match(agents, /整批预算 2 分钟/u);
  assert.match(agents, /外层硬超时 3 分钟且不可放宽/u);
  assert.match(agents, /首个失败或超时立即停止/u);
  assert.match(agents, /连续 30 秒无有效输出即终止/u);
  assert.match(agents, /每 30 秒报告/u);
  assert.match(agents, /拆为独立任务并先获用户明确授权/u);
  assert.match(agents, /Runner 或外层命令也须固化上述超时和熔断/u);
});
