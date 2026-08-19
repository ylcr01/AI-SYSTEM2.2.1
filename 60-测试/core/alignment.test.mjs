import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  loadAlignmentFile,
  normalizeAlignment,
  validateAlignmentForPreparation,
  evaluateFinalAlignment,
  computeAlignmentFingerprint,
  buildAlignedGoal,
  synthesizeQuickAlignment,
} from '../../40-脚本/lib/alignment.mjs';
import { prepareTask } from '../../40-脚本/lib/task-runner.mjs';
import { gitRepo, tempDir, runNode } from '../helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const DIRECT_ALIGNMENT = {
  originalRequest: '筛选条件变化时将页码重置为第一页',
  goal: '筛选变化后重置页码',
  expectedOutcomes: ['下一次请求使用 page=1'],
  protectedBehaviors: ['刷新带 page 参数的 URL 仍加载指定页'],
  acceptance: ['新增组合测试通过'],
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

function writeAlignment(t, value, name = 'alignment.json') {
  const file = path.join(tempDir(t), name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

test('对齐文件规范化去空去重并支持字符串数组', () => {
  const alignment = normalizeAlignment({
    originalRequest: ' 修复分页 ',
    goal: '重置页码',
    expectedOutcomes: '请求用 page=1',
    protectedBehaviors: ['保持 URL 参数', '保持 URL 参数', '  '],
    acceptance: ['测试通过；组合测试通过'],
    alignment: { mode: 'direct', reasonCodes: 'local-scope,local-scope' },
  });
  assert.equal(alignment.originalRequest, '修复分页');
  assert.deepEqual(alignment.expectedOutcomes, ['请求用 page=1']);
  assert.deepEqual(alignment.protectedBehaviors, ['保持 URL 参数']);
  assert.deepEqual(alignment.acceptance, ['测试通过', '组合测试通过']);
  assert.deepEqual(alignment.alignment.reasonCodes, ['local-scope']);
});

test('缺少 originalRequest 或 Goal 被拒绝', () => {
  assert.throws(() => validateAlignmentForPreparation({ alignment: { ...DIRECT_ALIGNMENT, originalRequest: '' }, classification: { controlMode: 'standard', structureImpact: 'local' } }), /originalRequest/u);
  assert.throws(() => validateAlignmentForPreparation({ alignment: { ...DIRECT_ALIGNMENT, goal: '' }, classification: { controlMode: 'standard', structureImpact: 'local' } }), /Goal/u);
});

test('至少需要 Expected Outcome 和 Acceptance 或 Protected Behavior', () => {
  assert.throws(() => validateAlignmentForPreparation({ alignment: { ...DIRECT_ALIGNMENT, expectedOutcomes: [] }, classification: { controlMode: 'standard', structureImpact: 'local' } }), /Expected Outcome/u);
  assert.throws(() => validateAlignmentForPreparation({ alignment: { ...DIRECT_ALIGNMENT, acceptance: [], protectedBehaviors: [] }, classification: { controlMode: 'standard', structureImpact: 'local' } }), /Acceptance 或 Protected Behavior/u);
});

test('direct 缺少 reasonCodes 被拒绝', () => {
  const alignment = {
    ...DIRECT_ALIGNMENT,
    alignment: { ...DIRECT_ALIGNMENT.alignment, reasonCodes: ['local-scope'] },
  };
  assert.throws(() => validateAlignmentForPreparation({ alignment, classification: { controlMode: 'standard', structureImpact: 'local' } }), /direct 缺少依据/u);
});

test('Controlled/Structural 拒绝 direct', () => {
  for (const classification of [
    { controlMode: 'controlled', structureImpact: 'local' },
    { controlMode: 'standard', structureImpact: 'structural' },
  ]) {
    assert.throws(() => validateAlignmentForPreparation({ alignment: DIRECT_ALIGNMENT, classification }), /Controlled\/Structural/u);
  }
});

test('最终对齐门禁只要求 Controlled/Structural 具有 confirmed/delegated', () => {
  assert.deepEqual(
    evaluateFinalAlignment({ goal: {}, classification: { controlMode: 'standard', structureImpact: 'local' } }),
    { required: false, satisfied: true, reason: null }
  );
  assert.deepEqual(
    evaluateFinalAlignment({ goal: {}, classification: { controlMode: 'controlled', structureImpact: 'local' } }),
    { required: true, satisfied: false, reason: 'alignment-required' }
  );
  assert.deepEqual(
    evaluateFinalAlignment({ goal: {}, classification: { controlMode: 'standard', structureImpact: 'structural' } }),
    { required: true, satisfied: false, reason: 'alignment-required' }
  );
  assert.deepEqual(
    evaluateFinalAlignment({ goal: { alignment: { mode: 'direct' } }, classification: { controlMode: 'controlled', structureImpact: 'local' } }),
    { required: true, satisfied: false, reason: 'alignment-risk-escalation' }
  );
  for (const mode of ['confirmed', 'delegated']) {
    assert.deepEqual(
      evaluateFinalAlignment({ goal: { alignment: { mode } }, classification: { controlMode: 'controlled', structureImpact: 'structural' } }),
      { required: true, satisfied: true, reason: null }
    );
  }
  assert.deepEqual(
    evaluateFinalAlignment({ goal: {}, classification: { controlMode: 'quick', structureImpact: 'none' } }),
    { required: false, satisfied: true, reason: null }
  );
});

test('confirmed/delegated 必须记录 decisionNote，delegated 必须列明委托事项', () => {
  const confirmed = { ...DIRECT_ALIGNMENT, alignment: { mode: 'confirmed', reasonCodes: [], decisionNote: null, delegatedTopics: [] } };
  assert.throws(() => validateAlignmentForPreparation({ alignment: confirmed, classification: { controlMode: 'standard', structureImpact: 'local' } }), /decisionNote/u);
  const delegated = { ...DIRECT_ALIGNMENT, alignment: { mode: 'delegated', reasonCodes: [], decisionNote: '用户委托', delegatedTopics: [] } };
  assert.throws(() => validateAlignmentForPreparation({ alignment: delegated, classification: { controlMode: 'standard', structureImpact: 'local' } }), /delegatedTopics/u);
});

test('基线指纹稳定且随 Scope 或语义变化', () => {
  const scope = { base: 'git-root', path: '.' };
  const goal = buildAlignedGoal(normalizeAlignment(DIRECT_ALIGNMENT), [], scope);
  const acceptance = [{ id: 'A1', description: '测试通过', requiredCovers: ['behavior'] }];
  const first = computeAlignmentFingerprint({ goal, acceptance, scope });
  const second = computeAlignmentFingerprint({ goal, acceptance, scope });
  assert.equal(first, second);
  assert.notEqual(first, computeAlignmentFingerprint({ goal, acceptance, scope: { ...scope, path: 'src' } }));
  const changed = buildAlignedGoal(normalizeAlignment({ ...DIRECT_ALIGNMENT, expectedOutcomes: ['另一结果'] }), acceptance, scope);
  assert.notEqual(first, computeAlignmentFingerprint({ goal: changed, acceptance, scope }));
});

test('对齐文件不是有效 JSON 时明确报错', (t) => {
  const file = path.join(tempDir(t), 'bad.json');
  fs.writeFileSync(file, '{');
  assert.throws(() => loadAlignmentFile(file), /不是有效 JSON/u);
});

test('Standard 带对齐文件准备时保存语义基线并转换保护行为', (t) => {
  const repo = gitRepo(t);
  const file = writeAlignment(t, DIRECT_ALIGNMENT);
  const prepared = prepareTask({ cwd: repo, stateRoot: tempDir(t), intent: DIRECT_ALIGNMENT.originalRequest, alignmentFile: file, scope: '.' });
  assert.equal(prepared.task.goal.originalRequest, DIRECT_ALIGNMENT.originalRequest);
  assert.equal(prepared.task.goal.alignment.mode, 'direct');
  assert.equal(prepared.task.goal.alignment.revision, 1);
  assert.ok(prepared.task.goal.alignment.baselineFingerprint);
  assert.equal('anchor' in prepared.task, false);
  const protectedItem = prepared.task.acceptance.find((item) => item.description === '刷新带 page 参数的 URL 仍加载指定页');
  assert.equal(protectedItem.source, 'protected-behavior');
  assert.equal(prepared.task.acceptance.find((item) => item.description === '新增组合测试通过').source, 'requested-outcome');
});

test('受控任务带 direct 对齐文件时准备失败', (t) => {
  const repo = gitRepo(t);
  const file = writeAlignment(t, { ...DIRECT_ALIGNMENT, originalRequest: '修改权限校验逻辑', goal: '修改权限校验逻辑' });
  assert.throws(() => prepareTask({ cwd: repo, stateRoot: tempDir(t), intent: '修改权限校验逻辑', alignmentFile: file, scope: '.' }), /Controlled\/Structural/u);
});

test('无对齐文件的 Standard 任务保持旧目标结构', (t) => {
  const repo = gitRepo(t);
  const prepared = prepareTask({ cwd: repo, stateRoot: tempDir(t), intent: '修复普通功能', acceptance: ['功能正确'], scope: '.' });
  assert.equal(prepared.task.goal.summary, '修复普通功能');
  assert.equal('alignment' in prepared.task.goal, false);
});

test('Quick 旧参数自动合成 direct 对齐', (t) => {
  const repo = gitRepo(t);
  const prepared = prepareTask({ cwd: repo, stateRoot: tempDir(t), intent: '更新 README 说明', acceptance: ['文档准确'], scope: '.' });
  assert.equal(prepared.task.goal.alignment.mode, 'direct');
  assert.equal(prepared.task.goal.originalRequest, '更新 README 说明');
  assert.deepEqual(prepared.task.goal.alignment.reasonCodes, ['quick-legacy']);
});

test('Quick 合成对齐不依赖完整 reasonCodes', () => {
  const alignment = synthesizeQuickAlignment({ intent: '更新 README 说明', acceptance: ['文档准确'] });
  assert.equal(alignment.alignment.mode, 'direct');
  assert.deepEqual(alignment.expectedOutcomes, ['文档准确']);
});

test('准备回执包含目标、对齐模式与基线指纹', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const file = writeAlignment(t, DIRECT_ALIGNMENT);
  const result = runNode(
    path.join(ROOT, '40-脚本', 'task.mjs'),
    ['准备', '--cwd', repo, '--state-root', stateRoot, '--intent', DIRECT_ALIGNMENT.originalRequest, '--alignment-file', file, '--scope', '.'],
    { cwd: ROOT },
  );
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.goal, DIRECT_ALIGNMENT.goal);
  assert.equal(receipt.alignment.mode, 'direct');
  assert.ok(receipt.alignment.baselineFingerprint);
  assert.deepEqual(receipt.expectedOutcomes, DIRECT_ALIGNMENT.expectedOutcomes);
});
