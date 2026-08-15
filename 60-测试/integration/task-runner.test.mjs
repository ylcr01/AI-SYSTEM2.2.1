import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import { spawnSync } from 'node:child_process';import test from 'node:test';import { prepareTask,deliverTask,acceptTask,saveTask,resumeTask,continueVerification,confirmIntegration,revalidateIntegration } from '../../40-脚本/lib/task-runner.mjs';import { updateTask } from '../../40-脚本/lib/state-manager.mjs';import { createReviewRecord } from '../../40-脚本/lib/review.mjs';import { createEvidence } from '../../40-脚本/lib/evidence.mjs';import { gitRepo,tempDir } from '../helpers.mjs';
test('Standard 任务完成自动验证、交付和用户验收',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(delivered.task.status,'waiting_acceptance');assert.ok(delivered.task.evidence.some(x=>x.covers.includes('behavior')));const accepted=acceptTask({stateRoot,taskId:prepared.task.taskId,decision:'通过'});assert.equal(accepted.task.status,'accepted');});
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
test('相同输入失败保存限长诊断并禁止机械重跑，输入变化后可继续',t=>{const repo=gitRepo(t,{checks:[{name:'environment',command:process.execPath,args:['-e',"if(process.env.READY !== '1'){process.stderr.write('START-'+ 'x'.repeat(6000));process.exit(1)}"],profiles:['standard','controlled'],covers:['behavior','negative-path'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'matching-covers'}]}),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'验证普通服务功能',acceptance:['服务正常'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const old=process.env.READY;process.env.READY='0';try{const failed=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(failed.task.status,'needs_rework');assert.equal(failed.task.verification.firstFailure.name,'environment');assert.equal(failed.task.verification.firstFailure.command,process.execPath);assert.equal(failed.task.verification.firstFailure.exitCode,1);assert.ok(failed.task.verification.firstFailure.output.length<=5000);assert.equal(failed.task.verification.firstFailure.output.includes('START-'),false);assert.equal(failed.task.verification.firstFailure.truncated,true);assert.throws(()=>deliverTask({stateRoot,taskId:prepared.task.taskId}),/禁止机械重复/);process.env.READY='1';const passed=deliverTask({stateRoot,taskId:prepared.task.taskId,inputChange:'environment',inputChangeReason:'服务已启动'});assert.equal(passed.task.status,'waiting_acceptance');assert.equal(passed.task.verification.firstFailure,null);}finally{if(old===undefined)delete process.env.READY;else process.env.READY=old;}});

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
