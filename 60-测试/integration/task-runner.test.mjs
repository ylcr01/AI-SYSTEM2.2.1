import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import { spawnSync } from 'node:child_process';import test from 'node:test';import { prepareTask,deliverTask,acceptTask,saveTask,resumeTask,continueVerification,confirmIntegration,revalidateIntegration } from '../../40-脚本/lib/task-runner.mjs';import { computeChangeSet } from '../../40-脚本/lib/git-state.mjs';import { updateTask } from '../../40-脚本/lib/state-manager.mjs';import { createReviewRecord } from '../../40-脚本/lib/review.mjs';import { createEvidence } from '../../40-脚本/lib/evidence.mjs';import { gitRepo,tempDir } from '../helpers.mjs';
test('Standard 任务完成自动验证、交付和用户验收',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(delivered.task.status,'waiting_acceptance');assert.ok(delivered.task.evidence.some(x=>x.covers.includes('behavior')));const accepted=acceptTask({stateRoot,taskId:prepared.task.taskId,decision:'通过'});assert.equal(accepted.task.status,'accepted');});
test('自动检查生成的 Evidence 自动进入 systemEvidenceHashes',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(delivered.task.status,'waiting_acceptance');const behaviorEvidence=delivered.task.evidence.find(x=>x.covers.includes('behavior'));assert.ok(behaviorEvidence);assert.ok(delivered.task.verification.systemEvidenceHashes.includes(behaviorEvidence.payloadHash));assert.ok(delivered.task.evidence.filter(x=>x.covers.includes('scope')).every(x=>delivered.task.verification.systemEvidenceHashes.includes(x.payloadHash)));});
test('纯文档任务自动进入 Quick 并由文档检查绑定 Acceptance',t=>{const repo=gitRepo(t,{checks:[{name:'docs',command:process.execPath,args:['-e','process.exit(0)'],profiles:['quick','standard'],covers:['documentation'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'matching-covers'}]}),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'更新入口规则',acceptance:['规则满足验收条件'],scope:'.'});fs.writeFileSync(path.join(repo,'README.md'),'# updated\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(delivered.task.status,'waiting_acceptance');assert.equal(delivered.task.classification.controlMode,'quick');assert.deepEqual(delivered.task.acceptance[0].requiredCovers,['documentation']);assert.equal(delivered.task.verification.requiredCovers.includes('behavior'),false);assert.ok(delivered.task.evidence.some(x=>x.covers.includes('documentation')&&x.acceptanceIds.includes('A1')));});
test('没有语义 Evidence 时不能进入等待验收',t=>{const repo=gitRepo(t,{checks:[]}),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,autoChecks:false});assert.equal(delivered.task.status,'verifying');});
test('显式 Independent Review 必须 passed 且无 Blocking Finding',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.',explicitReviewRequirement:{kind:'independent-agent',minimumDecision:'passed'}});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const first=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(first.task.status,'reviewing');const pack=first.task.reviewPackage;const review=createReviewRecord({kind:'independent-agent',taskId:first.task.taskId,changeFingerprint:first.task.changeSet.fingerprint,packageFingerprint:pack.packageFingerprint,implementer:{actor:'a',session:'s1'},reviewer:{actor:'b',session:'s2',provenance:{provider:'test'}},decision:'passed',createdAt:new Date(Date.parse(pack.createdAt)+1000).toISOString()});const file=path.join(stateRoot,'review.json');fs.writeFileSync(file,JSON.stringify(review));const second=deliverTask({stateRoot,taskId:first.task.taskId,reviewFile:file});assert.equal(second.task.status,'waiting_acceptance');});
test('Handoff-required 交付生成新鲜 Handoff，保存后可恢复',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.',handoffRequired:true});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(delivered.task.status,'waiting_acceptance');assert.ok(delivered.task.handoff);const root2=tempDir(t);const p2=prepareTask({cwd:repo,stateRoot:root2,intent:'修复另一个普通功能',acceptance:['功能正确'],scope:'.'});const saved=saveTask({stateRoot:root2,taskId:p2.task.taskId});assert.equal(saved.task.status,'saved');const resumed=resumeTask({stateRoot:root2,taskId:p2.task.taskId});assert.ok(['implementing','verifying'].includes(resumed.task.status));});
test('瞬态 Handoff 和隔离 Blocker 在事实恢复后自动清理',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t),target=path.join(repo,'target.txt');
  const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});
  saveTask({stateRoot,taskId:prepared.task.taskId});
  fs.writeFileSync(target,'task change\n');
  const resumed=resumeTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(resumed.task.status,'verifying');
  assert.deepEqual(resumed.task.blockers,[]);
  assert.equal(resumed.task.verification.stopReason,'handoff-stale');
  assert.equal(deliverTask({stateRoot,taskId:prepared.task.taskId}).task.status,'waiting_acceptance');

  const secondRoot=tempDir(t),second=prepareTask({cwd:repo,stateRoot:secondRoot,intent:'修复另一个功能',acceptance:['功能正确'],scope:'.'});
  fs.writeFileSync(target,'overwritten user change\n');
  const blocked=deliverTask({stateRoot:secondRoot,taskId:second.task.taskId});
  assert.equal(blocked.task.status,'blocked');
  fs.writeFileSync(target,'task change\n');
  const secondResumed=resumeTask({stateRoot:secondRoot,taskId:second.task.taskId});
  assert.deepEqual(secondResumed.task.blockers,[]);
  assert.notEqual(deliverTask({stateRoot:secondRoot,taskId:second.task.taskId}).task.status,'blocked');
});

test('预算耗尽的 Task 只能按原因有界续期',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t);
  const prepared=prepareTask({cwd:repo,stateRoot,intent:'验证普通功能',acceptance:['功能正确'],scope:'.',budgetMs:100});
  updateTask({
    stateRoot,
    taskId:prepared.task.taskId,
    expectedRevision:prepared.task.stateRevision,
    transitionTo:'saved',
    event:'delivery',
    mutate(next){next.verification.budget.spentMs=100;next.verification.stopReason='budget';return next;}
  });
  assert.throws(()=>resumeTask({stateRoot,taskId:prepared.task.taskId}),/必须使用“继续验证”/u);
  assert.throws(()=>continueVerification({stateRoot,taskId:prepared.task.taskId,additionalBudgetMs:50,reason:''}),/必须说明原因/u);
  const continued=continueVerification({stateRoot,taskId:prepared.task.taskId,additionalBudgetMs:50,reason:'用户批准继续'});
  assert.equal(continued.task.status,'verifying');
  assert.equal(continued.task.verification.budget.limitMs,150);
  assert.equal(continued.task.verification.budget.spentMs,100);
  assert.equal(continued.task.verification.budget.extensions.length,1);
});
test('检查被剩余预算截断后可有界续期并完成交付',t=>{
  const repo=gitRepo(t,{checks:[{name:'slow',command:process.execPath,args:['-e','setTimeout(()=>{},60)'],profiles:['standard','controlled'],covers:['behavior','negative-path'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'matching-covers'}]}),stateRoot=tempDir(t);
  const prepared=prepareTask({cwd:repo,stateRoot,intent:'验证普通功能',acceptance:['功能正确'],scope:'.',budgetMs:20});
  fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');
  const exhausted=deliverTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(exhausted.task.status,'saved');
  assert.equal(exhausted.task.verification.stopReason,'budget');
  assert.equal(exhausted.task.verification.lastFailureFingerprint,null);
  continueVerification({stateRoot,taskId:prepared.task.taskId,additionalBudgetMs:200,reason:'完成被总预算截断的检查'});
  const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(delivered.task.status,'waiting_acceptance');
});
test('相同输入失败保存限长诊断并禁止机械重跑，输入变化后可继续',t=>{const repo=gitRepo(t,{checks:[{name:'environment',command:process.execPath,args:['-e',"if(process.env.READY !== '1'){process.stderr.write('START-'+ 'x'.repeat(6000));process.exit(1)}"],profiles:['standard','controlled'],covers:['behavior','negative-path'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'matching-covers'}]}),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'验证普通服务功能',acceptance:['服务正常'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const old=process.env.READY;process.env.READY='0';try{const failed=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(failed.task.status,'needs_rework');assert.equal(failed.task.verification.firstFailure.name,'environment');assert.equal(failed.task.verification.firstFailure.command,process.execPath);assert.equal(failed.task.verification.firstFailure.exitCode,1);assert.ok(failed.task.verification.firstFailure.output.length<=5000);assert.equal(failed.task.verification.firstFailure.output.includes('START-'),false);assert.equal(failed.task.verification.firstFailure.truncated,true);assert.throws(()=>deliverTask({stateRoot,taskId:prepared.task.taskId}),/禁止机械重复/);process.env.READY='1';const passed=deliverTask({stateRoot,taskId:prepared.task.taskId,inputChange:'environment',inputChangeReason:'服务已启动'});assert.equal(passed.task.status,'waiting_acceptance');assert.equal(passed.task.verification.firstFailure,null);}finally{if(old===undefined)delete process.env.READY;else process.env.READY=old;}});
test('inputCycle 变化后旧 system hash 与旧 Evidence 失效',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const first=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(first.task.status,'waiting_acceptance');const oldBehavior=first.task.evidence.find(x=>x.covers.includes('behavior'));assert.ok(oldBehavior);const second=deliverTask({stateRoot,taskId:prepared.task.taskId,inputChange:'environment',inputChangeReason:'输入已变化',autoChecks:false});assert.equal(second.task.status,'verifying');assert.equal(second.task.evidence.some(x=>x.payloadHash===oldBehavior.payloadHash),false);assert.equal(second.task.verification.systemEvidenceHashes.includes(oldBehavior.payloadHash),false);assert.ok(second.task.verification.missingAcceptance.includes('A1'));});
test('Check 修改输入后清理失效 system hashes',t=>{const repo=gitRepo(t,{checks:[{name:'mutator',command:process.execPath,args:['-e',"require('node:fs').writeFileSync('target.txt','mutated')"],profiles:['standard','controlled'],covers:['behavior'],sideEffect:'workspace',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'matching-covers'}]}),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(delivered.task.status,'verifying');assert.equal(delivered.task.verification.stopReason,'check-mutated-input');assert.equal(delivered.task.evidence.some(x=>x.covers.includes('behavior')),false);assert.deepEqual(delivered.task.verification.systemEvidenceHashes,[]);});

test('隔离失败立即阻断且不执行检查、规格或 Review',t=>{
  const marker=path.join(tempDir(t),'check-ran');
  const repo=gitRepo(t,{checks:[{name:'must-not-run',command:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`],profiles:['standard','controlled'],covers:['behavior'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'matching-covers'}]});
  const stateRoot=tempDir(t),target=path.join(repo,'target.txt');
  fs.writeFileSync(target,'user-before\n');
  const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.',explicitReviewRequirement:{kind:'independent-agent',minimumDecision:'passed'}});
  fs.writeFileSync(target,'task-after\n');
  const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(delivered.task.status,'blocked');
  assert.equal(delivered.task.verification.stopReason,'isolation-failed');
  assert.equal(fs.existsSync(marker),false);
  assert.equal(delivered.task.specTraceability,null);
  assert.equal(delivered.task.specConsistency,null);
  assert.equal(delivered.task.reviewPackage,null);
  assert.deepEqual(delivered.task.deliveryDecision,{decision:'blocked',reasons:['user-changes']});
  assert.match(delivered.task.blockers[0],/--allow-existing-change "target\.txt"/u);
});

test('同一工作树拒绝并行 Task，不同 worktree 允许准备',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t);
  const first=prepareTask({cwd:repo,stateRoot,intent:'第一个写任务',acceptance:['完成'],scope:'.'});
  assert.throws(()=>prepareTask({cwd:repo,stateRoot,intent:'第二个写任务',acceptance:['完成'],scope:'.'}),error=>{
    assert.match(error.message,new RegExp(first.task.taskId,'u'));
    assert.match(error.message,/Codex 桌面端/u);
    assert.match(error.message,/Handoff/u);
    assert.match(error.message,/managed Worktree/u);
    assert.match(error.message,/git worktree add --detach/u);
    assert.match(error.message,/--integration-target/u);
    assert.match(error.message,/保存 --task-id/u);
    assert.match(error.message,/不会自动创建、移动或删除 worktree/u);
    return true;
  });
  const parent=tempDir(t),worktree=path.join(parent,'worktree'),target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  const added=spawnSync('git',['-C',repo,'worktree','add','--detach',worktree,'HEAD'],{encoding:'utf8'});
  assert.equal(added.status,0,added.stderr);
  try {
    assert.throws(()=>prepareTask({cwd:worktree,stateRoot,intent:'缺少目标分支',acceptance:['完成'],scope:'.'}),/--integration-target/u);
    const parallel=prepareTask({cwd:worktree,stateRoot,intent:'独立工作树任务',acceptance:['完成'],scope:'.',integrationTarget:target});
    assert.equal(parallel.task.baseline.gitRoot,fs.realpathSync.native(worktree));
    assert.equal(parallel.task.integration.target,target);
  } finally {
    spawnSync('git',['-C',repo,'worktree','remove','--force',worktree],{encoding:'utf8'});
  }
});

test('detached worktree 成果必须提交，目标 HEAD 变化后重验才能验收',t=>{
  const repo=gitRepo(t,{checks:[{name:'target-behavior',command:process.execPath,args:['-e',"const fs=require('node:fs');if(fs.readFileSync('target.txt','utf8')!=='integrated\\n')process.exit(1)"],profiles:['standard','controlled','release'],covers:['behavior','negative-path'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'matching-covers'}]}),stateRoot=tempDir(t),parent=tempDir(t),worktree=path.join(parent,'worktree');
  const target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  const added=spawnSync('git',['-C',repo,'worktree','add','--detach',worktree,target],{encoding:'utf8'});
  assert.equal(added.status,0,added.stderr);
  const prepared=prepareTask({cwd:worktree,stateRoot,intent:'修改普通功能',acceptance:['功能正确'],scope:'.',integrationTarget:target});
  fs.writeFileSync(path.join(worktree,'target.txt'),'integrated\n');
  const uncommitted=deliverTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(uncommitted.task.status,'verifying');
  assert.ok(uncommitted.task.deliveryDecision.reasons.includes('uncommitted-task-changes'));
  for(const args of [['add','target.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','agent result']]){
    const result=spawnSync('git',['-C',worktree,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(delivered.task.status,'ready_to_integrate');
  assert.equal(delivered.task.integration.target,target);
  assert.ok(delivered.task.integration.resultCommit);
  assert.equal(spawnSync('git',['-C',repo,'rev-parse','--verify',delivered.task.integration.pendingRef],{encoding:'utf8'}).status,0);
  assert.throws(()=>confirmIntegration({stateRoot,taskId:prepared.task.taskId,cwd:repo}),/尚未确认集成/u);
  const picked=spawnSync('git',['-C',repo,'cherry-pick',delivered.task.integration.resultCommit],{encoding:'utf8'});
  assert.equal(picked.status,0,picked.stderr);
  const integrated=confirmIntegration({stateRoot,taskId:prepared.task.taskId,cwd:repo});
  assert.equal(integrated.task.status,'waiting_acceptance');
  assert.equal(integrated.task.integration.status,'integrated');
  assert.notEqual(integrated.task.integration.targetCommit,null);
  assert.notEqual(spawnSync('git',['-C',repo,'rev-parse','--verify',delivered.task.integration.pendingRef],{encoding:'utf8'}).status,0);
  const removed=spawnSync('git',['-C',repo,'worktree','remove',worktree],{encoding:'utf8'});
  assert.equal(removed.status,0,removed.stderr);
  fs.writeFileSync(path.join(repo,'target.txt'),'broken later\n');
  for(const args of [['add','target.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','break integrated behavior']]){
    const result=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  assert.throws(()=>acceptTask({stateRoot,taskId:prepared.task.taskId,decision:'通过'}),/集成目标 HEAD 已变化.*重验集成/u);
  const failed=revalidateIntegration({stateRoot,taskId:prepared.task.taskId,cwd:repo});
  assert.equal(failed.task.verification.stopReason,'integration-check-failed');
  assert.equal(failed.task.integration.targetCommit,integrated.task.integration.targetCommit);

  fs.writeFileSync(path.join(repo,'target.txt'),'integrated\n');
  for(const args of [['add','target.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','restore integrated behavior']]){
    const result=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  const revalidated=revalidateIntegration({stateRoot,taskId:prepared.task.taskId,cwd:repo});
  assert.equal(revalidated.task.status,'waiting_acceptance');
  assert.equal(revalidated.task.integration.integrationEvidence.targetHead,revalidated.task.integration.targetCommit);
  assert.notEqual(revalidated.task.integration.targetCommit,integrated.task.integration.targetCommit);
  const accepted=acceptTask({stateRoot,taskId:prepared.task.taskId,decision:'通过'});
  assert.equal(accepted.task.status,'accepted');
});

function preservationRepo(t, checks) {
  const repo = gitRepo(t, checks === undefined ? {} : { checks });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'export const create = () => 1;\n');
  fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'export const cancel = () => 1;\n');
  fs.writeFileSync(path.join(repo, 'src', 'types.js'), 'export const T = 1;\n');
  fs.writeFileSync(path.join(repo, 'tests', 'r.test.js'), '// targeted reference test\n');
  for (const args of [['add', '.'], ['-c', 'user.email=t@e.c', '-c', 'user.name=T', 'commit', '-m', 'ref']]) {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  return repo;
}

function preservationAlignment(mode = 'delegated', behaviors = null) {
  const defaultBehaviors = ['R1', 'R2', 'R3', 'R4', 'R5'].map((id) => ({
    id,
    category: id === 'R5' ? 'interaction' : 'business',
    description: `参考行为 ${id}`,
    sourceFiles: id === 'R5' ? ['src/a.js'] : id === 'R4' ? ['src/b.js'] : ['src/a.js'],
  }));
  return {
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
      constraints: [],
      referenceRoots: ['src'],
      behaviors: behaviors ?? defaultBehaviors,
      excludedFiles: [{ path: 'src/types.js', reason: '仅类型定义' }],
      allowedDifferences: [],
    },
    alignment: {
      mode,
      reasonCodes: [],
      decisionNote: mode === 'confirmed' ? '用户确认按原行为重构' : '用户委托按原行为重构',
      delegatedTopics: mode === 'delegated' ? ['订单模块重构'] : [],
    },
  };
}

function writeJson(t, value, name) {
  const file = path.join(tempDir(t), name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function writeRationale(t, task, changeSet, files) {
  return writeJson(t, {
    schemaVersion: 1,
    taskId: task.taskId,
    changeFingerprint: changeSet.fingerprint,
    items: files.map((file) => ({ files: [file], supports: ['GOAL'], reason: '行为保持重构' })),
  }, 'rationale.json');
}

test('Task Check 精确归因 Acceptance 并生成 system Evidence', (t) => {
  const repo = preservationRepo(t, []);
  fs.writeFileSync(path.join(repo, 'tests', 'target.test.js'), '// targeted\n');
  for (const args of [['add', '.'], ['-c', 'user.email=t@e.c', '-c', 'user.name=T', 'commit', '-m', 'test']]) {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  const stateRoot = tempDir(t);
  const alignment = {
    originalRequest: '修复普通功能',
    goal: '修复普通功能',
    expectedOutcomes: ['功能正确'],
    protectedBehaviors: [],
    acceptance: ['功能正确', '另一功能正确'],
    confirmedDecisions: [],
    nonGoals: [],
    assumptions: [],
    alignment: { mode: 'delegated', reasonCodes: [], decisionNote: '用户委托', delegatedTopics: ['功能修复'] },
  };
  const prepared = prepareTask({ cwd: repo, stateRoot, intent: alignment.originalRequest, alignmentFile: writeJson(t, alignment, 'alignment.json'), scope: '.' });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const changeSet = computeChangeSet(prepared.task.baseline);
  const taskCheckFile = writeJson(t, {
    schemaVersion: 1,
    checks: [{
      name: 'target-A1',
      command: process.execPath,
      args: ['--test', 'tests/target.test.js'],
      covers: ['behavior'],
      acceptanceIds: ['A1'],
      testFiles: ['tests/target.test.js'],
      sideEffect: 'none',
      estimatedCost: 'very-low',
      timeoutMs: 5000,
    }],
  }, 'task-checks.json');
  const delivered = deliverTask({
    stateRoot,
    taskId: prepared.task.taskId,
    rationaleFile: writeRationale(t, prepared.task, changeSet, ['target.txt']),
    taskCheckFile,
  });
  assert.equal(delivered.task.status, 'verifying');
  assert.ok(delivered.task.verification.missingAcceptance.includes('A2'));
  assert.equal(delivered.task.verification.missingAcceptance.includes('A1'), false);
  const checkEvidence = delivered.task.evidence.find((item) => item.source?.testFiles?.length);
  assert.ok(checkEvidence);
  assert.equal(checkEvidence.source.type, 'command');
  assert.equal(checkEvidence.source.actor, 'ai-system');
  assert.deepEqual(checkEvidence.source.testFiles, ['tests/target.test.js']);
  assert.ok(delivered.task.verification.systemEvidenceHashes.includes(checkEvidence.payloadHash));
});

test('重构遗漏 R4 时 verifying 且 missingBehaviorIds 含 R4', (t) => {
  const broad = [{
    name: 'broad-green',
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    profiles: ['standard', 'controlled'],
    covers: ['behavior'],
    sideEffect: 'none',
    estimatedCost: 'very-low',
    timeoutMs: 5000,
    acceptanceMode: 'none',
  }];
  const repo = preservationRepo(t, broad);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: '重构订单模块，原功能不能遗漏',
    alignmentFile: writeJson(t, preservationAlignment(), 'alignment.json'),
    scope: '.',
  });
  const ids = Object.fromEntries(prepared.task.acceptance.map((item) => [item.referenceBehaviorId, item.id]));
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'export const rewritten = () => 42;\n');
  const changeSet = computeChangeSet(prepared.task.baseline);
  const taskCheckFile = writeJson(t, {
    schemaVersion: 1,
    checks: ['R1', 'R2', 'R3', 'R5'].map((id) => ({
      name: `check-${id}`,
      command: process.execPath,
      args: ['--test', 'tests/r.test.js'],
      covers: ['behavior'],
      acceptanceIds: [ids[id]],
      testFiles: ['tests/r.test.js'],
      sideEffect: 'none',
      estimatedCost: 'very-low',
      timeoutMs: 5000,
    })),
  }, 'task-checks.json');
  const delivered = deliverTask({
    stateRoot,
    taskId: prepared.task.taskId,
    rationaleFile: writeRationale(t, prepared.task, changeSet, ['src/a.js']),
    taskCheckFile,
  });
  assert.equal(delivered.task.status, 'verifying');
  assert.ok(delivered.task.verification.missingAcceptance.includes(ids.R4));
  assert.deepEqual(delivered.task.verification.preservationCoverage, {
    behaviorCount: 5,
    verifiedBehaviorCount: 4,
    missingBehaviorIds: ['R4'],
    complete: false,
  });
});

test('内部实现不同但行为全验证时 complete 且允许交付', (t) => {
  const repo = preservationRepo(t);
  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: '重构订单模块，原功能不能遗漏',
    alignmentFile: writeJson(t, preservationAlignment(), 'alignment.json'),
    scope: '.',
  });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'export function rewrittenCreate() { return 42; }\n');
  fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'export function rewrittenCancel() { return 0; }\n');
  const changeSet = computeChangeSet(prepared.task.baseline);
  const ids = Object.fromEntries(prepared.task.acceptance.map((item) => [item.referenceBehaviorId, item.id]));
  const taskCheckFile = writeJson(t, {
    schemaVersion: 1,
    checks: ['R1', 'R2', 'R3', 'R4', 'R5'].map((id) => ({
      name: `bind-${id}`,
      command: process.execPath,
      args: ['--test', 'tests/r.test.js'],
      covers: ['behavior'],
      acceptanceIds: [ids[id]],
      testFiles: ['tests/r.test.js'],
      sideEffect: 'none',
      estimatedCost: 'very-low',
      timeoutMs: 5000,
    })),
  }, 'task-checks.json');
  const delivered = deliverTask({
    stateRoot,
    taskId: prepared.task.taskId,
    rationaleFile: writeRationale(t, prepared.task, changeSet, ['src/a.js', 'src/b.js']),
    taskCheckFile,
  });
  assert.equal(delivered.task.status, 'waiting_acceptance');
  assert.deepEqual(delivered.task.verification.preservationCoverage, {
    behaviorCount: 5,
    verifiedBehaviorCount: 5,
    missingBehaviorIds: [],
    complete: true,
  });
});
