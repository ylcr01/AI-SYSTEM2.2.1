import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gitRepo, tempDir, runNode } from '../helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD_CONTEXT = path.join(ROOT, '40-脚本/build-context.mjs');
const TASK = path.join(ROOT, '40-脚本/task.mjs');
const VERIFY = path.join(ROOT, '40-脚本/verify-system.mjs');

test('build-context 默认轻量，--full 保留完整上下文', t => {
  const repo = gitRepo(t);
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# test\n');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    name: 'sample-app',
    scripts: { test: 'node --test', build: 'vite build' },
    dependencies: { vue: '3' },
  }));

  const compactResult = runNode(BUILD_CONTEXT, [
    '--cwd', repo,
    '--intent', '分析当前实现',
  ], { cwd: ROOT });
  assert.equal(compactResult.status, 0, compactResult.stderr);
  const compact = JSON.parse(compactResult.stdout);
  assert.equal(compact.view, 'summary');
  assert.equal(path.basename(compact.context.gitRoot), path.basename(repo));
  assert.equal(fs.existsSync(compact.context.gitRoot), true);
  assert.ok(compact.filesToRead.some(file => file.endsWith('AGENTS.md')));
  assert.ok(!compact.filesToRead.some(file => file.endsWith('package.json')));
  assert.equal(compact.manifests[0].name, 'sample-app');
  assert.deepEqual(compact.manifests[0].frameworks, ['vue']);
  assert.equal('facts' in compact, false);
  assert.equal('quality' in compact, false);

  const fullResult = runNode(BUILD_CONTEXT, [
    '--cwd', repo,
    '--intent', '分析当前实现',
    '--full',
  ], { cwd: ROOT });
  assert.equal(fullResult.status, 0, fullResult.stderr);
  const full = JSON.parse(fullResult.stdout);
  assert.equal(full.view, undefined);
  assert.ok(Array.isArray(full.facts));
  assert.ok(Array.isArray(full.manifests));
  assert.equal(full.facts.find(fact => fact.path.endsWith('package.json')).readMode, 'machine');
  assert.ok(full.quality);
  assert.ok(Buffer.byteLength(compactResult.stdout) < Buffer.byteLength(fullResult.stdout));

  const dependencyResult = runNode(BUILD_CONTEXT, [
    '--cwd', repo,
    '--intent', '分析 package 依赖',
  ], { cwd: ROOT });
  assert.equal(dependencyResult.status, 0, dependencyResult.stderr);
  assert.ok(JSON.parse(dependencyResult.stdout).filesToRead.some(file => file.endsWith('package.json')));
});

test('系统入口已由宿主加载时不进入 filesToRead', () => {
  const compactResult = runNode(BUILD_CONTEXT, [
    '--cwd', ROOT,
    '--intent', '分析当前实现',
  ], { cwd: ROOT });
  assert.equal(compactResult.status, 0, compactResult.stderr);
  const compact = JSON.parse(compactResult.stdout);
  assert.ok(!compact.filesToRead.some(file => file === path.join(ROOT, 'AGENTS.md')));
  assert.ok(!compact.filesToRead.some(file => file === path.join(ROOT, 'package.json')));
  assert.equal(compact.manifests[0].name, 'personal-ai-rd-operating-system');

  const fullResult = runNode(BUILD_CONTEXT, [
    '--cwd', ROOT,
    '--intent', '分析当前实现',
    '--full',
  ], { cwd: ROOT });
  assert.equal(fullResult.status, 0, fullResult.stderr);
  const full = JSON.parse(fullResult.stdout);
  assert.equal(full.facts.find(fact => fact.path === path.join(ROOT, 'AGENTS.md')).readMode, 'preloaded');
  assert.equal(full.facts.find(fact => fact.path === path.join(ROOT, 'package.json')).readMode, 'machine');
});

test('系统验证聚合成功结果并保留完整成功/失败诊断', { timeout: 60000 }, t => {
  const compact = runNode(VERIFY, [
    '--profile', 'tests',
    '--group', 'core',
  ], { cwd: ROOT, timeout: 60000 });
  assert.equal(compact.status, 0, compact.stderr);
  assert.match(compact.stdout, /core 测试: passed, \d+ tests/u);
  assert.doesNotMatch(compact.stdout, /原子写完整替换 JSON/u);

  const full = runNode(VERIFY, [
    '--profile', 'tests',
    '--group', 'core',
    '--full',
  ], { cwd: ROOT, timeout: 60000 });
  assert.equal(full.status, 0, full.stderr);
  assert.match(full.stdout, /原子写完整替换 JSON/u);
  assert.ok(Buffer.byteLength(compact.stdout) < Buffer.byteLength(full.stdout));

  const fixture = path.join(ROOT, '60-测试', 'core', 'verification-failure-fixture.test.mjs');
  assert.equal(fs.existsSync(fixture), false);
  t.after(() => fs.rmSync(fixture, { force: true }));
  fs.writeFileSync(fixture, [
    "import test from 'node:test';",
    "test('verification failure fixture', () => { throw new Error('DIAGNOSTIC_MARKER'); });",
    '',
  ].join('\n'));

  const failed = runNode(VERIFY, [
    '--profile', 'tests',
    '--group', 'core',
  ], { cwd: ROOT, timeout: 60000 });
  assert.notEqual(failed.status, 0);
  const diagnostics = `${failed.stdout}\n${failed.stderr}`;
  assert.match(diagnostics, /verification failure fixture/u);
  assert.match(diagnostics, /DIAGNOSTIC_MARKER/u);
});

test('Task CLI 默认轻量，--full 保留完整 Task', t => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = runNode(TASK, [
    '准备',
    '--cwd', repo,
    '--intent', '修复普通功能',
    '--acceptance', '功能正确',
    '--scope', '.',
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const receipt = JSON.parse(prepared.stdout);
  assert.equal(receipt.view, 'summary');
  assert.equal(receipt.status, 'prepared');
  assert.equal(receipt.scope[0].path, '.');
  assert.equal('baseline' in receipt, false);
  assert.ok(receipt.recordPath);

  const compactShown = runNode(TASK, [
    '查看',
    '--task-id', receipt.taskId,
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(compactShown.status, 0, compactShown.stderr);
  assert.equal('baseline' in JSON.parse(compactShown.stdout), false);

  const fullShown = runNode(TASK, [
    '查看',
    '--task-id', receipt.taskId,
    '--state-root', stateRoot,
    '--full',
  ], { cwd: ROOT });
  assert.equal(fullShown.status, 0, fullShown.stderr);
  const fullTask = JSON.parse(fullShown.stdout);
  assert.ok(fullTask.baseline);
  assert.ok(fullTask.context);
  assert.ok(Buffer.byteLength(prepared.stdout) < Buffer.byteLength(fullShown.stdout));

  const compactList = runNode(TASK, [
    '列表',
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(compactList.status, 0, compactList.stderr);
  const taskList = JSON.parse(compactList.stdout);
  assert.equal(taskList.view, 'summary');
  assert.equal(taskList.counts.prepared, 1);
  assert.equal(taskList.tasks[0].taskId, receipt.taskId);
  assert.equal('baseline' in taskList.tasks[0], false);

  const fullList = runNode(TASK, [
    '列表',
    '--state-root', stateRoot,
    '--full',
  ], { cwd: ROOT });
  assert.equal(fullList.status, 0, fullList.stderr);
  assert.ok(JSON.parse(fullList.stdout).tasks[0].baseline);
});

test('CLI 准备→交付→验收完整闭环', t => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = runNode(TASK, [
    '准备',
    '--cwd', repo,
    '--intent', '修复普通功能',
    '--acceptance', '功能正确',
    '--scope', '.',
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const task = JSON.parse(prepared.stdout);
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');

  const delivered = runNode(TASK, [
    '交付',
    '--task-id', task.taskId,
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(delivered.status, 0, delivered.stderr);
  const deliveryReceipt = JSON.parse(delivered.stdout);
  assert.equal(deliveryReceipt.status, 'waiting_acceptance');
  assert.equal(deliveryReceipt.view, 'summary');
  assert.equal('evidence' in deliveryReceipt, false);

  const accepted = runNode(TASK, [
    '验收',
    '--task-id', task.taskId,
    '--state-root', stateRoot,
    '--decision', '通过',
  ], { cwd: ROOT });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).status, 'accepted');
});

test('系统完整检查通过', () => {
  const result = runNode(path.join(ROOT, '40-脚本/check-system.mjs'), [], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});
