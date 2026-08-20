import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadTaskChecks, acceptanceIdsForCheck, createCheckManifest, checksFromManifest, planChecks } from '../../40-脚本/lib/check-planner.mjs';
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
  runner: 'node-test',
  covers: ['behavior'],
  acceptanceIds: ['A1'],
  testFiles: ['tests/target.test.js'],
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
  assert.equal(checks[0].command, 'node');
  assert.deepEqual(checks[0].args, ['--test', 'tests/target.test.js']);
});

test('Task Check 校验拒绝各类非法输入', (t) => {
  const ctx = context(t);
  const cases = [
    [{ ...VALID_CHECK, acceptanceIds: ['A9'] }, /未知 Acceptance/u],
    [{ ...VALID_CHECK, acceptanceIds: [] }, /非空 acceptanceIds/u],
    [{ ...VALID_CHECK, testFiles: [] }, /非空 testFiles/u],
    [{ ...VALID_CHECK, testFiles: ['../outside.test.js'] }, /越出 Git Root/u],
    [{ ...VALID_CHECK, testFiles: ['missing.test.js'] }, /不存在或不是文件/u],
    [{ ...VALID_CHECK, sideEffect: 'external' }, /禁止自定义/u],
    [{ ...VALID_CHECK, acceptanceIds: ['A2'] }, /requiredCovers 无关/u],
    [{ ...VALID_CHECK, name: 'project-behavior' }, /名称冲突/u],
    [{ ...VALID_CHECK, covers: [] }, /缺少 covers/u],
    [{ ...VALID_CHECK, command: 'node' }, /禁止自定义/u],
    [{ ...VALID_CHECK, args: ['-e', 'process.exit(0)'] }, /禁止自定义/u],
    [{ ...VALID_CHECK, runner: 'shell' }, /runner 不受支持/u],
    [{ ...VALID_CHECK, config: { shell: true } }, /未知字段/u],
  ];
  for (const [check, pattern] of cases) {
    assert.throws(() => loadTaskChecks(writeTaskChecks(t, [check]), ctx), pattern);
  }
});

test('testFiles 支持相对路径、./ 前缀与同文件绝对路径', (t) => {
  const ctx = context(t);
  const absolute = path.resolve(ctx.gitRoot, 'tests', 'target.test.js');
  for (const testFiles of [['tests/target.test.js'], ['./tests/target.test.js'], [absolute]]) {
    const checks = loadTaskChecks(writeTaskChecks(t, [{ ...VALID_CHECK, testFiles }]), ctx);
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
    []
  );
  assert.deepEqual(
    acceptanceIdsForCheck({ acceptanceMode: 'all' }, acceptance),
    []
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

test('宽泛 matching-covers 命中多条验收时不自动绑定任何一条', () => {
  const acceptance = [
    { id: 'A1', source: 'requested-outcome', requiredCovers: ['behavior'] },
    { id: 'A2', source: 'requested-outcome', requiredCovers: ['behavior'] },
  ];
  assert.deepEqual(
    acceptanceIdsForCheck({ acceptanceMode: 'matching-covers', covers: ['behavior'] }, acceptance),
    []
  );
});

test('宽泛 matching-covers 即使唯一命中也不自动绑定', () => {
  const acceptance = [
    { id: 'A1', source: 'requested-outcome', requiredCovers: ['behavior'] },
    { id: 'A2', source: 'requested-outcome', requiredCovers: ['documentation'] },
  ];
  assert.deepEqual(
    acceptanceIdsForCheck({ acceptanceMode: 'matching-covers', covers: ['behavior'] }, acceptance),
    []
  );
});

test('显式绑定的针对性检查仍可证明多条验收', () => {
  const acceptance = [
    { id: 'A1', source: 'requested-outcome', requiredCovers: ['behavior'] },
    { id: 'A2', source: 'requested-outcome', requiredCovers: ['behavior'] },
  ];
  assert.deepEqual(
    acceptanceIdsForCheck({ acceptanceMode: 'explicit', acceptanceIds: ['A1', 'A2'], covers: ['behavior'] }, acceptance),
    ['A1', 'A2']
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

test('Check Manifest 固化 Runner 与测试文件哈希并可重放', (t) => {
  const ctx = context(t);
  const checks = loadTaskChecks(writeTaskChecks(t, [VALID_CHECK]), ctx);
  const plan = planChecks({
    profile: 'standard', requiredCovers: ['behavior'], acceptance: ctx.acceptance,
    acceptanceCoverage: {}, checks,
  });
  const manifest = createCheckManifest(plan, { gitRoot: ctx.gitRoot });
  const replay = checksFromManifest(manifest, { gitRoot: ctx.gitRoot });
  assert.deepEqual(replay[0].args, ['--test', 'tests/target.test.js']);
  fs.writeFileSync(path.join(ctx.gitRoot, 'tests', 'target.test.js'), '// changed\n');
  assert.throws(() => checksFromManifest(manifest, { gitRoot: ctx.gitRoot }), /测试输入已变化/u);
});
