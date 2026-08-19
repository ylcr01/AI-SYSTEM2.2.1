import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { prepareTask, deliverTask } from '../../40-脚本/lib/task-runner.mjs';
import { computeChangeSet } from '../../40-脚本/lib/git-state.mjs';
import { gitRepo, tempDir } from '../helpers.mjs';

const DIRECT_ALIGNMENT = {
  originalRequest: '修复普通功能',
  goal: '修复普通功能',
  expectedOutcomes: ['功能正确'],
  protectedBehaviors: [],
  acceptance: ['功能正确'],
  confirmedDecisions: [],
  nonGoals: [],
  assumptions: [],
  alignment: {
    mode: 'direct',
    reasonCodes: ['single-observable-outcome', 'local-scope', 'acceptance-derivable', 'no-project-conflict'],
    decisionNote: null,
    delegatedTopics: [],
  },
};

function writeJson(t, value, name) {
  const file = path.join(tempDir(t), name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function writeRationale(t, task, changeSet, items) {
  return writeJson(t, { schemaVersion: 1, taskId: task.taskId, changeFingerprint: changeSet.fingerprint, items }, 'rationale.json');
}

test('对齐 Standard 任务带全量映射交付进入等待验收', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复普通功能', alignmentFile: writeJson(t, DIRECT_ALIGNMENT, 'alignment.json'), scope: '.' });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const changeSet = computeChangeSet(prepared.task.baseline);
  const delivered = deliverTask({
    stateRoot,
    taskId: prepared.task.taskId,
    rationaleFile: writeRationale(t, prepared.task, changeSet, [{ files: ['target.txt'], supports: ['A1'], reason: '实现功能' }]),
  });
  assert.equal(delivered.task.status, 'waiting_acceptance');
  assert.equal(delivered.task.changeRationale.ok, true);
});

test('对齐 Standard 任务缺少 rationale 保持 verifying', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复普通功能', alignmentFile: writeJson(t, DIRECT_ALIGNMENT, 'alignment.json'), scope: '.' });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'verifying');
  assert.equal(delivered.task.verification.stopReason, 'change-rationale-required');
});

test('对齐 Standard 任务存在未映射文件保持 verifying', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复普通功能', alignmentFile: writeJson(t, DIRECT_ALIGNMENT, 'alignment.json'), scope: '.' });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const changeSet = computeChangeSet(prepared.task.baseline);
  const delivered = deliverTask({
    stateRoot,
    taskId: prepared.task.taskId,
    rationaleFile: writeRationale(t, prepared.task, changeSet, [{ files: ['other.txt'], supports: ['A1'], reason: '错误映射' }]),
  });
  assert.equal(delivered.task.status, 'verifying');
  assert.equal(delivered.task.verification.stopReason, 'change-rationale-required');
  assert.deepEqual(delivered.task.changeRationale.unmappedFiles, ['target.txt']);
});

test('高风险 Intent 无 Alignment 且普通 runtime 文件变化必须 needs_rework', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修改用户权限判断逻辑', scope: '.' });
  assert.equal(prepared.task.classification.controlMode, 'controlled');
  assert.equal('alignment' in prepared.task.goal, false);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'user-service.ts'), 'export const x = 1;\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId, autoChecks: false });
  assert.equal(delivered.task.classification.controlMode, 'controlled');
  assert.equal(delivered.task.status, 'needs_rework');
  assert.equal(delivered.task.verification.stopReason, 'alignment-required');
  assert.deepEqual(delivered.task.deliveryDecision, { decision: 'needs_rework', reasons: ['alignment-required'] });
  assert.ok(delivered.task.blockers.some((item) => String(item).includes('confirmed/delegated')));
});

test('Structural 任务无 Alignment 时交付必须 needs_rework', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '重构体系职责迁移公共接口', scope: '.' });
  assert.equal(prepared.task.classification.structureImpact, 'structural');
  assert.equal('alignment' in prepared.task.goal, false);
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId, autoChecks: false });
  assert.equal(delivered.task.status, 'needs_rework');
  assert.equal(delivered.task.verification.stopReason, 'alignment-required');
  assert.deepEqual(delivered.task.deliveryDecision, { decision: 'needs_rework', reasons: ['alignment-required'] });
});

for (const mode of ['confirmed', 'delegated']) {
  test(`Controlled + ${mode} Alignment 且 Evidence 满足可正常交付`, (t) => {
    const repo = gitRepo(t);
    const stateRoot = tempDir(t);
    const alignment = {
      originalRequest: '修改权限校验逻辑',
      goal: '修改权限校验逻辑',
      expectedOutcomes: ['权限校验正确'],
      protectedBehaviors: [],
      acceptance: ['权限校验正确'],
      confirmedDecisions: [],
      nonGoals: [],
      assumptions: [],
      alignment: mode === 'confirmed'
        ? { mode: 'confirmed', reasonCodes: [], decisionNote: '用户确认修改权限校验逻辑', delegatedTopics: [] }
        : { mode: 'delegated', reasonCodes: [], decisionNote: '用户委托在目标范围内自行实现', delegatedTopics: ['权限校验内部实现'] },
    };
    const prepared = prepareTask({
      cwd: repo,
      stateRoot,
      intent: '修改权限校验逻辑',
      alignmentFile: writeJson(t, alignment, `alignment-${mode}.json`),
      scope: '.',
    });
    fs.mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'auth', 'check.js'), 'export const check = () => true;\n');
    const changeSet = computeChangeSet(prepared.task.baseline);
    const delivered = deliverTask({
      stateRoot,
      taskId: prepared.task.taskId,
      rationaleFile: writeRationale(t, prepared.task, changeSet, [{ files: ['src/auth/check.js'], supports: ['A1'], reason: '实现权限校验' }]),
    });
    assert.equal(delivered.task.classification.controlMode, 'controlled');
    assert.equal(delivered.task.status, 'waiting_acceptance');
  });
}

test('权限说明文档无 Alignment 最终 Quick 不被缺 Alignment 阻塞', (t) => {
  const repo = gitRepo(t, {
    checks: [{
      name: 'docs',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      profiles: ['quick'],
      covers: ['documentation'],
      sideEffect: 'none',
      estimatedCost: 'very-low',
      timeoutMs: 5000,
      acceptanceMode: 'matching-covers',
    }],
  });
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '更新权限说明文档', scope: '.' });
  assert.equal(prepared.task.classification.controlMode, 'controlled');
  fs.writeFileSync(path.join(repo, 'README.md'), '# updated\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.classification.controlMode, 'quick');
  assert.equal(delivered.task.status, 'waiting_acceptance');
  assert.notEqual(delivered.task.verification.stopReason, 'alignment-required');
});

test('受控任务未映射文件进入 needs_rework', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const controlled = {
    ...DIRECT_ALIGNMENT,
    originalRequest: '修改权限校验逻辑',
    goal: '修改权限校验逻辑',
    alignment: { mode: 'delegated', reasonCodes: [], decisionNote: '用户委托在目标范围内自行实现', delegatedTopics: ['权限校验内部实现'] },
  };
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修改权限校验逻辑', alignmentFile: writeJson(t, controlled, 'alignment.json'), scope: '.' });
  fs.mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'auth', 'check.ts'), 'export const check = () => true;\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'needs_rework');
  assert.equal(delivered.task.verification.stopReason, 'change-rationale-unmapped');
  assert.ok(delivered.task.blockers.some((item) => String(item).includes('Change Rationale')));
});

test('direct 任务真实风险升级后进入 needs_rework 并记录实质事件', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复普通功能', alignmentFile: writeJson(t, DIRECT_ALIGNMENT, 'alignment.json'), scope: '.' });
  fs.mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'auth', 'token.ts'), 'export const x = 1;\n');
  const changeSet = computeChangeSet(prepared.task.baseline);
  const delivered = deliverTask({
    stateRoot,
    taskId: prepared.task.taskId,
    rationaleFile: writeRationale(t, prepared.task, changeSet, [{ files: ['src/auth/token.ts'], supports: ['GOAL'], reason: '实现目标' }]),
  });
  assert.equal(delivered.task.status, 'needs_rework');
  assert.equal(delivered.task.verification.stopReason, 'alignment-risk-escalation');
  assert.ok(delivered.task.blockers.some((item) => String(item).includes('风险')));
  assert.equal(delivered.task.goal.alignment.events.length, 1);
  assert.equal(delivered.task.goal.alignment.events[0].type, 'alignment-risk-escalation');
});

test('无对齐文件的旧 Standard 交付不受 rationale 门禁影响', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复普通功能', acceptance: ['功能正确'], scope: '.' });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'waiting_acceptance');
});
