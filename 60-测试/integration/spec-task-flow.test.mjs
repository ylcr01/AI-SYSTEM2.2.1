import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { prepareTask, deliverTask } from '../../40-脚本/lib/task-runner.mjs';
import { gitRepo, tempDir } from '../helpers.mjs';

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

test('无规格映射且 specImpact=none 时详细规格与 Review 退出主路径', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复普通功能', acceptance: ['行为正确'], scope: '.', specImpact: 'none' });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'waiting_acceptance');
  assert.equal(delivered.task.specTraceability, null);
  assert.equal(delivered.task.specConsistency, null);
  assert.equal(delivered.task.reviewPackage, null);
});

test('交付自动保存 changed-file 到规格 ID 的追踪结果', (t) => {
  const repo = gitRepo(t);
  fs.mkdirSync(path.join(repo, 'src', 'order'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs', 'modules'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'tests', 'order'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'order', 'cancel.js'), 'export const allowed = false;\n');
  fs.writeFileSync(path.join(repo, 'docs', 'modules', 'order.md'), '# 订单\nBR-ORD-001\n');
  fs.writeFileSync(path.join(repo, 'tests', 'order', 'cancel.test.js'), '// BR-ORD-001\n');
  fs.writeFileSync(path.join(repo, '.ai', 'spec-map.json'), JSON.stringify({
    schemaVersion: 1,
    mappings: [{
      id: 'order', paths: ['src/order/**'], specificationFiles: ['docs/modules/order.md'],
      specificationIds: ['BR-ORD-*'], testFiles: ['tests/order/cancel.test.js'], decisionFiles: ['docs/modules/order/decisions/**']
    }]
  }, null, 2));
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'add spec baseline']);

  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复订单取消判断', acceptance: ['取消行为正确'], scope: '.' });
  fs.writeFileSync(path.join(repo, 'src', 'order', 'cancel.js'), 'export const allowed = true;\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'waiting_acceptance');
  assert.deepEqual(delivered.task.specTraceability.affectedSpecificationIds, ['BR-ORD-001']);
  assert.ok(delivered.task.specConsistency.issues.some((item) => item.id === 'SPEC_IMPACT_UNDECLARED'));
});

test('specImpact=updated 但没有更新规格时交付进入 needs_rework', (t) => {
  const repo = gitRepo(t);
  fs.mkdirSync(path.join(repo, 'src', 'order'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs', 'modules'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'order', 'cancel.js'), 'export const allowed = false;\n');
  fs.writeFileSync(path.join(repo, 'docs', 'modules', 'order.md'), '# 订单\nBR-ORD-001\n');
  fs.writeFileSync(path.join(repo, '.ai', 'spec-map.json'), JSON.stringify({
    schemaVersion: 1,
    mappings: [{
      id: 'order', paths: ['src/order/**'], specificationFiles: ['docs/modules/order.md'],
      specificationIds: ['BR-ORD-*'], testFiles: [], decisionFiles: ['docs/modules/order/decisions/**']
    }]
  }, null, 2));
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'add spec baseline']);

  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo, stateRoot, intent: '修改订单取消业务规则', acceptance: ['新规则生效'], scope: '.',
    specImpact: 'updated', specImpactReason: '允许特殊状态取消', affectedSpecificationIds: ['BR-ORD-001']
  });
  fs.writeFileSync(path.join(repo, 'src', 'order', 'cancel.js'), 'export const allowed = true;\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'needs_rework');
  assert.ok(delivered.task.specConsistency.blockingIssues.some((item) => item.id === 'SPEC_UPDATE_MISSING'));
});

test('decision-required 通过真实 Task 校验 Decision 元数据', (t) => {
  const repo = gitRepo(t);
  fs.mkdirSync(path.join(repo, 'src', 'order'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs', 'modules', 'order', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'order', 'flow.js'), 'export const mode = "sync";\n');
  fs.writeFileSync(path.join(repo, 'docs', 'modules', 'order.md'), '# 订单\nBR-ORD-001\n');
  fs.writeFileSync(path.join(repo, '.ai', 'spec-map.json'), JSON.stringify({
    schemaVersion: 1,
    mappings: [{
      id: 'order', paths: ['src/order/**'], specificationFiles: ['docs/modules/order.md'],
      specificationIds: ['BR-ORD-*'], testFiles: [], decisionFiles: ['docs/modules/order/decisions/**']
    }]
  }, null, 2));
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'decision baseline']);

  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo, stateRoot, intent: '将订单处理改为异步', acceptance: ['异步模式生效'], scope: '.',
    specImpact: 'decision-required', specImpactReason: '同步改异步', affectedSpecificationIds: ['BR-ORD-001']
  });
  fs.writeFileSync(path.join(repo, 'src', 'order', 'flow.js'), 'export const mode = "async";\n');
  fs.writeFileSync(path.join(repo, 'docs', 'modules', 'order', 'decisions', 'DEC-ORD-001.md'), `---
id: DEC-ORD-001
status: proposed
affects:
  - order-processing
sourceTaskId: ${prepared.task.taskId}
---
# 异步处理
`);
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'waiting_acceptance');
  assert.equal(delivered.task.specConsistency.ok, true);
});
