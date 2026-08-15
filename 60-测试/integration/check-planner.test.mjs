import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import test from 'node:test';import { loadChecks,planChecks,executeCheckPlan,resolveCommand } from '../../40-脚本/lib/check-planner.mjs';import { tempDir } from '../helpers.mjs';
test('计划选择最低成本且能补充 Covers 的检查',()=>{const plan=planChecks({profile:'standard',requiredCovers:['behavior','typecheck'],checks:[{name:'all',command:'node',args:[],profiles:['standard'],covers:['behavior','typecheck'],sideEffect:'none',estimatedCost:'high'},{name:'behavior',command:'node',args:[],profiles:['standard'],covers:['behavior'],sideEffect:'none',estimatedCost:'low'},{name:'types',command:'node',args:[],profiles:['standard'],covers:['typecheck'],sideEffect:'none',estimatedCost:'low'}]});assert.deepEqual(plan.checks.map(x=>x.name),['behavior','types']);assert.deepEqual(plan.missingCovers,[]);});
test('自动计划禁止外部写入',()=>{assert.throws(()=>executeCheckPlan({profile:'controlled',checks:[{name:'deploy',command:'node',args:[],sideEffect:'external'}]},{cwd:process.cwd(),budget:{mode:'controlled',limitMs:1000,spentMs:0}}),/禁止执行外部写入/);});

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
      { name: 'a1', command: 'node', args: [], profiles: ['standard'], covers: ['behavior'], acceptanceIds: ['A1'], sideEffect: 'none', estimatedCost: 'low' },
      { name: 'a2', command: 'node', args: [], profiles: ['standard'], covers: ['behavior'], acceptanceIds: ['A2'], sideEffect: 'none', estimatedCost: 'low' }
    ]
  });
  assert.deepEqual(plan.checks.map((item) => item.name), ['a1', 'a2']);
  assert.deepEqual(plan.missingAcceptance, []);
  assert.deepEqual(plan.missingAcceptanceCovers, []);
});
