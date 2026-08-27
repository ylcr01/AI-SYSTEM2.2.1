// BR-AIRD-EVIDENCE-001 BR-AIRD-STATE-002 BR-AIRD-METRICS-001
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import { spawnSync } from 'node:child_process';import test from 'node:test';import { preflightWorkspace,prepareTask,deliverTask,recordTaskFollowUp,acceptTask,saveTask,resumeTask,continueVerification,integrateTask,confirmIntegration,revalidateIntegration,inferAcceptanceCovers } from '../../40-脚本/lib/task-runner.mjs';import { computeChangeSet } from '../../40-脚本/lib/git-state.mjs';import { listTasks,readHistory,updateTask } from '../../40-脚本/lib/state-manager.mjs';import { createReviewRecord } from '../../40-脚本/lib/review.mjs';import { createEvidence } from '../../40-脚本/lib/evidence.mjs';import { cleanupTaskSource } from '../../40-脚本/lib/integration-workflow.mjs';import { gitRepo,taskCheck,tempDir } from '../helpers.mjs';
test('Standard 任务完成自动验证、交付和用户验收',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});assert.equal(delivered.task.status,'waiting_acceptance');assert.ok(delivered.task.evidence.some(x=>x.covers.includes('behavior')));const accepted=acceptTask({stateRoot,taskId:prepared.task.taskId,decision:'通过'});assert.equal(accepted.task.status,'accepted');});
test('成功交付生成精确 continuation，缺陷退回后重新交付轮换 deliveryId',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});const target=path.join(repo,'target.txt');fs.writeFileSync(target,'first\n');const first=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});const firstDeliveryId=first.task.conversationOutcome.deliveryId;assert.ok(firstDeliveryId);const returned=recordTaskFollowUp({stateRoot,taskId:prepared.task.taskId,deliveryId:firstDeliveryId,observationId:'turn-defect',kind:'defect-return'});assert.equal(returned.task.status,'needs_rework');assert.equal(returned.task.outcomeMetrics.reworkCount,0);assert.equal(returned.task.outcomeMetrics.firstPassAccepted,null);fs.writeFileSync(target,'second\n');const second=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});assert.equal(second.task.status,'waiting_acceptance');assert.notEqual(second.task.conversationOutcome.deliveryId,firstDeliveryId);assert.equal(second.task.conversationOutcome.counts['defect-return'],1);assert.throws(()=>recordTaskFollowUp({stateRoot,taskId:prepared.task.taskId,deliveryId:firstDeliveryId,observationId:'turn-stale',kind:'topic-advance'}),/delivery-id.*不匹配/u);});
test('相关询问保持 delivered 且后续话题推进隐式关闭，不伪造验收或修复成功',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});const deliveryId=delivered.task.conversationOutcome.deliveryId;const verificationRuns=delivered.task.outcomeMetrics.verificationRunCount;const related=recordTaskFollowUp({stateRoot,taskId:prepared.task.taskId,deliveryId,observationId:'turn-question',kind:'related-question'});assert.equal(related.task.status,'waiting_acceptance');assert.equal(related.task.outcomeMetrics.reworkCount,0);assert.equal(related.task.outcomeMetrics.verificationRunCount,verificationRuns);assert.equal(related.task.conversationOutcome.firstDeliveryFollowUpKind,'related-question');const duplicate=recordTaskFollowUp({stateRoot,taskId:prepared.task.taskId,deliveryId,observationId:'turn-question',kind:'related-question'});assert.equal(duplicate.idempotent,true);const closed=recordTaskFollowUp({stateRoot,taskId:prepared.task.taskId,deliveryId,observationId:'turn-topic',kind:'topic-advance'});assert.equal(closed.task.status,'closed');assert.equal(closed.task.acceptedAt,null);assert.equal(closed.task.userAcceptance,undefined);assert.equal(closed.task.outcomeMetrics.firstPassAccepted,null);assert.equal('firstPassResolved' in closed.task.conversationOutcome,false);const closedDuplicate=recordTaskFollowUp({stateRoot,taskId:prepared.task.taskId,deliveryId,observationId:'turn-topic',kind:'topic-advance'});assert.equal(closedDuplicate.idempotent,true);});
test('三类隐式收口保持 accepted 强语义并为 scope extension 返回父任务关联',t=>{for(const kind of ['scope-extension','positive-acknowledgement','topic-advance']){const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),`${kind}\n`);const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});const result=recordTaskFollowUp({stateRoot,taskId:prepared.task.taskId,deliveryId:delivered.task.conversationOutcome.deliveryId,observationId:`turn-${kind}`,kind,message:'这段消息正文不得保存'});assert.equal(result.task.status,'closed');assert.equal(result.task.userAcceptance,undefined);assert.equal(result.task.outcomeMetrics.firstPassAccepted,null);assert.equal(JSON.stringify(result.task).includes('这段消息正文不得保存'),false);assert.equal(listTasks({stateRoot}).tasks.length,0);assert.deepEqual(readHistory({stateRoot}).map(item=>item.taskId),[prepared.task.taskId]);if(kind==='scope-extension')assert.deepEqual({parentTaskId:result.followUp.parentTaskId,relation:result.followUp.relation},{parentTaskId:prepared.task.taskId,relation:'scope-extension'});}});
test('自动检查生成的 Evidence 自动进入 systemEvidenceHashes',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});assert.equal(delivered.task.status,'waiting_acceptance');const behaviorEvidence=delivered.task.evidence.find(x=>x.covers.includes('behavior'));assert.ok(behaviorEvidence);assert.ok(delivered.task.verification.systemEvidenceHashes.includes(behaviorEvidence.payloadHash));assert.ok(delivered.task.evidence.filter(x=>x.covers.includes('scope')).every(x=>delivered.task.verification.systemEvidenceHashes.includes(x.payloadHash)));});
test('纯文档任务进入 Quick，但通用文档检查不能自动证明 Acceptance',t=>{const repo=gitRepo(t,{checks:[{name:'docs',command:process.execPath,args:['-e','process.exit(0)'],profiles:['quick','standard'],covers:['documentation'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'matching-covers'}]}),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'更新入口规则',acceptance:['规则满足验收条件'],scope:'.'});fs.writeFileSync(path.join(repo,'README.md'),'# updated\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(delivered.task.status,'verifying');assert.equal(delivered.task.classification.controlMode,'quick');assert.deepEqual(delivered.task.acceptance[0].requiredCovers,['documentation']);assert.equal(delivered.task.verification.requiredCovers.includes('behavior'),false);assert.ok(delivered.task.verification.missingAcceptance.includes('A1'));});
test('验收证据按每条语义推断',()=>{const classification={controlMode:'standard',artifactKinds:['code']};assert.deepEqual(['README 文档说明已同步','用户在页面可见处理结果','历史状态迁移失败时可以回滚','结果指标显示已决定数量','局部任务不加载 Contract 或 Canonical','未授权用户必须被拒绝','无效数量不能修改库存','支付失败问题已修复'].map(item=>inferAcceptanceCovers(item,classification)),[['documentation'],['behavior','browser'],['behavior','data','rollback','negative-path'],['behavior'],['behavior'],['behavior','negative-path'],['behavior','negative-path'],['behavior']]);});
test('没有语义 Evidence 时不能进入等待验收',t=>{const repo=gitRepo(t,{checks:[]}),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,autoChecks:false});assert.equal(delivered.task.status,'verifying');});
test('真实 package.json 仅版本变化保持 Standard 且不要求 package Cover',t=>{const repo=gitRepo(t),stateRoot=tempDir(t),manifest=path.join(repo,'package.json');fs.writeFileSync(manifest,JSON.stringify({name:'demo',version:'1.0.0',scripts:{test:'node --test'},dependencies:{}}));for(const args of [['add','package.json'],['-c','user.email=t@e.c','-c','user.name=T','commit','-m','manifest']]){const result=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}const prepared=prepareTask({cwd:repo,stateRoot,intent:'更新项目版本元数据',acceptance:['版本元数据正确'],scope:'package.json'});assert.equal(prepared.task.classification.controlMode,'standard');fs.writeFileSync(manifest,JSON.stringify({name:'demo',version:'1.0.1',scripts:{test:'node --test'},dependencies:{}}));const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});assert.equal(delivered.task.status,'waiting_acceptance');assert.equal(delivered.task.classification.controlMode,'standard');assert.equal(delivered.task.verification.requiredCovers.includes('package'),false);assert.deepEqual(delivered.task.classification.packageManifestChanges[0].changedFields,['version']);});
test('缺少完整 Task Check 时不执行无法闭合验收的通用命令',t=>{const repo=gitRepo(t,{checks:[{name:'broad-failure',command:process.execPath,args:['-e','process.exit(9)'],profiles:['standard'],covers:['behavior'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'none'}]}),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId});assert.equal(delivered.task.status,'verifying');assert.equal(delivered.task.verification.stopReason,'missing-acceptance-checks');assert.equal(delivered.task.verification.firstFailure,null);assert.equal(delivered.task.verification.checkManifest,null);assert.deepEqual(delivered.task.verification.missingAcceptance,['A1']);});
test('目标证明失败时先停止且不执行后续通用检查',t=>{const repo=gitRepo(t,{checks:[{name:'typecheck-after-proof',command:process.execPath,args:['-e','process.exit(7)'],profiles:['standard'],covers:['typecheck'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'none'}]}),stateRoot=tempDir(t);fs.writeFileSync(path.join(repo,'target.ts'),'baseline\n');fs.writeFileSync(path.join(repo,'tests','acceptance.test.mjs'),"import assert from 'node:assert/strict';import test from 'node:test';test('A1 proof',()=>assert.fail('proof failed'));\n");for(const args of [['add','.'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','proof baseline']]){const result=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.ts'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});assert.equal(delivered.task.status,'needs_rework');assert.equal(delivered.task.verification.firstFailure.name,'target-acceptance');assert.notEqual(delivered.task.verification.firstFailure.name,'typecheck-after-proof');});
test('目标证明覆盖 behavior 后跳过宽泛检查但保留独立 typecheck',t=>{const repo=gitRepo(t,{checks:[{name:'redundant-behavior',command:process.execPath,args:['-e','process.exit(8)'],profiles:['standard'],covers:['behavior'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'none'},{name:'required-typecheck',command:process.execPath,args:['-e','process.exit(0)'],profiles:['standard'],covers:['typecheck'],sideEffect:'none',estimatedCost:'low',timeoutMs:5000,acceptanceMode:'none'}]}),stateRoot=tempDir(t);fs.writeFileSync(path.join(repo,'target.ts'),'baseline\n');for(const args of [['add','.'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','typescript baseline']]){const result=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.ts'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});assert.equal(delivered.task.status,'waiting_acceptance');assert.deepEqual(delivered.task.verification.checkManifest.checks.map(item=>item.name),['target-acceptance','required-typecheck']);assert.equal(delivered.task.evidence.some(item=>item.source?.command==='redundant-behavior'),false);});
test('显式 Independent Review 必须 passed 且无 Blocking Finding',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.',explicitReviewRequirement:{kind:'independent-agent',minimumDecision:'passed'}});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const first=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});assert.equal(first.task.status,'reviewing');const pack=first.task.reviewPackage;const review=createReviewRecord({kind:'independent-agent',taskId:first.task.taskId,changeFingerprint:first.task.changeSet.fingerprint,packageFingerprint:pack.packageFingerprint,implementer:{actor:'a',session:'s1'},reviewer:{actor:'b',session:'s2',provenance:{provider:'test'}},decision:'passed',createdAt:new Date(Date.parse(pack.createdAt)+1000).toISOString()});const file=path.join(stateRoot,'review.json');fs.writeFileSync(file,JSON.stringify(review));const second=deliverTask({stateRoot,taskId:first.task.taskId,reviewFile:file});assert.equal(second.task.status,'waiting_acceptance');});
test('Handoff-required 交付生成新鲜 Handoff，保存后可恢复',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.',handoffRequired:true});fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});assert.equal(delivered.task.status,'waiting_acceptance');assert.ok(delivered.task.handoff);const root2=tempDir(t);const p2=prepareTask({cwd:repo,stateRoot:root2,intent:'修复另一个普通功能',acceptance:['功能正确'],scope:'.'});const saved=saveTask({stateRoot:root2,taskId:p2.task.taskId});assert.equal(saved.task.status,'saved');const resumed=resumeTask({stateRoot:root2,taskId:p2.task.taskId});assert.ok(['implementing','verifying'].includes(resumed.task.status));});
test('瞬态 Handoff 和隔离 Blocker 在事实恢复后自动清理',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t),target=path.join(repo,'target.txt');
  const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});
  saveTask({stateRoot,taskId:prepared.task.taskId});
  fs.writeFileSync(target,'task change\n');
  const resumed=resumeTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(resumed.task.status,'verifying');
  assert.deepEqual(resumed.task.blockers,[]);
  assert.equal(resumed.task.verification.stopReason,'handoff-stale');
  assert.equal(deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)}).task.status,'waiting_acceptance');

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
  const repo=gitRepo(t,{checks:[{name:'slow',command:process.execPath,args:['-e','setTimeout(()=>{},60)'],profiles:['standard','controlled'],covers:['behavior','negative-path'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'none'}]}),stateRoot=tempDir(t);
  const prepared=prepareTask({cwd:repo,stateRoot,intent:'验证普通功能',acceptance:['功能正确'],scope:'.',budgetMs:20});
  fs.writeFileSync(path.join(repo,'target.txt'),'changed\n');
  const exhausted=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});
  assert.equal(exhausted.task.status,'saved');
  assert.equal(exhausted.task.verification.stopReason,'budget');
  assert.equal(exhausted.task.verification.lastFailureFingerprint,null);
  continueVerification({stateRoot,taskId:prepared.task.taskId,additionalBudgetMs:2000,reason:'完成被总预算截断的检查'});
  const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});
  assert.equal(delivered.task.status,'waiting_acceptance');
});
test('相同输入失败禁止机械重跑，只有真实 ChangeSet 变化后可继续',t=>{const repo=gitRepo(t,{checks:[{name:'environment',command:process.execPath,args:['-e',"if(process.env.READY !== '1'){process.stderr.write('START-'+ 'x'.repeat(6000));process.exit(1)}"],profiles:['standard','controlled'],covers:['typecheck'],sideEffect:'none',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'none'}]}),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'验证普通服务功能',acceptance:['服务正常'],scope:'.'});const target=path.join(repo,'target.ts');fs.writeFileSync(target,'changed\n');const taskCheckFile=taskCheck(t,repo);const old=process.env.READY;process.env.READY='0';try{const failed=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile});assert.equal(failed.task.status,'needs_rework');assert.equal(failed.task.verification.firstFailure.name,'environment');assert.equal(failed.task.verification.firstFailure.command,process.execPath);assert.equal(failed.task.verification.firstFailure.exitCode,1);assert.ok(failed.task.verification.firstFailure.output.length<=5000);assert.equal(failed.task.verification.firstFailure.output.includes('START-'),false);assert.equal(failed.task.verification.firstFailure.truncated,true);assert.throws(()=>deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile}),/禁止机械重复/);assert.throws(()=>deliverTask({stateRoot,taskId:prepared.task.taskId,inputChange:'environment',inputChangeReason:'服务已启动'}),/禁止手工声明/u);process.env.READY='1';fs.writeFileSync(target,'changed again\n');const passed=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile});assert.equal(passed.task.status,'waiting_acceptance');assert.equal(passed.task.verification.firstFailure,null);}finally{if(old===undefined)delete process.env.READY;else process.env.READY=old;}});
test('真实 ChangeSet 变化后旧 system hash 与旧 Evidence 失效',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});const target=path.join(repo,'target.txt');fs.writeFileSync(target,'changed\n');const first=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});assert.equal(first.task.status,'waiting_acceptance');const oldBehavior=first.task.evidence.find(x=>x.covers.includes('behavior'));assert.ok(oldBehavior);assert.throws(()=>deliverTask({stateRoot,taskId:prepared.task.taskId,inputChange:'environment',inputChangeReason:'输入已变化'}),/禁止手工声明/u);fs.writeFileSync(target,'changed again\n');const second=deliverTask({stateRoot,taskId:prepared.task.taskId,autoChecks:false});assert.equal(second.task.status,'verifying');assert.equal(second.task.evidence.some(x=>x.payloadHash===oldBehavior.payloadHash),false);assert.equal(second.task.verification.systemEvidenceHashes.includes(oldBehavior.payloadHash),false);assert.ok(second.task.verification.missingAcceptance.includes('A1'));});
test('Check 修改输入后清理失效 system hashes',t=>{const repo=gitRepo(t,{checks:[{name:'mutator',command:process.execPath,args:['-e',"require('node:fs').writeFileSync('target.ts','mutated')"],profiles:['standard','controlled'],covers:['typecheck'],sideEffect:'workspace',estimatedCost:'very-low',timeoutMs:5000,acceptanceMode:'none'}]}),stateRoot=tempDir(t);const prepared=prepareTask({cwd:repo,stateRoot,intent:'修复普通功能',acceptance:['功能正确'],scope:'.'});fs.writeFileSync(path.join(repo,'target.ts'),'changed\n');const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)});assert.equal(delivered.task.status,'verifying');assert.equal(delivered.task.verification.stopReason,'check-mutated-input');assert.equal(delivered.task.evidence.some(x=>x.covers.includes('behavior')),false);assert.deepEqual(delivered.task.verification.systemEvidenceHashes,[]);});

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
  assert.equal(delivered.task.reviewPackage,undefined);
  assert.deepEqual(delivered.task.deliveryDecision,{decision:'blocked',reasons:['user-changes']});
  assert.match(delivered.task.blockers[0],/--allow-existing-change "target\.txt"/u);
});

test('同一工作树拒绝并行 Task，不同 worktree 允许准备',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t);
  const first=prepareTask({cwd:repo,stateRoot,intent:'第一个写任务',acceptance:['完成'],scope:'.'});
  const route=preflightWorkspace({cwd:repo,stateRoot});
  assert.equal(route.available,false);
  assert.equal(route.conflict.taskId,first.task.taskId);
  assert.deepEqual(route.writeRouting,{recommended:'new-worktree',localDirectEligible:false,reasonCodes:['active-task']});
  assert.throws(()=>prepareTask({cwd:repo,stateRoot,intent:'第二个写任务',alignmentFile:path.join(stateRoot,'不存在的目标卡.json'),scope:'.'}),error=>{
    assert.match(error.message,new RegExp(first.task.taskId,'u'));
    assert.doesNotMatch(error.message,/无法读取对齐文件/u);
    return true;
  });
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

test('低风险 Worktree 结果默认隔离集成到目标分支并清理任务分支和 Worktree',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t),parent=tempDir(t),worktree=path.join(parent,'task-worktree');
  const target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  const added=spawnSync('git',['-C',repo,'worktree','add','-b','codex/auto-integrate-test',worktree,target],{encoding:'utf8'});
  assert.equal(added.status,0,added.stderr);
  const prepared=prepareTask({cwd:worktree,stateRoot,intent:'修改普通功能',acceptance:['功能正确'],scope:'.',integrationTarget:target});
  fs.writeFileSync(path.join(worktree,'target.txt'),'integrated\n');
  for(const args of [['add','target.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','task result']]){
    const result=spawnSync('git',['-C',worktree,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,worktree)});
  assert.equal(delivered.task.status,'ready_to_integrate');
  const integrated=integrateTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(integrated.task.status,'waiting_acceptance');
  assert.equal(integrated.task.integration.status,'integrated');
  assert.equal(fs.readFileSync(path.join(repo,'target.txt'),'utf8').replaceAll('\r\n','\n'),'integrated\n');
  assert.equal(fs.existsSync(worktree),false);
  assert.notEqual(spawnSync('git',['-C',repo,'show-ref','--verify','refs/heads/codex/auto-integrate-test'],{encoding:'utf8'}).status,0);
  assert.notEqual(spawnSync('git',['-C',repo,'show-ref','--verify',delivered.task.integration.pendingRef],{encoding:'utf8'}).status,0);
  assert.equal(integrated.task.integration.cleanup.source.worktree,'removed');
  assert.equal(acceptTask({stateRoot,taskId:prepared.task.taskId,decision:'通过'}).task.status,'accepted');
});

test('任务结果变基到最新目标后只集成目标尚未包含的提交',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t),parent=tempDir(t),worktree=path.join(parent,'task-worktree');
  const target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  assert.equal(spawnSync('git',['-C',repo,'worktree','add','--detach',worktree,target],{encoding:'utf8'}).status,0);
  const prepared=prepareTask({cwd:worktree,stateRoot,intent:'修改普通功能',acceptance:['功能正确'],scope:'.',integrationTarget:target});
  fs.writeFileSync(path.join(worktree,'target.txt'),'task\n');
  for(const args of [['add','target.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','task result']])assert.equal(spawnSync('git',['-C',worktree,...args],{encoding:'utf8'}).status,0);
  fs.writeFileSync(path.join(repo,'main.txt'),'new target\n');
  for(const args of [['add','main.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','target advanced']])assert.equal(spawnSync('git',['-C',repo,...args],{encoding:'utf8'}).status,0);
  const rebased=spawnSync('git',['-C',worktree,'rebase',target],{encoding:'utf8'});
  assert.equal(rebased.status,0,rebased.stderr);
  const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,worktree)});
  assert.equal(delivered.task.status,'ready_to_integrate');
  const integrated=integrateTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(integrated.task.status,'waiting_acceptance');
  assert.equal(fs.readFileSync(path.join(repo,'main.txt'),'utf8').trim(),'new target');
  assert.equal(fs.readFileSync(path.join(repo,'target.txt'),'utf8').trim(),'task');
});

test('源 Worktree 是当前进程目录时切换到目标 checkout 后安全清理',t=>{
  const repo=gitRepo(t),parent=tempDir(t),worktree=path.join(parent,'task-worktree');
  const target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  assert.equal(spawnSync('git',['-C',repo,'worktree','add','-b','codex/current-directory-cleanup',worktree,target],{encoding:'utf8'}).status,0);
  const resultCommit=spawnSync('git',['-C',worktree,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
  const original=process.cwd();
  try {
    process.chdir(worktree);
    const cleanup=cleanupTaskSource({targetCheckout:repo,sourceGitRoot:worktree,resultCommit,target});
    assert.equal(cleanup.worktree,'removed');
    assert.equal(cleanup.branch,'removed');
    assert.equal(fs.existsSync(worktree),false);
    assert.equal(fs.realpathSync.native(process.cwd()),fs.realpathSync.native(repo));
  } finally {
    process.chdir(original);
  }
});

test('源 Worktree 包含 Task 状态目录时保留并报告清理原因',t=>{
  const repo=gitRepo(t),parent=tempDir(t),worktree=path.join(parent,'task-worktree');
  const target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  assert.equal(spawnSync('git',['-C',repo,'worktree','add','--detach',worktree,target],{encoding:'utf8'}).status,0);
  const resultCommit=spawnSync('git',['-C',worktree,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
  const protectedState=path.join(worktree,'80-运行记录');
  fs.mkdirSync(protectedState,{recursive:true});
  const cleanup=cleanupTaskSource({targetCheckout:repo,sourceGitRoot:worktree,resultCommit,target,protectedPaths:[protectedState]});
  assert.equal(cleanup.worktree,'pending');
  assert.equal(cleanup.reason,'source-contains-protected-state');
  assert.equal(fs.existsSync(worktree),true);
});

test('目标 checkout 存在未提交改动时自动集成 fail closed 且不推进主分支',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t),parent=tempDir(t),worktree=path.join(parent,'task-worktree');
  const target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  assert.equal(spawnSync('git',['-C',repo,'worktree','add','--detach',worktree,target],{encoding:'utf8'}).status,0);
  const prepared=prepareTask({cwd:worktree,stateRoot,intent:'修改普通功能',acceptance:['功能正确'],scope:'.',integrationTarget:target});
  fs.writeFileSync(path.join(worktree,'target.txt'),'task\n');
  for(const args of [['add','target.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','task result']])assert.equal(spawnSync('git',['-C',worktree,...args],{encoding:'utf8'}).status,0);
  const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,worktree)});
  const before=spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
  fs.writeFileSync(path.join(repo,'README.md'),'dirty local\n');
  const paused=integrateTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(paused.task.status,'ready_to_integrate');
  assert.equal(paused.task.verification.stopReason,'integration-target-dirty');
  assert.equal(spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),before);
  assert.equal(fs.existsSync(worktree),true);
});

test('存在残余风险时默认暂停集成并保留结果',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t),parent=tempDir(t),worktree=path.join(parent,'task-worktree');
  const target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  assert.equal(spawnSync('git',['-C',repo,'worktree','add','--detach',worktree,target],{encoding:'utf8'}).status,0);
  const prepared=prepareTask({cwd:worktree,stateRoot,intent:'修改普通功能',acceptance:['功能正确'],scope:'.',integrationTarget:target});
  fs.writeFileSync(path.join(worktree,'target.txt'),'task\n');
  for(const args of [['add','target.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','task result']])assert.equal(spawnSync('git',['-C',worktree,...args],{encoding:'utf8'}).status,0);
  const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,worktree),residualRisks:['需要用户确认的数据兼容风险']});
  assert.equal(delivered.task.status,'ready_to_integrate');
  const before=spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
  const paused=integrateTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(paused.task.status,'ready_to_integrate');
  assert.equal(paused.task.integration.status,'paused_risk');
  assert.ok(paused.task.integration.pauseReasons.includes('residual-risks'));
  assert.equal(spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),before);
  assert.equal(fs.existsSync(worktree),true);
  assert.throws(()=>integrateTask({stateRoot,taskId:prepared.task.taskId,allowRisk:true}),/--risk-reason/u);
  const authorized=integrateTask({stateRoot,taskId:prepared.task.taskId,allowRisk:true,riskReason:'用户已确认兼容风险'});
  assert.equal(authorized.task.status,'waiting_acceptance');
  assert.equal(authorized.task.integration.riskAuthorization.reason,'用户已确认兼容风险');
});

test('集成候选验证失败时删除临时候选但不推进目标分支',t=>{
  const variable='AI_RD_OS_INTEGRATION_TEST_READY';
  const repo=gitRepo(t),stateRoot=tempDir(t),parent=tempDir(t),worktree=path.join(parent,'task-worktree');
  const target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  assert.equal(spawnSync('git',['-C',repo,'worktree','add','--detach',worktree,target],{encoding:'utf8'}).status,0);
  const prepared=prepareTask({cwd:worktree,stateRoot,intent:'修改普通功能',acceptance:['功能正确'],scope:'.',integrationTarget:target});
  fs.writeFileSync(path.join(worktree,'target.txt'),'task\n');
  fs.writeFileSync(path.join(worktree,'tests','acceptance.test.mjs'),`import assert from 'node:assert/strict';import test from 'node:test';test('A1 proof',()=>assert.equal(process.env.${variable},'1'));\n`);
  const taskCheckFile=taskCheck(t,worktree);
  for(const args of [['add','target.txt','tests/acceptance.test.mjs'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','task result']])assert.equal(spawnSync('git',['-C',worktree,...args],{encoding:'utf8'}).status,0);
  const previous=process.env[variable];
  try {
    process.env[variable]='1';
    const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile});
    assert.equal(delivered.task.status,'ready_to_integrate');
    const before=spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
    process.env[variable]='0';
    const failed=integrateTask({stateRoot,taskId:prepared.task.taskId});
    assert.equal(failed.task.status,'needs_rework');
    assert.equal(failed.task.integration.status,'revalidation_failed');
    assert.equal(spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),before);
    assert.equal(failed.task.integration.integrationWorktree,null);
    assert.equal(fs.existsSync(worktree),true);
  } finally {
    if(previous===undefined)delete process.env[variable];else process.env[variable]=previous;
  }
});

test('后集成任务冲突时保留隔离集成 Worktree，解决并提交后才快进主分支',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t),parent=tempDir(t),worktree=path.join(parent,'task-worktree');
  fs.writeFileSync(path.join(repo,'target.txt'),'base\n');
  for(const args of [['add','target.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','base target']])assert.equal(spawnSync('git',['-C',repo,...args],{encoding:'utf8'}).status,0);
  const target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  assert.equal(spawnSync('git',['-C',repo,'worktree','add','--detach',worktree,target],{encoding:'utf8'}).status,0);
  const prepared=prepareTask({cwd:worktree,stateRoot,intent:'修改普通功能',acceptance:['功能正确'],scope:'.',integrationTarget:target});
  fs.writeFileSync(path.join(worktree,'target.txt'),'task\n');
  for(const args of [['add','target.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','task result']])assert.equal(spawnSync('git',['-C',worktree,...args],{encoding:'utf8'}).status,0);
  const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,worktree)});
  fs.writeFileSync(path.join(repo,'target.txt'),'main\n');
  for(const args of [['add','target.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','main result']])assert.equal(spawnSync('git',['-C',repo,...args],{encoding:'utf8'}).status,0);
  const mainBefore=spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
  const conflicted=integrateTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(conflicted.task.status,'ready_to_integrate');
  assert.equal(conflicted.task.integration.status,'conflict');
  assert.ok(conflicted.task.integration.conflictFiles.includes('target.txt'));
  assert.equal(spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),mainBefore);
  const integrationWorktree=conflicted.task.integration.integrationWorktree;
  fs.writeFileSync(path.join(integrationWorktree,'target.txt'),'resolved\n');
  assert.equal(spawnSync('git',['-C',integrationWorktree,'add','target.txt'],{encoding:'utf8'}).status,0);
  const continued=spawnSync('git',['-C',integrationWorktree,'-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','-c','core.editor=true','cherry-pick','--continue'],{encoding:'utf8'});
  assert.equal(continued.status,0,continued.stderr);
  const integrated=integrateTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(integrated.task.status,'waiting_acceptance');
  assert.equal(fs.readFileSync(path.join(repo,'target.txt'),'utf8').replaceAll('\r\n','\n'),'resolved\n');
  assert.notEqual(spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),mainBefore);
});

test('部分补丁已进入目标分支时不把空 cherry-pick 误判为完成',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t),parent=tempDir(t),worktree=path.join(parent,'task-worktree');
  const target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  assert.equal(spawnSync('git',['-C',repo,'worktree','add','--detach',worktree,target],{encoding:'utf8'}).status,0);
  const prepared=prepareTask({cwd:worktree,stateRoot,intent:'修改普通功能',acceptance:['功能正确'],scope:'.',integrationTarget:target});
  fs.writeFileSync(path.join(worktree,'one.txt'),'one\n');
  for(const args of [['add','one.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','task one']])assert.equal(spawnSync('git',['-C',worktree,...args],{encoding:'utf8'}).status,0);
  const firstCommit=spawnSync('git',['-C',worktree,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
  fs.writeFileSync(path.join(worktree,'two.txt'),'two\n');
  for(const args of [['add','two.txt'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','task two']])assert.equal(spawnSync('git',['-C',worktree,...args],{encoding:'utf8'}).status,0);
  const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,worktree)});
  assert.equal(delivered.task.status,'ready_to_integrate');
  assert.equal(spawnSync('git',['-C',repo,'cherry-pick',firstCommit],{encoding:'utf8'}).status,0);
  const before=spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
  const paused=integrateTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(paused.task.status,'ready_to_integrate');
  assert.equal(paused.task.integration.status,'conflict_resolution');
  assert.equal(paused.task.verification.stopReason,'integration-cherry-pick-in-progress');
  assert.equal(spawnSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),before);
  const candidate=paused.task.integration.integrationWorktree;
  const skipped=spawnSync('git',['-C',candidate,'cherry-pick','--skip'],{encoding:'utf8'});
  assert.equal(skipped.status,0,skipped.stderr);
  const integrated=integrateTask({stateRoot,taskId:prepared.task.taskId});
  assert.equal(integrated.task.status,'waiting_acceptance');
  assert.equal(fs.readFileSync(path.join(repo,'two.txt'),'utf8').trim(),'two');
});

test('prepareTask 保存重复精确 Scope 并按任一 Scope 校验 ChangeSet',t=>{const repo=gitRepo(t),stateRoot=tempDir(t);fs.mkdirSync(path.join(repo,'src'));const prepared=prepareTask({cwd:repo,stateRoot,intent:'修改两个局部路径',acceptance:['功能正确'],scope:['src','tests','src']});assert.deepEqual(prepared.task.authorization.scope.map(item=>item.path),['src','tests']);fs.writeFileSync(path.join(repo,'src','feature.js'),'ok\n');assert.equal(deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)}).task.status,'waiting_acceptance');fs.writeFileSync(path.join(repo,'outside.txt'),'outside\n');assert.throws(()=>deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile:taskCheck(t,repo)}),/outside\.txt/u);});

test('detached worktree 成果必须提交，目标 HEAD 变化后重验才能验收',t=>{
  const repo=gitRepo(t),stateRoot=tempDir(t),parent=tempDir(t),worktree=path.join(parent,'worktree');
  const target=spawnSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).stdout.trim();
  const added=spawnSync('git',['-C',repo,'worktree','add','--detach',worktree,target],{encoding:'utf8'});
  assert.equal(added.status,0,added.stderr);
  const prepared=prepareTask({cwd:worktree,stateRoot,intent:'修改普通功能',acceptance:['功能正确'],scope:'.',integrationTarget:target});
  fs.writeFileSync(path.join(worktree,'target.txt'),'integrated\n');
  fs.writeFileSync(path.join(worktree,'tests','acceptance.test.mjs'),"import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\ntest('A1 proof',()=>assert.equal(fs.readFileSync('target.txt','utf8').trim(),'integrated'));\n");
  const taskCheckFile=taskCheck(t,worktree);
  const uncommitted=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile});
  assert.equal(uncommitted.task.status,'verifying');
  assert.ok(uncommitted.task.deliveryDecision.reasons.includes('uncommitted-task-changes'));
  for(const args of [['add','target.txt','tests/acceptance.test.mjs'],['-c','user.email=test@example.com','-c','user.name=AI R&D OS Test','commit','-m','agent result']]){
    const result=spawnSync('git',['-C',worktree,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  const delivered=deliverTask({stateRoot,taskId:prepared.task.taskId,taskCheckFile});
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
  fs.writeFileSync(path.join(repo, 'tests', 'r.test.js'), "const test=require('node:test');\nfor(const id of ['R1','R2','R3','R4','R5'])test(`参考行为 ${id}`,()=>{});\n");
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
  fs.writeFileSync(path.join(repo, 'tests', 'target.test.js'), "const test=require('node:test');test('目标功能正确',()=>{});test('另一目标功能正确',()=>{});\n");
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
    schemaVersion: 2,
    checks: [{
      name: 'target-A1',
      runner: 'node-test',
      cases: [
        {
          id: 'target-feature', acceptanceIds: ['A1'], covers: ['behavior'],
          testFile: 'tests/target.test.js', testName: '目标功能正确',
        },
        {
          id: 'other-feature', acceptanceIds: ['A2'], covers: ['behavior'],
          testFile: 'tests/target.test.js', testName: '另一目标功能正确',
        },
      ],
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
  assert.equal(delivered.task.status, 'waiting_acceptance');
  assert.equal(delivered.task.verification.missingAcceptance.includes('A2'), false);
  assert.equal(delivered.task.verification.missingAcceptance.includes('A1'), false);
  const checkEvidence = delivered.task.evidence.find((item) => item.source?.testFiles?.length && item.acceptanceIds.includes('A1'));
  assert.ok(checkEvidence);
  assert.equal(checkEvidence.source.type, 'command');
  assert.equal(checkEvidence.source.actor, 'ai-system');
  assert.deepEqual(checkEvidence.source.testFiles, ['tests/target.test.js']);
  assert.deepEqual(checkEvidence.result.caseSummary, { declared: 1, passed: 1, failed: 0, malformedEvents: 0 });
  assert.equal(checkEvidence.result.caseResults[0].executed[0].name, '目标功能正确');
  assert.ok(delivered.task.verification.systemEvidenceHashes.includes(checkEvidence.payloadHash));
});

test('多个用例的 Acceptance 和 Cover 保持逐 case 归因', (t) => {
  const repo = preservationRepo(t, []);
  fs.writeFileSync(path.join(repo, 'tests', 'target.test.js'), [
    "const test=require('node:test');",
    "test('主流程通过',()=>{});",
    "test('主流程拒绝路径通过',()=>{});",
    "test('另一验收的拒绝路径通过',()=>{});",
    '',
  ].join('\n'));
  for (const args of [['add', '.'], ['-c', 'user.email=t@e.c', '-c', 'user.name=T', 'commit', '-m', 'case-mapping']]) {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  const stateRoot = tempDir(t);
  const prepared = prepareTask({
    cwd: repo,
    stateRoot,
    intent: '修复退款流程',
    acceptance: [
      { id: 'A1', description: '主流程和拒绝路径均正确', requiredCovers: ['behavior', 'negative-path'] },
      { id: 'A2', description: '另一拒绝路径正确', requiredCovers: ['negative-path'] },
    ],
    scope: '.',
  });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const delivered = deliverTask({
    stateRoot,
    taskId: prepared.task.taskId,
    taskCheckFile: writeJson(t, { schemaVersion: 2, checks: [{
      name: 'case-boundaries', runner: 'node-test',
      cases: [
        { id: 'a1-behavior', acceptanceIds: ['A1'], covers: ['behavior'], testFile: 'tests/target.test.js', testName: '主流程通过' },
        { id: 'a1-negative', acceptanceIds: ['A1'], covers: ['negative-path'], testFile: 'tests/target.test.js', testName: '主流程拒绝路径通过' },
        { id: 'a2-negative', acceptanceIds: ['A2'], covers: ['negative-path'], testFile: 'tests/target.test.js', testName: '另一验收的拒绝路径通过' },
      ],
      estimatedCost: 'very-low', timeoutMs: 5000,
    }] }, 'case-boundaries.json'),
  });
  assert.equal(delivered.task.status, 'waiting_acceptance');
  assert.deepEqual(delivered.task.verification.missingAcceptance, []);
  const caseEvidence = delivered.task.evidence.filter((item) => item.source?.cases?.length);
  assert.equal(caseEvidence.length, 3);
  assert.deepEqual(caseEvidence.find((item) => item.acceptanceIds.includes('A1') && item.covers.includes('behavior')).covers, ['behavior']);
  assert.deepEqual(caseEvidence.find((item) => item.acceptanceIds.includes('A1') && item.covers.includes('negative-path')).acceptanceIds, ['A1']);
  assert.deepEqual(caseEvidence.find((item) => item.acceptanceIds.includes('A2')).acceptanceIds, ['A2']);
});

test('Task Check 零命中、skip 和 todo 均不能证明 Acceptance', (t) => {
  const samples = [
    { testName: '不存在的目标用例', source: "const test=require('node:test');test('实际用例',()=>{});\n" },
    { testName: '目标用例跳过', source: "const test=require('node:test');test('目标用例跳过',{skip:true},()=>{});\n" },
    { testName: '目标用例待办', source: "const test=require('node:test');test('目标用例待办',{todo:true},()=>{});\n" },
  ];
  for (const sample of samples) {
    const repo = preservationRepo(t, []);
    fs.writeFileSync(path.join(repo, 'tests', 'target.test.js'), sample.source);
    for (const args of [['add', '.'], ['-c', 'user.email=t@e.c', '-c', 'user.name=T', 'commit', '-m', 'target-case']]) {
      const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    }
    const stateRoot = tempDir(t);
    const prepared = prepareTask({ cwd: repo, stateRoot, intent: '修复普通功能', acceptance: ['功能正确'], scope: '.' });
    fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
    const delivered = deliverTask({
      stateRoot,
      taskId: prepared.task.taskId,
      taskCheckFile: writeJson(t, { schemaVersion: 2, checks: [{
        name: `reject-${sample.testName}`,
        runner: 'node-test',
        cases: [{
          id: 'target-case', acceptanceIds: ['A1'], covers: ['behavior'],
          testFile: 'tests/target.test.js', testName: sample.testName,
        }],
        estimatedCost: 'very-low', timeoutMs: 5000,
      }] }, 'task-checks.json'),
    });
    assert.notEqual(delivered.task.status, 'waiting_acceptance', sample.testName);
    assert.ok(delivered.task.verification.missingAcceptance.includes('A1'), sample.testName);
    assert.equal(delivered.task.evidence.some((item) => item.acceptanceIds?.includes('A1')), false, sample.testName);
    assert.equal(delivered.task.verification.firstFailure.name, `reject-${sample.testName}`);
  }
});

test('重构遗漏 R4 时不执行部分证明并保持全部行为缺口可见', (t) => {
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
    schemaVersion: 2,
    checks: ['R1', 'R2', 'R3', 'R5'].map((id) => ({
      name: `check-${id}`,
      runner: 'node-test',
      cases: [{
        id: `case-${id}`, acceptanceIds: [ids[id]], covers: ['behavior'],
        testFile: 'tests/r.test.js', testName: `参考行为 ${id}`,
      }],
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
    verifiedBehaviorCount: 0,
    missingBehaviorIds: ['R1', 'R2', 'R3', 'R4', 'R5'],
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
  const requestedId = prepared.task.acceptance.find((item) => !item.referenceBehaviorId).id;
  const taskCheckFile = writeJson(t, {
    schemaVersion: 2,
    checks: [{
      name: 'requested-outcome',
      runner: 'node-test',
      cases: [{
        id: 'requested-outcome', acceptanceIds: [requestedId], covers: ['behavior'],
        testFile: 'tests/acceptance.test.mjs', testName: 'A1 proof',
      }],
      estimatedCost: 'very-low',
      timeoutMs: 5000,
    }, ...['R1', 'R2', 'R3', 'R4', 'R5'].map((id) => ({
      name: `bind-${id}`,
      runner: 'node-test',
      cases: [{
        id: `case-${id}`, acceptanceIds: [ids[id]], covers: ['behavior'],
        testFile: 'tests/r.test.js', testName: `参考行为 ${id}`,
      }],
      estimatedCost: 'very-low',
      timeoutMs: 5000,
    }))],
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
