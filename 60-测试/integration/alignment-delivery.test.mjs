import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
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
    constraints: ['已有业务功能不能遗漏'],
    referenceRoots: ['src'],
    behaviors: [
      { id: 'R1', category: 'business', description: '创建订单', sourceFiles: ['src/a.js'] },
      { id: 'R2', category: 'data', description: '取消订单', sourceFiles: ['src/b.js'] },
    ],
    excludedFiles: [{ path: 'src/types.js', reason: '仅类型定义' }],
    allowedDifferences: [],
  },
  alignment: {
    mode: 'delegated',
    reasonCodes: [],
    decisionNote: '用户委托按原行为重构',
    delegatedTopics: ['订单模块重构'],
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
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '新模块拆分公共接口数据模型', scope: '.' });
  assert.equal(prepared.task.classification.structureImpact, 'structural');
  assert.equal('alignment' in prepared.task.goal, false);
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId, autoChecks: false });
  assert.equal(delivered.task.status, 'needs_rework');
  assert.equal(delivered.task.verification.stopReason, 'alignment-required');
  assert.deepEqual(delivered.task.deliveryDecision, { decision: 'needs_rework', reasons: ['alignment-required'] });
});

test('Alignment 缺失时 Auto Check 完全不执行', (t) => {
  const marker = path.join(tempDir(t), 'auto-check-ran.txt');
  const repo = gitRepo(t, {
    checks: [{
      name: 'must-not-run',
      command: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`],
      profiles: ['controlled'],
      covers: ['behavior', 'negative-path'],
      sideEffect: 'workspace',
      estimatedCost: 'very-low',
      timeoutMs: 5000,
      acceptanceMode: 'matching-covers',
    }],
  });
  const stateRoot = tempDir(t);
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修改用户权限判断逻辑', scope: '.' });
  assert.equal(prepared.task.classification.controlMode, 'controlled');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'user-service.js'), 'export const x = 1;\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'needs_rework');
  assert.equal(delivered.task.verification.stopReason, 'alignment-required');
  assert.deepEqual(delivered.task.deliveryDecision, { decision: 'needs_rework', reasons: ['alignment-required'] });
  assert.equal(fs.existsSync(marker), false);
});

test('direct 风险升级时 Auto Check 同样不执行', (t) => {
  const marker = path.join(tempDir(t), 'auto-check-ran.txt');
  const repo = gitRepo(t, {
    checks: [{
      name: 'must-not-run',
      command: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`],
      profiles: ['controlled'],
      covers: ['behavior', 'negative-path'],
      sideEffect: 'workspace',
      estimatedCost: 'very-low',
      timeoutMs: 5000,
      acceptanceMode: 'matching-covers',
    }],
  });
  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: '修复普通功能',
    alignmentFile: writeJson(t, DIRECT_ALIGNMENT, 'alignment.json'),
    scope: '.',
  });
  fs.mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'auth', 'token.js'), 'export const x = 1;\n');
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'needs_rework');
  assert.equal(delivered.task.verification.stopReason, 'alignment-risk-escalation');
  assert.deepEqual(delivered.task.deliveryDecision, { decision: 'needs_rework', reasons: ['alignment-risk-escalation'] });
  assert.equal(fs.existsSync(marker), false);
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

test('strict Preservation 无 Alignment 时准备被拒绝', (t) => {
  const repo = gitRepo(t);
  assert.throws(
    () => prepareTask({ cwd: repo, stateRoot: tempDir(t), intent: '重构订单模块', scope: '.' }),
    /behavior-preservation-alignment-required/u
  );
});

test('allowedDifference 使用 confirmed Alignment 可正常准备', (t) => {
  const repo = preservationRepo(t);
  const stateRoot = tempDir(t);
  const alignment = {
    ...PRESERVATION_ALIGNMENT,
    alignment: { mode: 'confirmed', reasonCodes: [], decisionNote: '用户确认删除流程差异', delegatedTopics: [] },
    preservation: {
      ...PRESERVATION_ALIGNMENT.preservation,
      allowedDifferences: [{ behaviorId: 'R1', description: '创建订单后由 pending 改为 queued' }],
    },
  };
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: PRESERVATION_ALIGNMENT.originalRequest,
    alignmentFile: writeJson(t, alignment, 'alignment.json'),
    scope: '.',
  });
  assert.equal(prepared.task.status, 'prepared');
  const r1 = prepared.task.acceptance.find((item) => item.referenceBehaviorId === 'R1');
  assert.equal(r1.description, '按批准差异验证 R1：创建订单后由 pending 改为 queued');
});

test('Alignment 不得把 Preservation Mode 向下降级', (t) => {
  const repo = preservationRepo(t);
  const stateRoot = tempDir(t);
  const downgraded = {
    ...PRESERVATION_ALIGNMENT,
    preservation: { mode: 'preserve-unrequested', behaviors: [], excludedFiles: [], allowedDifferences: [], constraints: [], referenceRoots: [] },
  };
  assert.throws(
    () => prepareTask({ cwd: repo, stateRoot, intent: PRESERVATION_ALIGNMENT.originalRequest, alignmentFile: writeJson(t, downgraded, 'down.json'), scope: '.' }),
    /preservation-mode-downgrade/u
  );
  const referenceDowngraded = {
    ...PRESERVATION_ALIGNMENT,
    originalRequest: '完全参照旧订单模块实现',
    goal: '完全参照旧订单模块实现',
    preservation: {
      mode: 'preserve-all-observable',
      constraints: [],
      referenceRoots: ['src'],
      behaviors: [{ id: 'R1', category: 'business', description: '创建订单', sourceFiles: ['src/a.js'] }],
      excludedFiles: [{ path: 'src/types.js', reason: '仅类型定义' }],
      allowedDifferences: [],
    },
  };
  assert.throws(
    () => prepareTask({ cwd: repo, stateRoot, intent: '完全参照旧订单模块实现', alignmentFile: writeJson(t, referenceDowngraded, 'ref-down.json'), scope: '.' }),
    /preservation-mode-downgrade/u
  );
});

test('更严格的 Preservation Mode 可覆盖较弱初始模式', (t) => {
  const repo = preservationRepo(t);
  const stateRoot = tempDir(t);
  const upgraded = {
    ...PRESERVATION_ALIGNMENT,
    preservation: {
      ...PRESERVATION_ALIGNMENT.preservation,
      mode: 'reference-equivalent',
    },
  };
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: PRESERVATION_ALIGNMENT.originalRequest,
    alignmentFile: writeJson(t, upgraded, 'up.json'),
    scope: '.',
  });
  assert.equal(prepared.task.status, 'prepared');
  assert.equal(prepared.task.goal.preservation.mode, 'reference-equivalent');
});

test('Reference Behavior 自动成为 Acceptance 且 Reference 清单进入 Goal', (t) => {
  const repo = preservationRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: PRESERVATION_ALIGNMENT.originalRequest,
    alignmentFile: writeJson(t, PRESERVATION_ALIGNMENT, 'alignment.json'),
    scope: '.',
  });
  const referenceItems = prepared.task.acceptance.filter((item) => item.source === 'reference-behavior');
  assert.equal(referenceItems.length, 2);
  assert.deepEqual(referenceItems.map((item) => item.referenceBehaviorId), ['R1', 'R2']);
  assert.ok(referenceItems.every((item) => item.requiredCovers.includes('behavior')));
  assert.ok(prepared.task.goal.preservation.referenceCommit);
  assert.deepEqual(prepared.task.goal.preservation.referenceFiles, ['src/a.js', 'src/b.js', 'src/types.js']);
});

test('Preservation 指纹被篡改后交付 needs_rework', (t) => {
  const repo = preservationRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: PRESERVATION_ALIGNMENT.originalRequest,
    alignmentFile: writeJson(t, PRESERVATION_ALIGNMENT, 'alignment.json'),
    scope: '.',
  });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'changed\n');
  const taskFile = path.join(stateRoot, '进行中', `${prepared.task.taskId}.json`);
  const raw = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  raw.goal.preservation.behaviors[0].description = 'tampered';
  fs.writeFileSync(taskFile, JSON.stringify(raw, null, 2));
  const delivered = deliverTask({ stateRoot, taskId: prepared.task.taskId });
  assert.equal(delivered.task.status, 'needs_rework');
  assert.equal(delivered.task.verification.stopReason, 'alignment-fingerprint-mismatch');
  assert.deepEqual(delivered.task.deliveryDecision, { decision: 'needs_rework', reasons: ['alignment-fingerprint-mismatch'] });
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
