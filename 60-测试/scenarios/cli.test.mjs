import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gitRepo, tempDir, runNode } from '../helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD_CONTEXT = path.join(ROOT, '40-脚本/build-context.mjs');
const TASK = path.join(ROOT, '40-脚本/task.mjs');

test('build-context 默认轻量，--full 保留完整上下文', t => {
  const repo = gitRepo(t);
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# test\n');

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
  assert.equal('facts' in compact, false);
  assert.equal('manifests' in compact, false);
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
  assert.ok(full.quality);
  assert.ok(Buffer.byteLength(compactResult.stdout) < Buffer.byteLength(fullResult.stdout));
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
