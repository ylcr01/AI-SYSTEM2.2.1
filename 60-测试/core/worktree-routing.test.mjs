import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertTaskWorktreeBaseline, captureBaseline } from '../../40-脚本/lib/git-state.mjs';
import { preflightWorkspace } from '../../40-脚本/lib/task-runner.mjs';
import { gitRepo, runNode, tempDir } from '../helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TASK = path.join(ROOT, '40-脚本', 'task.mjs');

test('正式 Task 的 Local baseline 被稳定路由错误拒绝', (t) => {
  const repo = gitRepo(t);
  assert.throws(() => assertTaskWorktreeBaseline(captureBaseline(repo)), (error) => {
    assert.equal(error.code, 'WORKTREE_REQUIRED');
    assert.match(error.message, /Codex 桌面端/u);
    assert.match(error.message, /git worktree add --detach/u);
    assert.match(error.message, /--integration-target/u);
    assert.match(error.message, /不是用户阻塞/u);
    assert.match(error.message, /continuity=ephemeral/u);
    assert.equal(error.routing.localFallbackAllowed, false);
    return true;
  });
});

test('预检把干净 Local 路由为轻量直达，把脏 Local 路由到新 Worktree', (t) => {
  const repo = gitRepo(t), stateRoot = tempDir(t);
  const worktreesBefore = spawnSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding:'utf8' }).stdout;
  const clean = preflightWorkspace({ cwd:repo, stateRoot });
  assert.equal(clean.schemaVersion, 2);
  assert.equal(clean.workspace.kind, 'local');
  assert.equal(clean.workspace.clean, true);
  assert.ok(clean.workspace.branch);
  assert.deepEqual(clean.writeRouting, {
    recommended:'local-direct', localDirectEligible:true, reasonCodes:[],
  });
  assert.equal(fs.existsSync(path.join(stateRoot, '进行中')), false);
  assert.equal(spawnSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding:'utf8' }).stdout, worktreesBefore);
  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'user change\n');
  const dirty = preflightWorkspace({ cwd:repo, stateRoot });
  assert.equal(dirty.workspace.clean, false);
  assert.deepEqual(dirty.writeRouting, {
    recommended:'new-worktree', localDirectEligible:false, reasonCodes:['workspace-dirty'],
  });
});

test('detached Worktree baseline 可通过门禁且与 Local Git 目录隔离', (t) => {
  const repo = gitRepo(t);
  const worktree = path.join(tempDir(t), 'task-worktree');
  const added = spawnSync('git', ['-C', repo, 'worktree', 'add', '--detach', worktree, 'HEAD'], { encoding:'utf8' });
  assert.equal(added.status, 0, added.stderr);
  try {
    const baseline = captureBaseline(worktree);
    assert.equal(baseline.linkedWorktree, true);
    assert.equal(assertTaskWorktreeBaseline(baseline), baseline);
    assert.notEqual(fs.realpathSync.native(baseline.gitDir), fs.realpathSync.native(baseline.gitCommonDir));
    const route = preflightWorkspace({ cwd:worktree, stateRoot:tempDir(t) });
    assert.equal(route.writeRouting.recommended, 'current-worktree');
    assert.equal(route.writeRouting.localDirectEligible, false);
  } finally {
    spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktree], { encoding:'utf8' });
  }
});

test('生产 CLI 在 Local 准备写任务时失败关闭', (t) => {
  const repo = gitRepo(t);
  const result = runNode(TASK, [
    '准备', '--cwd', repo, '--intent', '修改普通功能', '--acceptance', '功能正确',
    '--scope', '.', '--state-root', tempDir(t),
  ], { cwd:ROOT, env:{ NODE_TEST_CONTEXT:'' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WORKTREE_REQUIRED/u);
  assert.match(result.stderr, /不是用户阻塞/u);
});
