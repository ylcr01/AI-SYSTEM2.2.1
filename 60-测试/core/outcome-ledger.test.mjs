// BR-AIRD-ROUTE-001 BR-AIRD-METRICS-001
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  diagnoseLightOutcomeLedger,
  readLightOutcomeEvents,
  readLightOutcomeTasks,
  recordLightDelivery,
  recordLightFollowUp,
} from '../../40-脚本/lib/outcome-ledger.mjs';
import { captureRepositoryIdentity, computeChangeSet } from '../../40-脚本/lib/git-state.mjs';
import { summarizeOutcomeMetrics } from '../../40-脚本/lib/outcome-metrics.mjs';
import { normalizePath } from '../../40-脚本/lib/registry.mjs';
import { gitRepo, tempDir } from '../helpers.mjs';

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding:'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const EVALUATION_CONTEXT = {
  schemaVersion:1,
  system:{ version:'2.3.0', commit:'a'.repeat(40), dirty:false },
  model:'test-model',
  reasoningEffort:'high',
  executionEnvironment:'local-direct',
  runtime:{ nodeVersion:process.version, platform:process.platform, arch:process.arch },
};

function verificationBinding(repo, baselineHead = git(repo, ['rev-parse', 'HEAD'])) {
  const identity = captureRepositoryIdentity(repo);
  const changeSet = computeChangeSet({
    schemaVersion:4,
    gitRoot:identity.gitRoot,
    gitCommonDir:identity.gitCommonDir,
    head:baselineHead,
    files:[],
  });
  assert.ok(changeSet.semanticFingerprint);
  return {
    baselineHead,
    baselineGitRoot:identity.gitRoot,
    baselineGitCommonDir:identity.gitCommonDir,
    verifiedChangeFingerprint:changeSet.semanticFingerprint,
  };
}

function commitVerifiedFile(repo, file, content, message) {
  const baselineHead = git(repo, ['rev-parse', 'HEAD']);
  fs.writeFileSync(`${repo}/${file}`, content);
  const binding = verificationBinding(repo, baselineHead);
  git(repo, ['add', file]);
  git(repo, ['-c', 'user.email=test@example.com', '-c', 'user.name=AI R&D OS Test', 'commit', '-m', message]);
  return { ...binding, commit:git(repo, ['rev-parse', 'HEAD']) };
}

test('轻量直达只有工作树干净且 HEAD 已本地提交时才形成结果样本', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  fs.writeFileSync(`${repo}/README.md`, '# changed\n');
  const baseline = git(repo, ['rev-parse', 'HEAD']);
  const binding = verificationBinding(repo, baseline);
  assert.throws(() => recordLightDelivery({
    stateRoot, cwd:repo, commit:baseline, ...binding, problemType:'bugfix', scope:['README.md'],
  }), /工作树干净/u);
  git(repo, ['add', 'README.md']);
  git(repo, ['-c', 'user.email=test@example.com', '-c', 'user.name=AI R&D OS Test', 'commit', '-m', 'fix docs']);
  const head = git(repo, ['rev-parse', 'HEAD']);
  assert.throws(() => recordLightDelivery({
    stateRoot, cwd:repo, commit:head, ...binding, problemType:'bugfix', scope:['src'],
  }), /Scope 外文件/u);
  const delivered = recordLightDelivery({
    stateRoot,
    cwd:repo,
    commit:head,
    ...binding,
    problemType:'bugfix',
    evaluationContext:EVALUATION_CONTEXT,
  });
  assert.equal(delivered.state, 'delivered');
  assert.equal(delivered.recorded, true);
  assert.equal(delivered.idempotent, false);
  assert.equal(delivered.localCommit, head);
  assert.ok(delivered.taskId.startsWith('result-'));
  const [task] = readLightOutcomeTasks({ stateRoot });
  assert.equal(task.taskId, delivered.taskId);
  assert.deepEqual(task.evaluationContext, EVALUATION_CONTEXT);
  const [event] = readLightOutcomeEvents({ stateRoot });
  assert.equal(event.baselineHead, baseline);
  assert.equal(event.verifiedChangeFingerprint, binding.verifiedChangeFingerprint);
  assert.deepEqual(event.scopes, ['README.md']);
  assert.deepEqual(event.changedFiles, ['README.md']);
  assert.deepEqual(event.evaluationContext, EVALUATION_CONTEXT);
});

test('轻量结果把多次相关沟通计为同一样本的更高完成轮次', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const verified = commitVerifiedFile(repo, 'README.md', '# feature\n', 'implement feature');
  const delivered = recordLightDelivery({ stateRoot, cwd:repo, ...verified, problemType:'feature', scope:['.'] });
  const common = { stateRoot, taskId:delivered.taskId, deliveryId:delivered.continuation.deliveryId };
  recordLightFollowUp({ ...common, observationId:'turn-1', kind:'related-question' });
  recordLightFollowUp({ ...common, observationId:'turn-2', kind:'related-question' });
  const duplicate = recordLightFollowUp({ ...common, observationId:'turn-2', kind:'related-question' });
  assert.equal(duplicate.idempotent, true);
  recordLightFollowUp({ ...common, observationId:'turn-3', kind:'topic-advance' });
  const tasks = readLightOutcomeTasks({ stateRoot, gitRoot:repo });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, 'closed');
  const summary = summarizeOutcomeMetrics(tasks, { now:'2026-08-31T00:00:00.000Z' });
  assert.deepEqual(summary.completionRounds.exact, [{ round:3, count:1, rate:1 }]);
});

test('缺陷退回后的轻量修改继续同一结果编号，不新增成功样本', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const firstVerified = commitVerifiedFile(repo, 'README.md', '# first fix\n', 'first fix');
  const first = recordLightDelivery({ stateRoot, cwd:repo, ...firstVerified, problemType:'bugfix', scope:['.'] });
  recordLightFollowUp({
    stateRoot,
    taskId:first.taskId,
    deliveryId:first.continuation.deliveryId,
    observationId:'return-1',
    kind:'defect-return',
  });
  const secondVerified = commitVerifiedFile(repo, 'README.md', '# fixed again\n', 'fix again');
  const second = recordLightDelivery({
    stateRoot,
    cwd:repo,
    ...secondVerified,
    problemType:'bugfix',
    taskId:first.taskId,
    scope:['README.md'],
  });
  assert.equal(second.taskId, first.taskId);
  assert.notEqual(second.continuation.deliveryId, first.continuation.deliveryId);
  const tasks = readLightOutcomeTasks({ stateRoot });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].outcomeMetrics.relatedFollowUpCount, 1);
  assert.equal(tasks[0].outcomeMetrics.deliveryAttemptCount, 2);
});

test('轻量结果按 gitCommonDir 归并同仓 linked Worktree，并允许缺陷续写', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const firstVerified = commitVerifiedFile(repo, 'README.md', '# first linked fix\n', 'first linked fix');
  const firstHead = firstVerified.commit;
  const first = recordLightDelivery({ stateRoot, cwd:repo, ...firstVerified, problemType:'bugfix', scope:['.'] });
  const [deliveryEvent] = readLightOutcomeEvents({ stateRoot });
  const primaryIdentity = captureRepositoryIdentity(repo);
  assert.equal(normalizePath(deliveryEvent.gitRoot), normalizePath(primaryIdentity.gitRoot));
  assert.equal(normalizePath(deliveryEvent.gitCommonDir), normalizePath(primaryIdentity.gitCommonDir));

  recordLightFollowUp({
    stateRoot,
    taskId:first.taskId,
    deliveryId:first.continuation.deliveryId,
    observationId:'linked-return-1',
    kind:'defect-return',
  });
  const worktreeRoot = tempDir(t, 'ai-rd-os-worktree-parent-');
  const linked = `${worktreeRoot}/linked`;
  git(repo, ['worktree', 'add', '--detach', linked, firstHead]);
  const secondVerified = commitVerifiedFile(linked, 'README.md', '# fixed from linked worktree\n', 'fix from linked worktree');
  const secondHead = secondVerified.commit;
  const second = recordLightDelivery({
    stateRoot,
    cwd:linked,
    ...secondVerified,
    problemType:'bugfix',
    taskId:first.taskId,
    scope:['README.md'],
  });
  assert.equal(second.taskId, first.taskId);

  const linkedIdentity = captureRepositoryIdentity(linked);
  assert.notEqual(linkedIdentity.gitRoot, primaryIdentity.gitRoot);
  assert.equal(normalizePath(linkedIdentity.gitCommonDir), normalizePath(primaryIdentity.gitCommonDir));
  const tasks = readLightOutcomeTasks({ stateRoot, repositoryIdentity:linkedIdentity });
  assert.deepEqual(tasks.map((task) => task.taskId), [first.taskId]);
  assert.equal(normalizePath(tasks[0].baseline.gitCommonDir), normalizePath(primaryIdentity.gitCommonDir));
  assert.equal(tasks[0].integration.resultCommit, secondHead);
});

test('历史轻量事件缺少 gitCommonDir 时只按精确 gitRoot 回退', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const head = git(repo, ['rev-parse', 'HEAD']);
  const taskId = 'result-legacy-root-only';
  fs.writeFileSync(`${stateRoot}/结果事件.jsonl`, `${JSON.stringify({
    schemaVersion:1,
    event:'delivery',
    taskId,
    deliveryId:'delivery-legacy-root-only',
    observedAt:'2026-08-31T00:00:00.000Z',
    gitRoot:repo,
    commit:head,
    scopes:['.'],
    changedFiles:['README.md'],
    problemType:'bugfix',
    eligible:true,
    exclusionReason:null,
  })}\n`);

  const primaryIdentity = captureRepositoryIdentity(repo);
  assert.deepEqual(
    readLightOutcomeTasks({ stateRoot, repositoryIdentity:primaryIdentity }).map((task) => task.taskId),
    [taskId],
  );
  assert.equal(readLightOutcomeTasks({ stateRoot })[0].evaluationContext, null);
  assert.equal(diagnoseLightOutcomeLedger({ stateRoot }).ok, true);
  const worktreeRoot = tempDir(t, 'ai-rd-os-legacy-worktree-parent-');
  const linked = `${worktreeRoot}/linked`;
  git(repo, ['worktree', 'add', '--detach', linked, head]);
  const linkedIdentity = captureRepositoryIdentity(linked);
  assert.equal(normalizePath(linkedIdentity.gitCommonDir), normalizePath(primaryIdentity.gitCommonDir));
  assert.deepEqual(readLightOutcomeTasks({ stateRoot, repositoryIdentity:linkedIdentity }), []);
});

test('轻量交付提交必须保持验证通过的 ChangeSet 语义指纹', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const baselineHead = git(repo, ['rev-parse', 'HEAD']);
  fs.writeFileSync(`${repo}/README.md`, '# verified content\n');
  const binding = verificationBinding(repo, baselineHead);
  fs.writeFileSync(`${repo}/README.md`, '# substituted after verification\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['-c', 'user.email=test@example.com', '-c', 'user.name=AI R&D OS Test', 'commit', '-m', 'substitute after verification']);
  const commit = git(repo, ['rev-parse', 'HEAD']);
  assert.throws(() => recordLightDelivery({
    stateRoot,
    cwd:repo,
    commit,
    ...binding,
    problemType:'bugfix',
    scope:['README.md'],
  }), /语义指纹不一致/u);
  assert.deepEqual(readLightOutcomeEvents({ stateRoot }), []);
});

test('同一仓库提交的轻量交付重试幂等，冲突元数据失败关闭', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const verified = commitVerifiedFile(repo, 'README.md', '# idempotent delivery\n', 'idempotent delivery');
  const input = {
    stateRoot,
    cwd:repo,
    ...verified,
    problemType:'bugfix',
    scope:['README.md'],
    evaluationContext:EVALUATION_CONTEXT,
  };
  const first = recordLightDelivery(input);
  const retry = recordLightDelivery(input);
  assert.equal(retry.taskId, first.taskId);
  assert.equal(retry.continuation.deliveryId, first.continuation.deliveryId);
  assert.equal(retry.recorded, false);
  assert.equal(retry.idempotent, true);
  const explicitRetry = recordLightDelivery({ ...input, taskId:first.taskId });
  assert.equal(explicitRetry.continuation.deliveryId, first.continuation.deliveryId);
  assert.equal(explicitRetry.idempotent, true);
  assert.throws(() => recordLightDelivery({ ...input, scope:['.'] }), /重试元数据.*冲突/u);
  assert.equal(readLightOutcomeEvents({ stateRoot }).length, 1);
  assert.equal(diagnoseLightOutcomeLedger({ stateRoot }).ok, true);
});

test('轻量结果账本诊断如实报告无效 JSON、事件结构与孤立后续', (t) => {
  const stateRoot = tempDir(t);
  const orphan = {
    schemaVersion:1,
    event:'follow-up',
    taskId:'result-orphan',
    deliveryId:'delivery-missing',
    observationId:'turn-orphan',
    kind:'related-question',
    observedAt:'2026-08-31T00:00:00.000Z',
  };
  fs.writeFileSync(`${stateRoot}/结果事件.jsonl`, [
    '{not-json}',
    JSON.stringify({ schemaVersion:1, event:'delivery', taskId:'invalid' }),
    JSON.stringify(orphan),
    '',
  ].join('\n'));
  const diagnosis = diagnoseLightOutcomeLedger({ stateRoot });
  assert.equal(diagnosis.readOnly, true);
  assert.equal(diagnosis.ok, false);
  assert.equal(diagnosis.count, 3);
  assert.deepEqual(diagnosis.diagnostics.map((item) => item.code), [
    'invalid-json',
    'invalid-delivery-shape',
    'orphan-follow-up',
  ]);
});
