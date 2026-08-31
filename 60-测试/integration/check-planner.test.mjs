import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import test from 'node:test';import { fileURLToPath } from 'node:url';import { loadChecks,loadTaskChecks,planChecks,executeCheckPlan,resolveCommand } from '../../40-脚本/lib/check-planner.mjs';import { tempDir } from '../helpers.mjs';
import { BROWSER_CHECK_LIMITS } from '../../40-脚本/lib/check-adapters.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('计划选择最低成本且能补充 Covers 的检查',()=>{const plan=planChecks({profile:'standard',requiredCovers:['behavior','typecheck'],checks:[{name:'all',command:'node',args:[],profiles:['standard'],covers:['behavior','typecheck'],sideEffect:'none',estimatedCost:'high'},{name:'behavior',command:'node',args:[],profiles:['standard'],covers:['behavior'],sideEffect:'none',estimatedCost:'low'},{name:'types',command:'node',args:[],profiles:['standard'],covers:['typecheck'],sideEffect:'none',estimatedCost:'low'}]});assert.deepEqual(plan.checks.map(x=>x.name),['behavior','types']);assert.deepEqual(plan.missingCovers,[]);});
test('自动计划禁止外部写入',()=>{assert.throws(()=>executeCheckPlan({profile:'controlled',checks:[{name:'deploy',command:'node',args:[],sideEffect:'external'}]},{cwd:process.cwd(),budget:{mode:'controlled',limitMs:1000,spentMs:0}}),/禁止执行外部写入/);});

test('同批相同执行身份只启动一次进程并复用结果',t=>{
  const root=tempDir(t),counter=path.join(root,'count.txt');
  const script="const fs=require('node:fs');const f=process.argv[1];const n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0;fs.writeFileSync(f,String(n+1));";
  const shared={command:process.execPath,args:['-e',script,counter],sideEffect:'workspace',timeoutMs:5000};
  const result=executeCheckPlan({profile:'standard',checks:[
    {name:'behavior',covers:['behavior'],...shared},
    {name:'typecheck',covers:['typecheck'],...shared},
  ]},{cwd:root,budget:{mode:'standard',limitMs:5000,spentMs:0}});
  assert.equal(result.ok,true,JSON.stringify(result,null,2));
  assert.equal(fs.readFileSync(counter,'utf8'),'1');
  assert.equal(result.executedCount,1);
  assert.equal(result.reusedCount,1);
  assert.equal(result.results[1].reused,true);
  assert.equal(result.results[1].reusedFrom,'behavior');
  assert.equal(result.results[0].executionFingerprint,result.results[1].executionFingerprint);
});

test('进程被剩余总预算截断时归类为预算耗尽',()=>{
  const result=executeCheckPlan({profile:'standard',checks:[{name:'slow',command:'node',args:['-e','setTimeout(()=>{},200)'],sideEffect:'none',timeoutMs:1000}]},{cwd:process.cwd(),budget:{mode:'standard',limitMs:20,spentMs:0}});
  assert.equal(result.status,'unavailable');
  assert.equal(result.stopReason,'budget');
});

test('检查自身超时仍归类为检查超时',()=>{
  const result=executeCheckPlan({profile:'standard',checks:[{name:'slow',command:'node',args:['-e','setTimeout(()=>{},200)'],sideEffect:'none',timeoutMs:20}]},{cwd:process.cwd(),budget:{mode:'standard',limitMs:1000,spentMs:0}});
  assert.equal(result.status,'unavailable');
  assert.equal(result.stopReason,'timeout');
});

test('Windows 包管理器命令通过对应 cmd 启动器执行', () => {
  const options = { platform: 'win32', comSpec: 'C:\\Windows\\System32\\cmd.exe' };
  for (const command of ['npm', 'npx', 'pnpm', 'pnpx']) {
    assert.deepEqual(resolveCommand(command, options), {
      command: options.comSpec,
      prefix: ['/d', '/s', '/c', `${command}.cmd`]
    });
  }
  assert.deepEqual(resolveCommand('custom.cmd', options), {
    command: options.comSpec,
    prefix: ['/d', '/s', '/c', 'custom.cmd']
  });
  assert.deepEqual(resolveCommand('custom.bat', options), {
    command: options.comSpec,
    prefix: ['/d', '/s', '/c', 'custom.bat']
  });
});

test('非 Windows 命令解析保持原命令与参数前缀', () => {
  assert.deepEqual(resolveCommand('pnpm', { platform: 'linux' }), {
    command: 'pnpm',
    prefix: []
  });
});

test('未配置项目不自动回退 package test，显式配置仍生效',t=>{const repo=tempDir(t);fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({scripts:{test:'node --test'}}));assert.deepEqual(loadChecks(repo),[]);fs.mkdirSync(path.join(repo,'.ai'),{recursive:true});fs.writeFileSync(path.join(repo,'.ai','checks.json'),JSON.stringify({schemaVersion:4,packageFallback:{mode:'selected',scripts:['test']},checks:[{name:'declared',command:'node',args:['-e','process.exit(0)'],profiles:['standard'],covers:['static'],sideEffect:'none'}]}));assert.deepEqual(loadChecks(repo).map(check=>check.name),['package-test','declared']);});

test('计划按 Acceptance ID 与 Cover 选择显式绑定检查', () => {
  const plan = planChecks({
    profile: 'standard',
    requiredCovers: ['behavior'],
    acceptance: [
      { id: 'A1', requiredCovers: ['behavior'] },
      { id: 'A2', requiredCovers: ['behavior'] }
    ],
    acceptanceCoverage: {},
    checks: [
      { name: 'a1', command: 'node', args: [], profiles: ['standard'], covers: ['behavior'], acceptanceMode: 'explicit', acceptanceIds: ['A1'], sideEffect: 'none', estimatedCost: 'low' },
      { name: 'a2', command: 'node', args: [], profiles: ['standard'], covers: ['behavior'], acceptanceMode: 'explicit', acceptanceIds: ['A2'], sideEffect: 'none', estimatedCost: 'low' }
    ]
  });
  assert.deepEqual(plan.checks.map((item) => item.name), ['a1', 'a2']);
  assert.deepEqual(plan.missingAcceptance, []);
  assert.deepEqual(plan.missingAcceptanceCovers, []);
});

test('宽泛检查不能闭合 Acceptance 时不执行并输出业务缺口', () => {
  const plan = planChecks({
    profile: 'standard',
    requiredCovers: ['behavior'],
    acceptance: [
      { id: 'A1', description: '退款恢复库存', requiredCovers: ['behavior'] },
      { id: 'A2', description: '部分退款数量正确', requiredCovers: ['behavior'] }
    ],
    acceptanceCoverage: {},
    checks: [{ name: 'broad', command: 'node', args: [], profiles: ['standard'], covers: ['behavior'], sideEffect: 'none', estimatedCost: 'low', acceptanceMode: 'matching-covers' }]
  });
  assert.deepEqual(plan.checks.map((item) => item.name), []);
  assert.deepEqual(plan.missingCovers, ['behavior']);
  assert.deepEqual(plan.missingAcceptance, ['A1', 'A2']);
  assert.deepEqual(plan.gaps, [
    { acceptanceId: 'A1', description: '退款恢复库存', missingCovers: ['behavior'] },
    { acceptanceId: 'A2', description: '部分退款数量正确', missingCovers: ['behavior'] }
  ]);
});

function casePlan(t, testName) {
  const file=path.join(tempDir(t),'task-check.json');
  fs.writeFileSync(file,JSON.stringify({schemaVersion:2,checks:[{
    name:`case-${testName}`,
    runner:'node-test',
    cases:[{
      id:'C1',acceptanceIds:['A1'],covers:['behavior'],
      testFile:'60-测试/fixtures/node-test-case-sample.test.mjs',testName,
    }],
    estimatedCost:'very-low',timeoutMs:5000,
  }]}));
  const acceptance=[{id:'A1',requiredCovers:['behavior']}];
  const checks=loadTaskChecks(file,{gitRoot:ROOT,acceptance,projectCheckNames:new Set()});
  return planChecks({profile:'standard',requiredCovers:['behavior'],acceptance,acceptanceCoverage:{},checks});
}

test('node-test 用例级 Runner 返回实际命中与通过结果',t=>{
  const execution=executeCheckPlan(casePlan(t,'目标用例通过'),{cwd:ROOT,budget:{mode:'standard',limitMs:5000,spentMs:0}});
  assert.equal(execution.ok,true,JSON.stringify(execution,null,2));
  assert.deepEqual(execution.results[0].caseSummary,{declared:1,passed:1,failed:0,malformedEvents:0});
  assert.equal(execution.results[0].caseResults[0].testName,'目标用例通过');
  assert.equal(execution.results[0].caseResults[0].matchedCount,1);
  assert.equal(execution.results[0].caseResults[0].passedCount,1);
  assert.equal(execution.results[0].caseResults[0].executed[0].status,'passed');
});

test('node-test 零命中、失败、skip 和 todo 均阻止检查通过',t=>{
  for(const testName of ['不存在的目标用例','目标用例失败','目标用例跳过','目标用例待办']){
    const execution=executeCheckPlan(casePlan(t,testName),{cwd:ROOT,budget:{mode:'standard',limitMs:5000,spentMs:0}});
    assert.equal(execution.ok,false,testName);
    assert.equal(execution.stopReason,'failed',testName);
    assert.equal(execution.results[0].caseResults[0].status,'failed',testName);
  }
});

function browserCheck(index) {
  const declared = {
    id: `browser-${index}`,
    acceptanceIds: ['A1'],
    covers: ['browser'],
    testFile: `browser-${index}.test.mjs`,
    testName: `Browser flow ${index}`,
    expectedMatches: 1,
  };
  return {
    name: `browser-flow-${index}`,
    runner: 'node-test',
    adapterVersion: 2,
    resultProtocol: 'node-test-cases-v1',
    command: 'node',
    args: ['--test', String(index)],
    sideEffect: 'workspace',
    timeoutMs: BROWSER_CHECK_LIMITS.flowTimeoutMs,
    covers: ['browser'],
    acceptanceMode: 'explicit',
    acceptanceIds: ['A1'],
    cases: [declared],
    testFiles: [declared.testFile],
  };
}

function browserEvent(index, event = 'passed') {
  return `AI_RD_NODE_TEST_CASE ${JSON.stringify({
    schemaVersion: 1,
    event,
    name: `Browser flow ${index}`,
    file: `browser-${index}.test.mjs`,
    entryFile: `browser-${index}.test.mjs`,
    skipped: false,
    todo: false,
  })}\n`;
}

test('Browser 批次返回真实摘要并明确同步 runner 未实现 30 秒心跳', () => {
  let now = 0;
  let calls = 0;
  const checks = [browserCheck(1), browserCheck(2)];
  const result = executeCheckPlan({ profile: 'controlled', checks }, {
    cwd: process.cwd(),
    budget: { mode: 'controlled', limitMs: 300_000, spentMs: 0 },
    clock: { now: () => now },
    spawnSync: () => {
      calls += 1;
      now += 100;
      return { status: 0, stdout: browserEvent(calls), stderr: '', error: undefined };
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(calls, 2);
  assert.deepEqual(result.browserSummary, {
    declared: 2,
    completed: 2,
    passed: 2,
    failed: 0,
    timedOut: 0,
    blocked: 0,
    circuitBroken: false,
    stopReason: null,
    limits: BROWSER_CHECK_LIMITS,
    unimplemented: [{
      id: 'browser-progress-heartbeat-30s',
      implemented: false,
      reason: '同步 spawnSync runner 无法在子进程运行期间读取增量输出并真实执行 30 秒心跳或无输出终止',
    }],
  });
});

test('Browser 首败熔断并把未执行 flow 计为 blocked', () => {
  let now = 0;
  let calls = 0;
  const checks = [browserCheck(1), browserCheck(2), browserCheck(3)];
  const result = executeCheckPlan({ profile: 'controlled', checks }, {
    cwd: process.cwd(),
    budget: { mode: 'controlled', limitMs: 300_000, spentMs: 0 },
    clock: { now: () => now },
    spawnSync: () => {
      calls += 1;
      now += 100;
      const failed = calls === 2;
      return { status: failed ? 1 : 0, stdout: browserEvent(calls, failed ? 'failed' : 'passed'), stderr: '', error: undefined };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.stopReason, 'failed');
  assert.equal(calls, 2);
  assert.equal(result.browserSummary.completed, 2);
  assert.equal(result.browserSummary.failed, 1);
  assert.equal(result.browserSummary.blocked, 1);
  assert.equal(result.browserSummary.circuitBroken, true);
});

test('Browser 注入时钟固定 flow、batch 与 outer 硬限制', () => {
  {
    let now = 0;
    const result = executeCheckPlan({ profile: 'controlled', checks: [browserCheck(1)] }, {
      cwd: process.cwd(),
      budget: { mode: 'controlled', limitMs: 300_000, spentMs: 0 },
      clock: { now: () => now },
      spawnSync: () => {
        now += BROWSER_CHECK_LIMITS.flowTimeoutMs + 1;
        return { status: 0, stdout: browserEvent(1), stderr: '', error: undefined };
      },
    });
    assert.equal(result.stopReason, 'browser-flow-timeout');
    assert.equal(result.browserSummary.timedOut, 1);
  }

  {
    let now = 0;
    let calls = 0;
    const result = executeCheckPlan({ profile: 'controlled', checks: [browserCheck(1), browserCheck(2)] }, {
      cwd: process.cwd(),
      budget: { mode: 'controlled', limitMs: 300_000, spentMs: 0 },
      clock: { now: () => now },
      spawnSync: () => {
        calls += 1;
        now += 100;
        return { status: 0, stdout: browserEvent(calls), stderr: '', error: undefined };
      },
      onBrowserProgress: () => { now = BROWSER_CHECK_LIMITS.batchTimeoutMs; },
    });
    assert.equal(result.stopReason, 'browser-batch-timeout');
    assert.equal(result.browserSummary.blocked, 1);
    assert.equal(calls, 1);
  }

  {
    let now = 0;
    let calls = 0;
    const nonBrowser = {
      name: 'setup', command: 'node', args: [], covers: ['static'], sideEffect: 'none', timeoutMs: 600_000,
    };
    const result = executeCheckPlan({ profile: 'controlled', checks: [nonBrowser, browserCheck(1)] }, {
      cwd: process.cwd(),
      budget: { mode: 'controlled', limitMs: 300_000, spentMs: 0 },
      clock: { now: () => now },
      spawnSync: () => {
        calls += 1;
        now += BROWSER_CHECK_LIMITS.outerTimeoutMs;
        return { status: 0, stdout: '', stderr: '', error: undefined };
      },
    });
    assert.equal(result.stopReason, 'browser-outer-timeout');
    assert.equal(result.browserSummary.blocked, 1);
    assert.equal(calls, 1);
  }
});
