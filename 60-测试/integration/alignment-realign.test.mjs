import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
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
  originalRequest: '修复普通功能',
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

const PRESERVATION_ALIGNMENT = {
  originalRequest: '重构订单模块，原功能不能遗漏',
  goal: '重构订单模块并保持全部行为',
  expectedOutcomes: ['全部已有行为保持'],
  protectedBehaviors: [],
  acceptance: ['重构后行为保持'],
  confirmedDecisions: [],
  nonGoals: [],
  assumptions: [],
  preservation: {
    mode: 'preserve-all-observable',
    constraints: [],
    referenceRoots: ['src'],
    behaviors: [
      { id: 'R1', category: 'business', description: '创建订单', sourceFiles: ['src/a.js'] },
      { id: 'R2', category: 'data', description: '取消订单', sourceFiles: ['src/b.js'] },
    ],
    excludedFiles: [{ path: 'src/types.js', reason: '仅类型定义' }],
    allowedDifferences: [],
  },
  alignment: { mode: 'delegated', reasonCodes: [], decisionNote: '用户委托按原行为重构', delegatedTopics: ['订单模块重构'] },
};

function preservationRepo(t) {
  const repo = gitRepo(t);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'export const b = 1;\n');
  fs.writeFileSync(path.join(repo, 'src', 'types.js'), 'export const t = 1;\n');
  for (const args of [['add', '.'], ['-c', 'user.email=t@e.c', '-c', 'user.name=T', 'commit', '-m', 'ref']]) {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  return repo;
}

function realignAlignment(behaviors, excludedFiles) {
  return {
    originalRequest: PRESERVATION_ALIGNMENT.originalRequest,
    goal: '修订后的重构目标',
    expectedOutcomes: ['全部已有行为保持'],
    protectedBehaviors: [],
    acceptance: ['重构后行为保持'],
    confirmedDecisions: ['用户确认调整行为清单'],
    nonGoals: [],
    assumptions: [],
    preservation: {
      mode: 'preserve-all-observable',
      constraints: [],
      referenceRoots: ['src'],
      behaviors,
      excludedFiles,
      allowedDifferences: [],
    },
    alignment: { mode: 'confirmed', reasonCodes: [], decisionNote: '用户确认修订行为清单', delegatedTopics: [] },
  };
}

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
  assert.equal(realigned.task.goal.originalRequest, '修复普通功能');
  assert.equal(realigned.task.goal.alignment.events.length, 1);
  assert.equal(realigned.task.goal.alignment.events[0].type, 'realignment');
  assert.ok(realigned.task.goal.alignment.events[0].oldBaselineFingerprint);
  assert.notEqual(realigned.task.goal.alignment.events[0].newBaselineFingerprint, realigned.task.goal.alignment.events[0].oldBaselineFingerprint);
  assert.deepEqual(realigned.task.authorization.scope, beforeScope);
  assert.deepEqual(realigned.task.evidence, []);
  assert.equal(realigned.task.reviewPackage, undefined);
  assert.equal(realigned.task.changeRationale, null);
  assert.equal(realigned.task.handoff, null);
  assert.equal(realigned.task.verification.inputCycle, 1);
  assert.equal(realigned.task.verification.checkManifest, null);
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

test('Realign 删除 Behavior 但未归因对应文件时被拒绝', (t) => {
  const repo = preservationRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: PRESERVATION_ALIGNMENT.originalRequest,
    alignmentFile: writeJson(t, PRESERVATION_ALIGNMENT, 'alignment.json'),
    scope: '.',
  });
  const next = realignAlignment(
    [{ id: 'R1', category: 'business', description: '创建订单', sourceFiles: ['src/a.js'] }],
    [{ path: 'src/types.js', reason: '仅类型定义' }],
  );
  assert.throws(
    () => realignTask({ stateRoot, taskId: prepared.task.taskId, alignmentFile: writeJson(t, next, 'realign.json'), reason: '删除 R2' }),
    /realignment-reference-files-unmapped/u
  );
});

test('Realign 删除 Behavior 且补 excludedFiles 后允许并冻结 Reference 清单', (t) => {
  const repo = preservationRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: PRESERVATION_ALIGNMENT.originalRequest,
    alignmentFile: writeJson(t, PRESERVATION_ALIGNMENT, 'alignment.json'),
    scope: '.',
  });
  const frozenCommit = prepared.task.goal.preservation.referenceCommit;
  const frozenFiles = prepared.task.goal.preservation.referenceFiles;
  const next = realignAlignment(
    [{ id: 'R1', category: 'business', description: '创建订单', sourceFiles: ['src/a.js'] }],
    [
      { path: 'src/types.js', reason: '仅类型定义' },
      { path: 'src/b.js', reason: '已并入 R1 验证范围，不再独立承载行为' },
    ],
  );
  const realigned = realignTask({ stateRoot, taskId: prepared.task.taskId, alignmentFile: writeJson(t, next, 'realign.json'), reason: '删除 R2 并排除 b.js' });
  assert.equal(realigned.task.status, 'implementing');
  assert.equal(realigned.task.goal.preservation.referenceCommit, frozenCommit);
  assert.deepEqual(realigned.task.goal.preservation.referenceFiles, frozenFiles);
  assert.deepEqual(realigned.task.goal.preservation.behaviors.map((item) => item.id), ['R1']);
});

test('Realign 不得把 Preservation Mode 向下降级', (t) => {
  const repo = preservationRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: PRESERVATION_ALIGNMENT.originalRequest,
    alignmentFile: writeJson(t, PRESERVATION_ALIGNMENT, 'alignment.json'),
    scope: '.',
  });
  const next = {
    ...realignAlignment([], []),
    preservation: { mode: 'preserve-unrequested', constraints: [], referenceRoots: [], behaviors: [], excludedFiles: [], allowedDifferences: [] },
  };
  assert.throws(
    () => realignTask({ stateRoot, taskId: prepared.task.taskId, alignmentFile: writeJson(t, next, 'realign.json'), reason: '尝试降级' }),
    /preservation-mode-downgrade/u
  );
});

test('Realign 的 sourceFiles 必须属于冻结 referenceFiles', (t) => {
  const repo = preservationRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: PRESERVATION_ALIGNMENT.originalRequest,
    alignmentFile: writeJson(t, PRESERVATION_ALIGNMENT, 'alignment.json'),
    scope: '.',
  });
  const next = realignAlignment(
    [
      { id: 'R1', category: 'business', description: '创建订单', sourceFiles: ['src/a.js'] },
      { id: 'R2', category: 'data', description: '取消订单', sourceFiles: ['src/b.js'] },
      { id: 'R3', category: 'business', description: '幽灵行为', sourceFiles: ['src/ghost.js'] },
    ],
    [{ path: 'src/types.js', reason: '仅类型定义' }],
  );
  assert.throws(
    () => realignTask({ stateRoot, taskId: prepared.task.taskId, alignmentFile: writeJson(t, next, 'realign.json'), reason: '引入幽灵文件' }),
    /realignment-reference-files-foreign/u
  );
});

test('Realign 的 excludedFiles 必须属于冻结 referenceFiles', (t) => {
  const repo = preservationRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: PRESERVATION_ALIGNMENT.originalRequest,
    alignmentFile: writeJson(t, PRESERVATION_ALIGNMENT, 'alignment.json'),
    scope: '.',
  });
  const next = realignAlignment(
    [
      { id: 'R1', category: 'business', description: '创建订单', sourceFiles: ['src/a.js'] },
      { id: 'R2', category: 'data', description: '取消订单', sourceFiles: ['src/b.js'] },
    ],
    [
      { path: 'src/types.js', reason: '仅类型定义' },
      { path: 'src/ghost.js', reason: '幽灵文件排除' },
    ],
  );
  assert.throws(
    () => realignTask({ stateRoot, taskId: prepared.task.taskId, alignmentFile: writeJson(t, next, 'realign.json'), reason: '排除幽灵文件' }),
    /realignment-reference-files-foreign/u
  );
});

test('无对齐文件的旧任务仍可交付，不受重新对齐影响', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复普通功能', acceptance: ['功能正确'], scope: '.' });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'waiting_acceptance');
});
