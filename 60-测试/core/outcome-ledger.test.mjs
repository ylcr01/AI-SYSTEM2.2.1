// BR-AIRD-ROUTE-001 BR-AIRD-METRICS-001
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  readLightOutcomeTasks,
  recordLightDelivery,
  recordLightFollowUp,
} from '../../40-脚本/lib/outcome-ledger.mjs';
import { summarizeOutcomeMetrics } from '../../40-脚本/lib/outcome-metrics.mjs';
import { gitRepo, tempDir } from '../helpers.mjs';

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding:'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('轻量直达只有工作树干净且 HEAD 已本地提交时才形成结果样本', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  fs.writeFileSync(`${repo}/README.md`, '# changed\n');
  const baseline = git(repo, ['rev-parse', 'HEAD']);
  assert.throws(() => recordLightDelivery({
    stateRoot, cwd:repo, commit:baseline, problemType:'bugfix', scope:['README.md'],
  }), /工作树干净/u);
  git(repo, ['add', 'README.md']);
  git(repo, ['-c', 'user.email=test@example.com', '-c', 'user.name=AI R&D OS Test', 'commit', '-m', 'fix docs']);
  const head = git(repo, ['rev-parse', 'HEAD']);
  assert.throws(() => recordLightDelivery({
    stateRoot, cwd:repo, commit:head, problemType:'bugfix', scope:['src'],
  }), /Scope 外文件/u);
  const delivered = recordLightDelivery({ stateRoot, cwd:repo, commit:head, problemType:'bugfix', scope:['README.md'] });
  assert.equal(delivered.state, 'delivered');
  assert.equal(delivered.localCommit, head);
  assert.ok(delivered.taskId.startsWith('result-'));
  assert.deepEqual(readLightOutcomeTasks({ stateRoot }).map((item) => item.taskId), [delivered.taskId]);
});

test('轻量结果把多次相关沟通计为同一样本的更高完成轮次', (t) => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const head = git(repo, ['rev-parse', 'HEAD']);
  const delivered = recordLightDelivery({ stateRoot, cwd:repo, commit:head, problemType:'feature', scope:['.'] });
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
  const firstHead = git(repo, ['rev-parse', 'HEAD']);
  const first = recordLightDelivery({ stateRoot, cwd:repo, commit:firstHead, problemType:'bugfix', scope:['.'] });
  recordLightFollowUp({
    stateRoot,
    taskId:first.taskId,
    deliveryId:first.continuation.deliveryId,
    observationId:'return-1',
    kind:'defect-return',
  });
  fs.writeFileSync(`${repo}/README.md`, '# fixed again\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['-c', 'user.email=test@example.com', '-c', 'user.name=AI R&D OS Test', 'commit', '-m', 'fix again']);
  const secondHead = git(repo, ['rev-parse', 'HEAD']);
  const second = recordLightDelivery({
    stateRoot,
    cwd:repo,
    commit:secondHead,
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
