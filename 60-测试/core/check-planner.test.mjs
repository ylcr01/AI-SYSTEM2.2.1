import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadChecks, loadTaskChecks, acceptanceIdsForCheck, createCheckManifest, checksFromManifest, planChecks } from '../../40-脚本/lib/check-planner.mjs';
import { evaluateAdapterResult } from '../../40-脚本/lib/check-adapters.mjs';
import { tempDir } from '../helpers.mjs';

function writeTaskChecks(t, checks, schemaVersion = 2) {
  const file = path.join(tempDir(t), 'task-checks.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion, checks }));
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
  cases: [{
    id: 'order-create-success',
    acceptanceIds: ['A1'],
    covers: ['behavior'],
    testFile: 'tests/target.test.js',
    testName: '创建订单成功',
  }],
  estimatedCost: 'low',
  timeoutMs: 30000,
};

function withCase(overrides) {
  return { ...VALID_CHECK, cases: [{ ...VALID_CHECK.cases[0], ...overrides }] };
}

test('Task Check 规范化成 explicit 并保留 testFiles', (t) => {
  const ctx = context(t);
  const checks = loadTaskChecks(writeTaskChecks(t, [VALID_CHECK]), ctx);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].acceptanceMode, 'explicit');
  assert.deepEqual(checks[0].acceptanceIds, ['A1']);
  assert.deepEqual(checks[0].covers, ['behavior']);
  assert.deepEqual(checks[0].testFiles, ['tests/target.test.js']);
  assert.deepEqual(checks[0].cases, [{ ...VALID_CHECK.cases[0], expectedMatches: 1 }]);
  assert.deepEqual(checks[0].profiles, ['quick', 'standard', 'controlled', 'release']);
  assert.equal(checks[0].command, 'node');
  assert.equal(checks[0].adapterVersion, 2);
  assert.equal(checks[0].resultProtocol, 'node-test-cases-v1');
  assert.deepEqual(checks[0].args.slice(0, 2), ['--test', '--test-reporter']);
  assert.ok(checks[0].args[2].endsWith('/node-test-case-reporter.mjs'));
  assert.deepEqual(checks[0].args.slice(3), ['--test-name-pattern', '^(?:创建订单成功)$', 'tests/target.test.js']);
});

test('Task Check 校验拒绝各类非法输入', (t) => {
  const ctx = context(t);
  const cases = [
    [withCase({ acceptanceIds: ['A9'] }), /未知 Acceptance/u],
    [withCase({ acceptanceIds: [] }), /非空 acceptanceIds/u],
    [withCase({ acceptanceIds: 'A1' }), /acceptanceIds 必须是数组/u],
    [{ ...VALID_CHECK, cases: [] }, /非空 cases/u],
    [withCase({ testFile: '../outside.test.js' }), /越出 Git Root/u],
    [withCase({ testFile: 'missing.test.js' }), /不存在或不是文件/u],
    [{ ...VALID_CHECK, sideEffect: 'external' }, /禁止自定义/u],
    [withCase({ acceptanceIds: ['A2'] }), /requiredCovers 无关/u],
    [{ ...VALID_CHECK, name: 'project-behavior' }, /名称冲突/u],
    [withCase({ covers: [] }), /缺少 covers/u],
    [withCase({ covers: 'behavior' }), /covers 必须是数组/u],
    [withCase({ testName: '' }), /缺少 testName/u],
    [withCase({ expectedMatches: 0 }), /正安全整数/u],
    [withCase({ expectedMatches: '1' }), /正安全整数/u],
    [{ ...VALID_CHECK, command: 'node' }, /禁止自定义/u],
    [{ ...VALID_CHECK, args: ['-e', 'process.exit(0)'] }, /禁止自定义/u],
    [{ ...VALID_CHECK, runner: 'shell' }, /runner 不受支持/u],
    [{ ...VALID_CHECK, config: { shell: true } }, /不接受 config/u],
    [{ ...VALID_CHECK, acceptanceIds: ['A1'] }, /必须在 cases 中声明 acceptanceIds/u],
  ];
  for (const [check, pattern] of cases) {
    assert.throws(() => loadTaskChecks(writeTaskChecks(t, [check]), ctx), pattern);
  }
});

test('testFiles 支持相对路径、./ 前缀与同文件绝对路径', (t) => {
  const ctx = context(t);
  const absolute = path.resolve(ctx.gitRoot, 'tests', 'target.test.js');
  for (const testFile of ['tests/target.test.js', './tests/target.test.js', absolute]) {
    const checks = loadTaskChecks(writeTaskChecks(t, [withCase({ testFile })]), ctx);
    assert.equal(checks.length, 1);
    assert.deepEqual(checks[0].testFiles, ['tests/target.test.js']);
  }
});

test('新建 Task Check 拒绝旧 Schema 1', (t) => {
  assert.throws(() => loadTaskChecks(writeTaskChecks(t, [VALID_CHECK], 1), context(t)), /必须使用 Schema 2/u);
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
    { ...VALID_CHECK, name: 'dup' },
    { ...VALID_CHECK, name: 'dup' },
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
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.checks[0].resultProtocol, 'node-test-cases-v1');
  assert.deepEqual(manifest.checks[0].cases, [{ ...VALID_CHECK.cases[0], expectedMatches: 1 }]);
  const replay = checksFromManifest(manifest, { gitRoot: ctx.gitRoot });
  assert.equal(replay[0].adapterVersion, 2);
  assert.equal(replay[0].resultProtocol, 'node-test-cases-v1');
  fs.writeFileSync(path.join(ctx.gitRoot, 'tests', 'target.test.js'), '// target\r\n');
  assert.doesNotThrow(() => checksFromManifest(manifest, { gitRoot: ctx.gitRoot }));
  fs.writeFileSync(path.join(ctx.gitRoot, 'tests', 'target.test.js'), '// changed\n');
  assert.throws(() => checksFromManifest(manifest, { gitRoot: ctx.gitRoot }), /测试输入已变化/u);
});

test('旧 Check Manifest 的显式 Acceptance 绑定拒绝继续重放', (t) => {
  const ctx = context(t);
  const checks = loadTaskChecks(writeTaskChecks(t, [VALID_CHECK]), ctx);
  const current = createCheckManifest(planChecks({
    profile: 'standard', requiredCovers: ['behavior'], acceptance: ctx.acceptance,
    acceptanceCoverage: {}, checks,
  }), { gitRoot: ctx.gitRoot });
  const stored = current.checks[0];
  const legacy = {
    ...current,
    schemaVersion: 1,
    checks: [{
      ...stored,
      adapterVersion: 1,
      resultProtocol: undefined,
      cases: undefined,
      config: { testNamePattern: '创建订单成功' },
    }],
  };
  assert.throws(
    () => checksFromManifest(legacy, { gitRoot: ctx.gitRoot }),
    /不能继续作为 Acceptance 证明/u,
  );
});

test('用例级规划不把不同 case 的 Acceptance 和 Cover 做笛卡尔积', (t) => {
  const ctx = context(t, {
    acceptance: [
      { id: 'A1', requiredCovers: ['behavior', 'negative-path'] },
      { id: 'A2', requiredCovers: ['negative-path'] },
    ],
  });
  const checks = loadTaskChecks(writeTaskChecks(t, [{
    ...VALID_CHECK,
    cases: [
      { ...VALID_CHECK.cases[0], id: 'a1-behavior', acceptanceIds: ['A1'], covers: ['behavior'] },
      { ...VALID_CHECK.cases[0], id: 'a2-negative', acceptanceIds: ['A2'], covers: ['negative-path'] },
    ],
  }]), ctx);
  const plan = planChecks({
    profile: 'standard',
    requiredCovers: ['behavior', 'negative-path'],
    acceptance: ctx.acceptance,
    acceptanceCoverage: {},
    checks,
  });
  assert.deepEqual(plan.missingAcceptanceCovers, [
    { acceptanceId: 'A1', cover: 'negative-path' },
  ]);
  assert.deepEqual(plan.missingAcceptance, ['A1']);
});

test('Acceptance 证明优先于低成本通用检查并消除同 Cover 重复', () => {
  const acceptance = [{ id: 'A1', requiredCovers: ['behavior'] }];
  const plan = planChecks({
    profile: 'standard',
    requiredCovers: ['behavior', 'typecheck'],
    acceptance,
    acceptanceCoverage: {},
    checks: [
      {
        name: 'broad-behavior', command: 'node', args: [], profiles: ['standard'],
        covers: ['behavior'], sideEffect: 'none', estimatedCost: 'very-low', acceptanceMode: 'none',
      },
      {
        name: 'target-proof', command: 'node', args: [], profiles: ['standard'],
        covers: ['behavior'], sideEffect: 'none', estimatedCost: 'high', acceptanceMode: 'explicit',
        acceptanceIds: ['A1'], cases: [{ acceptanceIds: ['A1'], covers: ['behavior'] }],
      },
      {
        name: 'typecheck', command: 'node', args: [], profiles: ['standard'],
        covers: ['typecheck'], sideEffect: 'none', estimatedCost: 'low', acceptanceMode: 'none',
      },
    ],
  });
  assert.deepEqual(plan.checks.map((item) => item.name), ['target-proof', 'typecheck']);
  assert.deepEqual(plan.missingAcceptanceCovers, []);
  assert.deepEqual(plan.missingCovers, []);
});

test('证明优先沿用现有 Check Manifest Schema 且不引入检查类型', (t) => {
  const ctx = context(t);
  const checks = loadTaskChecks(writeTaskChecks(t, [VALID_CHECK]), ctx);
  const plan = planChecks({
    profile: 'standard', requiredCovers: ['behavior'], acceptance: ctx.acceptance,
    acceptanceCoverage: {}, checks,
  });
  const manifest = createCheckManifest(plan, { gitRoot: ctx.gitRoot });
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.checks.length, 1);
  assert.equal('purpose' in manifest.checks[0], false);
  assert.deepEqual(plan.checks.map((item) => item.name), [VALID_CHECK.name]);
});

test('Acceptance 映射不完整时不规划通用检查', () => {
  const acceptance = [
    { id: 'A1', requiredCovers: ['behavior'] },
    { id: 'A2', requiredCovers: ['behavior'] },
  ];
  const plan = planChecks({
    profile: 'standard',
    requiredCovers: ['behavior', 'typecheck'],
    acceptance,
    acceptanceCoverage: {},
    checks: [
      {
        name: 'a1-proof', command: 'node', args: [], profiles: ['standard'],
        covers: ['behavior'], sideEffect: 'none', estimatedCost: 'low', acceptanceMode: 'explicit',
        acceptanceIds: ['A1'], cases: [{ acceptanceIds: ['A1'], covers: ['behavior'] }],
      },
      {
        name: 'broad-behavior', command: 'node', args: [], profiles: ['standard'],
        covers: ['behavior'], sideEffect: 'none', estimatedCost: 'very-low', acceptanceMode: 'none',
      },
      {
        name: 'typecheck', command: 'node', args: [], profiles: ['standard'],
        covers: ['typecheck'], sideEffect: 'none', estimatedCost: 'very-low', acceptanceMode: 'none',
      },
    ],
  });
  assert.deepEqual(plan.checks.map((item) => item.name), ['a1-proof']);
  assert.deepEqual(plan.missingAcceptanceCovers, [{ acceptanceId: 'A2', cover: 'behavior' }]);
  assert.deepEqual(plan.missingCovers, ['typecheck']);
});

test('node-test 用例事件无法解析时失败关闭', () => {
  const result = evaluateAdapterResult({
    runner: 'node-test',
    resultProtocol: 'node-test-cases-v1',
    cases: [{ ...VALID_CHECK.cases[0], expectedMatches: 1 }],
  }, {
    cwd: process.cwd(),
    stdout: 'AI_RD_NODE_TEST_CASE {not-json}\n',
  });
  assert.match(result.error, /无法解析/u);
  assert.equal(result.caseSummary.malformedEvents, 1);
  assert.equal(result.caseResults[0].status, 'failed');
});

test('项目通用检查不得绑定任务 Acceptance', (t) => {
  const root = tempDir(t);
  fs.mkdirSync(path.join(root, '.ai'), { recursive: true });
  const base = {
    name: 'project-behavior',
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    profiles: ['standard'],
    covers: ['behavior'],
    sideEffect: 'none',
  };
  fs.writeFileSync(path.join(root, '.ai', 'checks.json'), JSON.stringify({
    schemaVersion: 4,
    checks: [{ ...base, acceptanceMode: 'explicit', acceptanceIds: ['A1'] }],
  }));
  assert.throws(() => loadChecks(root), /通用检查，不能绑定任务 Acceptance/u);

  fs.writeFileSync(path.join(root, '.ai', 'checks.json'), JSON.stringify({
    schemaVersion: 4,
    checks: [{ ...base, acceptanceMode: 'matching-covers' }],
  }));
  const [check] = loadChecks(root);
  assert.equal(check.acceptanceMode, 'none');
  assert.deepEqual(check.acceptanceIds, []);
});
