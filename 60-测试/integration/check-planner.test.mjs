import assert from 'node:assert/strict';import test from 'node:test';import { planChecks,executeCheckPlan } from '../../40-脚本/lib/check-planner.mjs';
test('计划选择最低成本且能补充 Covers 的检查',()=>{const plan=planChecks({profile:'standard',requiredCovers:['behavior','typecheck'],checks:[{name:'all',command:'node',args:[],profiles:['standard'],covers:['behavior','typecheck'],sideEffect:'none',estimatedCost:'high'},{name:'behavior',command:'node',args:[],profiles:['standard'],covers:['behavior'],sideEffect:'none',estimatedCost:'low'},{name:'types',command:'node',args:[],profiles:['standard'],covers:['typecheck'],sideEffect:'none',estimatedCost:'low'}]});assert.deepEqual(plan.checks.map(x=>x.name),['behavior','types']);assert.deepEqual(plan.missingCovers,[]);});
test('自动计划禁止外部写入',()=>{assert.throws(()=>executeCheckPlan({profile:'controlled',checks:[{name:'deploy',command:'node',args:[],sideEffect:'external'}]},{cwd:process.cwd(),budget:{mode:'controlled',limitMs:1000,spentMs:0}}),/禁止执行外部写入/);});

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
