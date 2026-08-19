import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { classifyTask } from '../../40-脚本/lib/task-policy.mjs';
import {
  normalizePreservation,
  isStrictPreservation,
  preservationModeLevel,
  validateReferenceAttribution,
  buildReferenceInventory,
  referenceBehaviorAcceptanceItems,
  preservationCoverageSummary,
} from '../../40-脚本/lib/behavior-preservation.mjs';
import { gitRepo, tempDir } from '../helpers.mjs';

test('Preservation 分类：普通重构/迁移/重写/优化只产生轻量感知信号', () => {
  for (const intent of ['重构订单模块', '优化订单模块性能', '迁移订单模块到新框架', '重写结算逻辑']) {
    const result = classifyTask({ intent });
    assert.equal(result.preservationMode, 'preserve-unrequested');
    assert.deepEqual(result.preservationReasons, ['preservation-aware']);
  }
});

test('Preservation 分类：严格表达与参照语义', () => {
  assert.equal(classifyTask({ intent: '保持全部可观察行为不变，重构内部实现' }).preservationMode, 'preserve-all-observable');
  assert.equal(classifyTask({ intent: '行为完全不变，替换内部实现' }).preservationMode, 'preserve-all-observable');
  assert.equal(classifyTask({ intent: '完全参照旧订单模块实现，功能交互不能遗漏' }).preservationMode, 'reference-equivalent');
  assert.equal(classifyTask({ intent: '修复订单分页 Bug' }).preservationMode, 'preserve-unrequested');
  assert.equal(classifyTask({ intent: '新增 CSV 导出' }).preservationMode, 'preserve-unrequested');
});

test('Preservation 分类独立于 Control Mode', () => {
  const migrated = classifyTask({ intent: '迁移订单模块到新框架' });
  assert.equal(migrated.preservationMode, 'preserve-unrequested');
  assert.equal(migrated.controlMode, 'controlled');
  const bug = classifyTask({ intent: '修复订单分页 Bug' });
  assert.equal(bug.preservationMode, 'preserve-unrequested');
  assert.equal(bug.controlMode, 'standard');
});

test('normalizePreservation 校验 mode、category、id 唯一与 allowedDifference 引用', () => {
  assert.throws(() => normalizePreservation({ mode: 'unknown' }), /preservation\.mode 无效/u);
  assert.throws(() => normalizePreservation({ mode: 'preserve-all-observable', referenceRoots: [] }), /referenceRoots/u);
  assert.throws(() => normalizePreservation({ mode: 'preserve-all-observable', referenceRoots: ['src'], behaviors: [] }), /preservation-behaviors-required/u);
  assert.throws(() => normalizePreservation({ mode: 'reference-equivalent', referenceRoots: ['src'], behaviors: [] }), /preservation-behaviors-required/u);
  assert.throws(() => normalizePreservation({
    mode: 'preserve-all-observable',
    referenceRoots: ['src'],
    behaviors: [
      { id: 'R1', category: 'unknown', description: 'x', sourceFiles: ['src/a.js'] },
    ],
  }), /category 无效/u);
  assert.throws(() => normalizePreservation({
    mode: 'preserve-all-observable',
    referenceRoots: ['src'],
    behaviors: [
      { id: 'R1', category: 'business', description: 'x', sourceFiles: ['src/a.js'] },
      { id: 'R1', category: 'business', description: 'y', sourceFiles: ['src/b.js'] },
    ],
  }), /id 必须唯一/u);
  assert.throws(() => normalizePreservation({
    mode: 'preserve-all-observable',
    referenceRoots: ['src'],
    behaviors: [{ id: 'R1', category: 'business', description: 'x', sourceFiles: ['src/a.js'] }],
    allowedDifferences: [{ behaviorId: 'R9', description: '删除流程改一次确认' }],
  }), /不存在的 Behavior/u);
  const normalized = normalizePreservation({
    mode: 'reference-equivalent',
    constraints: ['已有业务功能不能遗漏'],
    referenceRoots: ['src'],
    behaviors: [{ id: 'R1', category: 'business', description: '创建订单', sourceFiles: ['src/a.js'] }],
    excludedFiles: [{ path: 'src/types.js', reason: '仅类型定义' }],
    allowedDifferences: [],
  });
  assert.equal(normalized.mode, 'reference-equivalent');
  assert.deepEqual(normalized.referenceRoots, ['src']);
  assert.equal(isStrictPreservation(normalized), true);
  assert.equal(isStrictPreservation({ mode: 'preserve-unrequested' }), false);
});

test('preserve-unrequested 不受空 behaviors 规则影响', () => {
  const normalized = normalizePreservation({ mode: 'preserve-unrequested', behaviors: [] });
  assert.equal(normalized.mode, 'preserve-unrequested');
  assert.deepEqual(normalized.behaviors, []);
  assert.deepEqual(preservationModeLevel('preserve-unrequested'), 0);
  assert.deepEqual(preservationModeLevel('preserve-all-observable'), 1);
  assert.deepEqual(preservationModeLevel('reference-equivalent'), 2);
});

test('validateReferenceAttribution 输出 unmapped 文件', () => {
  const behaviors = [{ id: 'R1', category: 'business', description: 'a', sourceFiles: ['src/a.js'] }];
  assert.deepEqual(validateReferenceAttribution({
    referenceFiles: ['src/a.js', 'src/b.js'],
    behaviors,
    excludedFiles: [],
  }), { ok: false, unmapped: ['src/b.js'], foreign: [] });
  assert.deepEqual(validateReferenceAttribution({
    referenceFiles: ['src/a.js', 'src/b.js'],
    behaviors,
    excludedFiles: [{ path: 'src/b.js', reason: '仅类型' }],
  }), { ok: true, unmapped: [], foreign: [] });
  assert.deepEqual(validateReferenceAttribution({
    referenceFiles: ['src/a.js', 'src/b.js'],
    behaviors: [{ id: 'R1', category: 'business', description: 'a', sourceFiles: ['src/ghost.js'] }],
    excludedFiles: [],
  }), { ok: false, unmapped: ['src/a.js', 'src/b.js'], foreign: ['src/ghost.js'] });
});

test('Reference 文件未归因拒绝，excludedFiles 后通过', (t) => {
  const repo = gitRepo(t);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'b\n');
  fs.writeFileSync(path.join(repo, 'src', 'types.js'), 't\n');
  for (const args of [['add', '.'], ['-c', 'user.email=t@e.c', '-c', 'user.name=T', 'commit', '-m', 'ref']]) {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const behaviors = [
    { id: 'R1', category: 'business', description: 'a', sourceFiles: ['src/a.js'] },
    { id: 'R2', category: 'business', description: 'b', sourceFiles: ['src/b.js'] },
  ];
  const partial = buildReferenceInventory({
    gitRoot: repo,
    baselineHead: 'head-1',
    referenceRoots: ['src'],
    behaviors,
    excludedFiles: [],
  });
  assert.deepEqual(partial.unmapped, ['src/types.js']);
  const complete = buildReferenceInventory({
    gitRoot: repo,
    baselineHead: 'head-1',
    referenceRoots: ['src'],
    behaviors,
    excludedFiles: [{ path: 'src/types.js', reason: '仅类型定义' }],
  });
  assert.deepEqual(complete.unmapped, []);
  assert.equal(complete.referenceCommit, 'head-1');
  assert.deepEqual(complete.referenceFiles, ['src/a.js', 'src/b.js', 'src/types.js']);
});

test('Reference Behavior 自动生成 Acceptance 项并保留归因字段', () => {
  const items = referenceBehaviorAcceptanceItems(normalizePreservation({
    mode: 'preserve-all-observable',
    referenceRoots: ['src'],
    behaviors: [
      { id: 'R1', category: 'business', description: '创建订单后进入 pending', sourceFiles: ['src/a.js'] },
      { id: 'R2', category: 'error', description: '删除流程二次确认', sourceFiles: ['src/b.js'] },
    ],
    allowedDifferences: [{ behaviorId: 'R2', description: '删除流程由二次确认改为一次确认' }],
  }));
  assert.equal(items.length, 2);
  assert.equal(items[0].description, '保持参考行为 R1：创建订单后进入 pending');
  assert.equal(items[0].source, 'reference-behavior');
  assert.equal(items[0].referenceBehaviorId, 'R1');
  assert.deepEqual(items[0].requiredCovers, ['behavior']);
  assert.equal(items[1].description, '按批准差异验证 R2：删除流程由二次确认改为一次确认');
});

test('Preservation Coverage 摘要由 Acceptance Coverage 派生', () => {
  const acceptance = [
    { id: 'A1', source: 'requested-outcome', referenceBehaviorId: null },
    { id: 'A2', source: 'reference-behavior', referenceBehaviorId: 'R1' },
    { id: 'A3', source: 'reference-behavior', referenceBehaviorId: 'R2' },
    { id: 'A4', source: 'reference-behavior', referenceBehaviorId: 'R3' },
  ];
  const coverage = {
    A2: { satisfied: true, covers: ['behavior'] },
    A3: { satisfied: false, covers: [] },
    A4: { satisfied: true, covers: ['behavior'] },
  };
  const summary = preservationCoverageSummary({ acceptance, acceptanceCoverage: coverage });
  assert.deepEqual(summary, {
    behaviorCount: 3,
    verifiedBehaviorCount: 2,
    missingBehaviorIds: ['R2'],
    complete: false,
  });
  assert.equal(preservationCoverageSummary({ acceptance: [acceptance[0]], acceptanceCoverage: {} }), null);
});
