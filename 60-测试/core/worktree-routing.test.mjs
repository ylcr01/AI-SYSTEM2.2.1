import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertTaskWorktreeBaseline, captureBaseline } from '../../40-脚本/lib/git-state.mjs';
import { preflightWorkspace, verifyLocalDirect } from '../../40-脚本/lib/task-runner.mjs';
import { gitRepo, runNode, tempDir } from '../helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TASK = path.join(ROOT, '40-脚本', 'task.mjs');

function directBaselineArgs(preflight) {
  return {
    baselineHead:preflight.directBaseline.head,
    baselineGitRoot:preflight.directBaseline.gitRoot,
    baselineGitCommonDir:preflight.directBaseline.gitCommonDir,
    ...(preflight.directBaseline.detached
      ? { baselineDetached:true }
      : { baselineBranch:preflight.directBaseline.branch }),
  };
}

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
  assert.equal(dirty.directBaseline, null);
  assert.deepEqual(dirty.writeRouting, {
    recommended:'new-worktree', localDirectEligible:false, reasonCodes:['workspace-dirty'],
  });
});

test('可选直达终检从真实 ChangeSet 得出范围并保持 Git 身份', (t) => {
  const repo = gitRepo(t), stateRoot = tempDir(t);
  const preflight = preflightWorkspace({ cwd:repo, stateRoot });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'local direct\n');
  const verified = verifyLocalDirect({
    cwd:repo,
    stateRoot,
    ...directBaselineArgs(preflight),
    intent:'修改普通功能',
  });
  assert.equal(verified.decision, 'allow');
  assert.deepEqual(verified.changeSet.files.map(item => item.path), ['target.txt']);
  assert.deepEqual(verified.baselineIdentity, {
    head:preflight.directBaseline.head,
    gitRoot:preflight.directBaseline.gitRoot,
    gitCommonDir:preflight.directBaseline.gitCommonDir,
  });
  assert.equal(verified.verifiedSemanticFingerprint,verified.changeSet.semanticFingerprint);
  assert.match(verified.verifiedSemanticFingerprint,/^[a-f0-9]{64}$/u);
  assert.equal(verified.classification.executionRoute, 'local-direct-candidate');
  assert.deepEqual(verified.scope, ['target.txt']);
  assert.equal(verified.scopeSource, 'change-set');
});

test('用户显式限定 Scope 时终检仍拒绝越界修改', (t) => {
  const repo = gitRepo(t), stateRoot = tempDir(t);
  const preflight = preflightWorkspace({ cwd:repo, stateRoot });
  fs.writeFileSync(path.join(repo, 'target.txt'), 'allowed\n');
  fs.writeFileSync(path.join(repo, 'outside.txt'), 'outside\n');
  assert.throws(() => verifyLocalDirect({
    cwd:repo,
    stateRoot,
    ...directBaselineArgs(preflight),
    intent:'只修改目标文件',
    scope:'target.txt',
  }), (error) => error.code === 'LOCAL_DIRECT_SCOPE_VIOLATION');
});

test('普通路径和文件类型不再自动升级正式任务', (t) => {
  const repo = gitRepo(t), stateRoot = tempDir(t);
  const preflight = preflightWorkspace({ cwd:repo, stateRoot });
  fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive:true });
  fs.writeFileSync(path.join(repo, '.github', 'workflows', 'release.yml'), 'name: release\n');
  const verified = verifyLocalDirect({
    cwd:repo,
    stateRoot,
    ...directBaselineArgs(preflight),
    intent:'调整配置',
  });
  assert.equal(verified.classification.controlMode, 'standard');
  assert.equal(verified.classification.executionRoute, 'local-direct-candidate');
  assert.deepEqual(verified.scope, ['.github/workflows/release.yml']);
});

test('轻量直达终检拒绝同一提交和分支下的另一个 Git 仓库', (t) => {
  const repo = gitRepo(t), stateRoot = tempDir(t), clone = path.join(tempDir(t), 'clone');
  const preflight = preflightWorkspace({ cwd:repo, stateRoot });
  const cloned = spawnSync('git', ['clone', '--quiet', repo, clone], { encoding:'utf8' });
  assert.equal(cloned.status, 0, cloned.stderr);
  assert.throws(() => verifyLocalDirect({
    cwd:clone,
    stateRoot,
    ...directBaselineArgs(preflight),
    intent:'修改普通功能',
    scope:'.',
  }), (error) => {
    assert.equal(error.code, 'LOCAL_DIRECT_IDENTITY_CHANGED');
    return true;
  });
});

test('轻量直达终检要求显式分支或 detached 身份且拒绝预检后切分支', (t) => {
  const repo = gitRepo(t), stateRoot = tempDir(t);
  const preflight = preflightWorkspace({ cwd:repo, stateRoot });
  assert.throws(() => verifyLocalDirect({
    cwd:repo,
    stateRoot,
    baselineHead:preflight.directBaseline.head,
    baselineGitRoot:preflight.directBaseline.gitRoot,
    baselineGitCommonDir:preflight.directBaseline.gitCommonDir,
    intent:'修改普通功能',
    scope:'.',
  }), (error) => error.code === 'LOCAL_DIRECT_BASELINE_REQUIRED');
  const switched = spawnSync('git', ['-C', repo, 'switch', '-c', 'codex/local-direct-other'], { encoding:'utf8' });
  assert.equal(switched.status, 0, switched.stderr);
  assert.throws(() => verifyLocalDirect({
    cwd:repo,
    stateRoot,
    ...directBaselineArgs(preflight),
    intent:'修改普通功能',
    scope:'.',
  }), (error) => error.code === 'LOCAL_DIRECT_HEAD_CHANGED');
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
    assert.equal(route.writeRouting.localDirectEligible, true);
    assert.equal(route.directBaseline.detached, true);
    fs.writeFileSync(path.join(worktree, 'target.txt'), 'isolated direct\n');
    const verified = verifyLocalDirect({
      cwd:worktree,
      stateRoot:tempDir(t),
      ...directBaselineArgs(route),
      intent:'修改普通功能',
    });
    assert.equal(verified.decision, 'allow');
    assert.deepEqual(verified.scope, ['target.txt']);
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
