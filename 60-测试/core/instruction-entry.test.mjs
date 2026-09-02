import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runNode, tempDir } from '../helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, '40-脚本', 'configure-model-entry.mjs');

function normalizedUtf8Bytes(value) {
  return Buffer.byteLength(value.replace(/\r\n/g, '\n'));
}

test('大模型入口检查确认 V2.3.0 关键文件', () => {
  const result = runNode(SCRIPT, ['检查', '--root', ROOT], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.version, '2.3.0');
});

test('生成的自定义指令只保留根入口定位与跨仓库浏览器硬边界', () => {
  const result = runNode(SCRIPT, ['生成', '--fallback', ROOT], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AI_RD_OS_ROOT/u);
  assert.match(result.stdout, /AGENTS\.md/u);
  assert.match(result.stdout, /report the degraded state/u);
  assert.match(result.stdout, /do not guess project identity/u);
  assert.match(result.stdout, /Browser verification hard limits/u);
  assert.match(result.stdout, /at most 4 critical flows/u);
  assert.match(result.stdout, /non-extendable 3-minute outer process timeout/u);
  assert.match(result.stdout, /Stop the batch on the first failure or timeout/u);
  assert.match(result.stdout, /full historical suite is regression testing/u);
  assert.match(result.stdout, /explicit user authorization/u);
  assert.match(result.stdout, /Other checks cannot substitute for browser verification/u);
  assert.doesNotMatch(result.stdout, /Task|Scope|Worktree|Evidence|Never Push/u);
  assert.doesNotMatch(result.stdout, /build-context\.mjs/u);
  assert.doesNotMatch(result.stdout, /task\.mjs/u);
  assert.ok(normalizedUtf8Bytes(result.stdout) < 1600);
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
  assert.ok(normalizedUtf8Bytes(agents) < 5000);
  assert.match(agents, /70-文档\/25-按需任务规则\.md/u);
  assert.match(agents, /git diff --stat\/--numstat/u);
  assert.match(agents, /不加载整份 Task JSON/u);
  assert.match(agents, /裁剪不得隐藏首个失败/u);
  assert.match(agents, /模型自主执行/u);
  assert.match(agents, /普通修改不预建 Goal Card、Scope、Evidence/u);
  assert.match(agents, /可安全自动化命令，不转交用户/u);
  assert.doesNotMatch(agents, /仓库写任务必须先准备/u);
  assert.equal(fs.existsSync(path.join(ROOT, '70-文档', '25-按需任务规则.md')), true);
});

test('系统入口固化浏览器冒烟预算和熔断规则', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  const result = runNode(SCRIPT, ['生成', '--fallback', ROOT], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  assert.match(agents, /浏览器验证使用全局宿主入口的硬限制/u);
  assert.match(agents, /该入口未加载时不得执行/u);
  assert.match(result.stdout, /15 seconds per test/u);
  assert.match(result.stdout, /2 minutes for the batch/u);
  assert.match(result.stdout, /3-minute outer process timeout/u);
  assert.match(result.stdout, /first failure or timeout/u);
  assert.match(result.stdout, /30 seconds without meaningful output/u);
  assert.match(result.stdout, /explicit user authorization/u);
  assert.match(result.stdout, /runner or outer command/u);
});

test('系统入口把普通修改交给模型并只硬控事实边界', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /先只读预检 Git 清洁度/u);
  assert.match(agents, /模型直接实施并展示真实 Git Diff/u);
  assert.match(agents, /关键词、目录名.*不得自动创建 Task 或 Worktree/u);
  assert.match(agents, /工作区脏、被占用、存在已知并发/u);
  assert.match(agents, /Task 是持续跟踪、跨对话交接、并行隔离或已授权外部写入的显式能力/u);
  assert.match(agents, /用户限定文件时 Scope 是硬边界/u);
  assert.match(agents, /Acceptance 只写结果/u);
  assert.match(agents, /生成并执行最小验证计划/u);
  assert.match(agents, /全量回归须独立 Task/u);
  assert.match(agents, /package\.json.*不按路径升级/u);
  assert.doesNotMatch(agents, /默认本地提交/u);
  assert.match(agents, /完成轮次/u);
  assert.match(agents, /不得 Push/u);
});

test('Controlled 普通交付不自动运行完整 Integration 历史组', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.ai', 'checks.json'), 'utf8'));
  const integration = config.checks.find((item) => item.name === 'integration-tests');
  const staticIntegrity = config.checks.find((item) => item.name === 'static-integrity');
  assert.deepEqual(integration.profiles, ['release']);
  assert.equal(staticIntegrity.profiles.includes('controlled'), true);
});
