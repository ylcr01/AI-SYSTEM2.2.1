import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import test from 'node:test';import { planChecks,executeCheckPlan } from '../../40-脚本/lib/check-planner.mjs';import { tempDir } from '../helpers.mjs';
test('计划选择最低成本且能补充 Covers 的检查',()=>{const plan=planChecks({profile:'standard',requiredCovers:['behavior','typecheck'],checks:[{name:'all',command:'node',args:[],profiles:['standard'],covers:['behavior','typecheck'],sideEffect:'none',cacheable:true,estimatedCost:'high'},{name:'behavior',command:'node',args:[],profiles:['standard'],covers:['behavior'],sideEffect:'none',cacheable:true,estimatedCost:'low'},{name:'types',command:'node',args:[],profiles:['standard'],covers:['typecheck'],sideEffect:'none',cacheable:true,estimatedCost:'low'}]});assert.deepEqual(plan.checks.map(x=>x.name),['behavior','types']);assert.deepEqual(plan.missingCovers,[]);});
test('Acceptance 或 Plan 变化后不复用旧缓存',t=>{const dir=tempDir(t),cacheFile=path.join(dir,'cache.json');const check={name:'ok',command:process.execPath,args:['-e','process.exit(0)'],profiles:['standard'],covers:['behavior'],sideEffect:'none',cacheable:true,estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'all'};const plan=planChecks({profile:'standard',requiredCovers:['behavior'],checks:[check]});const common={cwd:dir,cacheFile,stateRoot:dir,budget:{mode:'standard',limitMs:10000,spentMs:0},taskId:'t',changeFingerprint:'c1',inputCycle:0};const first=executeCheckPlan(plan,{...common,acceptanceFingerprint:'a1'});assert.equal(first.results[0].reused,false);const second=executeCheckPlan(plan,{...common,acceptanceFingerprint:'a1'});assert.equal(second.results[0].reused,true);const third=executeCheckPlan(plan,{...common,acceptanceFingerprint:'a2'});assert.equal(third.results[0].reused,false);});
test('Artifact 消失后缓存失效',t=>{const dir=tempDir(t),cacheFile=path.join(dir,'cache.json'),artifact=path.join(dir,'out.txt');fs.writeFileSync(artifact,'x');const check={name:'artifact',command:process.execPath,args:['-e','process.exit(0)'],profiles:['standard'],covers:['behavior'],sideEffect:'none',cacheable:true,estimatedCost:'very-low',timeoutMs:5000,artifacts:['out.txt']};const plan=planChecks({profile:'standard',requiredCovers:['behavior'],checks:[check]});const input={cwd:dir,cacheFile,stateRoot:dir,budget:{mode:'standard',limitMs:10000,spentMs:0},taskId:'t',acceptanceFingerprint:'a1',changeFingerprint:'c1',inputCycle:0};executeCheckPlan(plan,input);fs.rmSync(artifact);const second=executeCheckPlan(plan,input);assert.equal(second.results[0].reused,false);});
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
