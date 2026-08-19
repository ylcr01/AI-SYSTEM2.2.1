import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadTaskChecks, acceptanceIdsForCheck } from '../../40-脚本/lib/check-planner.mjs';
import { tempDir } from '../helpers.mjs';

function writeTaskChecks(t, checks) {
  const file = path.join(tempDir(t), 'task-checks.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, checks }));
  return file;
}

function context(t, extra = {}) {
  const root = tempDir(t);
  const testFile = path.join(root, 'tests', 'target.test.js');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, '// target\n');
  return {
    gitRoot: root,
    acceptance: [
      { id: 'A1', requiredCovers: ['behavior'] },
      { id: 'A2', requiredCovers: ['documentation'] },
    ],
    projectCheckNames: new Set(['project-behavior']),
    ...extra,
  };
}

const VALID_CHECK = {
  name: 'order-create-A1',
  command: 'node',
  args: ['--test', 'tests/target.test.js'],
  covers: ['behavior'],
  acceptanceIds: ['A1'],
  testFiles: ['tests/target.test.js'],
  sideEffect: 'none',
  estimatedCost: 'low',
  timeoutMs: 30000,
};

test('Task Check 规范化成 explicit 并保留 testFiles', (t) => {
  const ctx = context(t);
  const checks = loadTaskChecks(writeTaskChecks(t, [VALID_CHECK]), ctx);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].acceptanceMode, 'explicit');
  assert.deepEqual(checks[0].acceptanceIds, ['A1']);
  assert.deepEqual(checks[0].testFiles, ['tests/target.test.js']);
  assert.deepEqual(checks[0].profiles, ['quick', 'standard', 'controlled', 'release']);
});

test('Task Check 校验拒绝各类非法输入', (t) => {
  const ctx = context(t);
  const cases = [
    [{ ...VALID_CHECK, acceptanceIds: ['A9'] }, /未知 Acceptance/u],
    [{ ...VALID_CHECK, acceptanceIds: [] }, /非空 acceptanceIds/u],
    [{ ...VALID_CHECK, testFiles: [] }, /非空 testFiles/u],
    [{ ...VALID_CHECK, testFiles: ['../outside.test.js'] }, /越出 Git Root/u],
    [{ ...VALID_CHECK, testFiles: ['missing.test.js'] }, /不存在或不是文件/u],
    [{ ...VALID_CHECK, sideEffect: 'external' }, /禁止 external/u],
    [{ ...VALID_CHECK, acceptanceIds: ['A2'] }, /requiredCovers 无关/u],
    [{ ...VALID_CHECK, name: 'project-behavior' }, /名称冲突/u],
    [{ ...VALID_CHECK, covers: [] }, /缺少 covers/u],
    [{ ...VALID_CHECK, args: ['-e', 'process.exit(0)'] }, /task-check-testfile-not-executed/u],
  ];
  for (const [check, pattern] of cases) {
    assert.throws(() => loadTaskChecks(writeTaskChecks(t, [check]), ctx), pattern);
  }
});

test('testFiles 支持相对路径、./ 前缀与同文件绝对路径', (t) => {
  const ctx = context(t);
  const absolute = path.resolve(ctx.gitRoot, 'tests', 'target.test.js');
  for (const args of [
    ['--test', 'tests/target.test.js'],
    ['--test', './tests/target.test.js'],
    ['--test', absolute],
  ]) {
    const checks = loadTaskChecks(writeTaskChecks(t, [{ ...VALID_CHECK, args }]), ctx);
    assert.equal(checks.length, 1);
  }
});

test('acceptanceIdsForCheck 对 Reference Behavior 只允许显式绑定', () => {
  const acceptance = [
    { id: 'A1', source: 'requested-outcome', requiredCovers: ['behavior'] },
    { id: 'A2', source: 'reference-behavior', referenceBehaviorId: 'R1', requiredCovers: ['behavior'] },
  ];
  assert.deepEqual(
    acceptanceIdsForCheck({ acceptanceMode: 'matching-covers', covers: ['behavior'] }, acceptance),
    ['A1']
  );
  assert.deepEqual(
    acceptanceIdsForCheck({ acceptanceMode: 'all' }, acceptance),
    ['A1']
  );
  assert.deepEqual(
    acceptanceIdsForCheck({ acceptanceMode: 'explicit', acceptanceIds: ['A2'] }, acceptance),
    ['A2']
  );
  assert.deepEqual(
    acceptanceIdsForCheck({ acceptanceMode: 'none' }, acceptance),
    []
  );
});

test('同一 task-check-file 内重复名称被拒绝', (t) => {
  const ctx = context(t);
  const checks = [
    { ...VALID_CHECK, name: 'dup', acceptanceIds: ['A1'], covers: ['behavior'] },
    { ...VALID_CHECK, name: 'dup', acceptanceIds: ['A1'], covers: ['behavior'] },
  ];
  assert.throws(() => loadTaskChecks(writeTaskChecks(t, checks), ctx), /名称冲突/u);
});
