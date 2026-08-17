import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { prepareTask, deliverTask, realignTask, acceptTask } from '../../40-脚本/lib/task-runner.mjs';
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

const CONFIRMED_ALIGNMENT = {
  originalRequest: '修订目标：改为新行为',
  goal: '改为新行为',
  expectedOutcomes: ['新行为生效'],
  protectedBehaviors: [],
  acceptance: ['新行为正确'],
  confirmedDecisions: ['用户确认采用新行为'],
  nonGoals: [],
  assumptions: [],
  alignment: {
    mode: 'confirmed',
    reasonCodes: [],
    decisionNote: '用户在 Codex 进度中确认修订后的目标',
    delegatedTopics: [],
  },
};

function writeJson(t, value, name) {
  const file = path.join(tempDir(t), name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function deliveredDirectTask(t) {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复普通功能', alignmentFile: writeJson(t, DIRECT_ALIGNMENT, 'alignment.json'), scope: '.' });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const changeSet = computeChangeSet(prepared.task.baseline);
  const rationaleFile = writeJson(t, {
    schemaVersion: 1,
    taskId: prepared.task.taskId,
    changeFingerprint: changeSet.fingerprint,
    items: [{ files: ['target.txt'], supports: ['A1'], reason: '实现功能' }],
  }, 'rationale.json');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId, rationaleFile });
  assert.equal(delivered.task.status, 'waiting_acceptance');
  return { repo, stateRoot, task: delivered.task };
}

test('重新对齐增加修订、切换模式、清空旧验证产物并回到 implementing', (t) => {
  const { stateRoot, task } = deliveredDirectTask(t);
  const beforeScope = task.authorization.scope;
  const realigned = realignTask({
    stateRoot,
    taskId: task.taskId,
    alignmentFile: writeJson(t, CONFIRMED_ALIGNMENT, 'realign.json'),
    reason: '用户修订了目标',
  });
  assert.equal(realigned.task.status, 'implementing');
  assert.equal(realigned.task.goal.alignment.mode, 'confirmed');
  assert.equal(realigned.task.goal.alignment.revision, 2);
  assert.equal(realigned.task.goal.originalRequest, '修订目标：改为新行为');
  assert.equal(realigned.task.goal.alignment.events.length, 1);
  assert.equal(realigned.task.goal.alignment.events[0].type, 'realignment');
  assert.ok(realigned.task.goal.alignment.events[0].oldBaselineFingerprint);
  assert.notEqual(realigned.task.goal.alignment.events[0].newBaselineFingerprint, realigned.task.goal.alignment.events[0].oldBaselineFingerprint);
  assert.deepEqual(realigned.task.authorization.scope, beforeScope);
  assert.deepEqual(realigned.task.evidence, []);
  assert.equal(realigned.task.reviewPackage, null);
  assert.equal(realigned.task.changeRationale, null);
  assert.equal(realigned.task.handoff, null);
  assert.equal(realigned.task.verification.inputCycle, 1);
  assert.deepEqual(realigned.task.acceptance.map((item) => item.description), ['新行为正确']);
});

test('重新对齐拒绝 direct、缺少 decisionNote 与缺少原因', (t) => {
  const { stateRoot, task } = deliveredDirectTask(t);
  assert.throws(() => realignTask({
    stateRoot,
    taskId: task.taskId,
    alignmentFile: writeJson(t, DIRECT_ALIGNMENT, 'direct.json'),
    reason: '尝试 direct',
  }), /confirmed 或 delegated/u);
  assert.throws(() => realignTask({
    stateRoot,
    taskId: task.taskId,
    alignmentFile: writeJson(t, { ...CONFIRMED_ALIGNMENT, alignment: { mode: 'confirmed', reasonCodes: [], decisionNote: '', delegatedTopics: [] } }, 'no-note.json'),
    reason: '缺少确认说明',
  }), /decisionNote/u);
  assert.throws(() => realignTask({
    stateRoot,
    taskId: task.taskId,
    alignmentFile: writeJson(t, CONFIRMED_ALIGNMENT, 'no-reason.json'),
    reason: ' ',
  }), /原因/u);
});

test('已结束任务不能重新对齐', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复普通功能', acceptance: ['功能正确'], scope: '.' });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  const accepted = acceptTask({ stateRoot, taskId: prepared.task.taskId, decision: '通过' });
  assert.equal(accepted.task.status, 'accepted');
  assert.throws(() => realignTask({
    stateRoot,
    taskId: prepared.task.taskId,
    alignmentFile: writeJson(t, CONFIRMED_ALIGNMENT, 'realign.json'),
    reason: '想重开已结束任务',
  }), /已结束任务/u);
});

test('无对齐文件的旧任务仍可交付，不受重新对齐影响', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复普通功能', acceptance: ['功能正确'], scope: '.' });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'waiting_acceptance');
});
