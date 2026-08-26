import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizePath, pathContains } from './registry.mjs';

const GIT_TIMEOUT_MS = 120000;

function gitResult(root, args, options = {}) {
  return spawnSync('git', ['-C', root, ...args], {
    encoding:'utf8',
    windowsHide:true,
    timeout:options.timeoutMs ?? GIT_TIMEOUT_MS,
    maxBuffer:16 * 1024 * 1024,
  });
}

function gitError(root, args, result) {
  const detail = String(result.stderr || result.stdout || result.error?.message || `exit ${result.status ?? 'unknown'}`).trim();
  return new Error(`Git 集成操作失败: git -C ${root} ${args.join(' ')}${detail ? `；${detail}` : ''}`);
}

function gitStrict(root, args, options = {}) {
  const result = gitResult(root, args, options);
  if (result.status !== 0 || result.error) throw gitError(root, args, result);
  return result.stdout.trim();
}

function status(root) {
  return gitStrict(root, ['status', '--porcelain=v1', '--untracked-files=all']);
}

function gitCommonDir(root) {
  return normalizePath(gitStrict(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
}

function parseWorktrees(raw) {
  return raw.split(/\r?\n\r?\n/u).filter(Boolean).map((block) => {
    const record = { worktree:null, head:null, branch:null, detached:false, prunable:false };
    for (const line of block.split(/\r?\n/u)) {
      const space = line.indexOf(' ');
      const key = space === -1 ? line : line.slice(0, space);
      const value = space === -1 ? '' : line.slice(space + 1);
      if (key === 'worktree') record.worktree = path.resolve(value);
      else if (key === 'HEAD') record.head = value;
      else if (key === 'branch') record.branch = value;
      else if (key === 'detached') record.detached = true;
      else if (key === 'prunable') record.prunable = true;
    }
    return record;
  });
}

function worktrees(sourceGitRoot) {
  return parseWorktrees(gitStrict(sourceGitRoot, ['worktree', 'list', '--porcelain']));
}

export function locateTargetCheckout(sourceGitRoot, target) {
  const branch = `refs/heads/${target}`;
  const matches = worktrees(sourceGitRoot).filter((item) => !item.prunable && item.branch === branch && item.worktree);
  if (matches.length !== 1) {
    return {
      ok:false,
      reason:matches.length === 0 ? 'integration-target-checkout-missing' : 'integration-target-checkout-ambiguous',
      targetCheckout:null,
    };
  }
  const targetCheckout = matches[0].worktree;
  if (!fs.existsSync(targetCheckout)) return { ok:false, reason:'integration-target-checkout-missing', targetCheckout:null };
  return { ok:true, reason:null, targetCheckout };
}

export function inspectTargetCheckout(sourceGitRoot, target) {
  const located = locateTargetCheckout(sourceGitRoot, target);
  if (!located.ok) return located;
  const targetCheckout = located.targetCheckout;
  const branch = gitStrict(targetCheckout, ['branch', '--show-current']);
  const head = gitStrict(targetCheckout, ['rev-parse', 'HEAD']);
  const dirty = status(targetCheckout);
  if (branch !== target) return { ok:false, reason:'integration-target-branch-mismatch', targetCheckout, branch, head };
  if (dirty) return { ok:false, reason:'integration-target-dirty', targetCheckout, branch, head, dirty };
  return { ok:true, reason:null, targetCheckout, branch, head };
}

function integrationWorktreePath(stateRoot, gitCommonDirectory, target, taskId) {
  if (!/^task-[A-Za-z0-9._-]+$/u.test(taskId ?? '')) throw new Error('任务编号无效');
  const repoKey = crypto.createHash('sha256').update(`${normalizePath(gitCommonDirectory)}\0${target}`).digest('hex').slice(0, 16);
  const parent = path.resolve(stateRoot, '集成工作树', `${repoKey}-${target.replaceAll('/', '__')}`);
  const candidate = path.resolve(parent, taskId);
  if (!candidate.startsWith(`${parent}${path.sep}`)) throw new Error('集成工作树路径越界');
  return candidate;
}

function revisionList(sourceGitRoot, baseCommit, resultCommit) {
  const commits = gitStrict(sourceGitRoot, ['rev-list', '--reverse', '--topo-order', `${baseCommit}..${resultCommit}`])
    .split(/\r?\n/u).filter(Boolean);
  const merges = gitStrict(sourceGitRoot, ['rev-list', '--merges', `${baseCommit}..${resultCommit}`])
    .split(/\r?\n/u).filter(Boolean);
  return { commits, merges };
}

function candidateState(candidatePath, expectedCommonDir) {
  if (!fs.existsSync(candidatePath)) return null;
  let actualCommonDir;
  try {
    actualCommonDir = gitCommonDir(candidatePath);
  } catch {
    return { status:'occupied', reason:'integration-worktree-path-occupied', candidatePath };
  }
  if (actualCommonDir !== normalizePath(expectedCommonDir)) {
    return { status:'occupied', reason:'integration-worktree-repository-mismatch', candidatePath };
  }
  const conflicts = gitStrict(candidatePath, ['diff', '--name-only', '--diff-filter=U']).split(/\r?\n/u).filter(Boolean);
  if (conflicts.length) {
    return { status:'conflict', reason:'integration-conflict', candidatePath, conflicts };
  }
  const dirty = status(candidatePath);
  const cherryPickHead = gitStrict(candidatePath, ['rev-parse', '--path-format=absolute', '--git-path', 'CHERRY_PICK_HEAD']);
  if (fs.existsSync(cherryPickHead)) {
    return { status:'needs-commit', reason:dirty ? 'integration-resolution-needs-commit' : 'integration-cherry-pick-in-progress', candidatePath, dirty };
  }
  if (dirty) return { status:'needs-commit', reason:'integration-resolution-needs-commit', candidatePath, dirty };
  return { status:'ready', reason:null, candidatePath, candidateCommit:gitStrict(candidatePath, ['rev-parse', 'HEAD']) };
}

export function prepareIntegrationCandidate(input = {}) {
  const sourceGitRoot = path.resolve(input.sourceGitRoot);
  const expectedCommonDir = normalizePath(input.gitCommonDir);
  if (gitCommonDir(sourceGitRoot) !== expectedCommonDir) {
    return { status:'blocked', reason:'integration-repository-mismatch' };
  }
  const targetState = inspectTargetCheckout(sourceGitRoot, input.target);
  if (!targetState.ok) return { status:'blocked', ...targetState };
  const targetCommit = gitStrict(sourceGitRoot, ['rev-parse', `refs/heads/${input.target}^{commit}`]);
  if (targetState.head !== targetCommit) {
    return { status:'blocked', reason:'integration-target-checkout-stale', ...targetState, targetCommit };
  }

  const canonicalCandidatePath = integrationWorktreePath(input.stateRoot, expectedCommonDir, input.target, input.taskId);
  if (input.existingWorktree
    && normalizePath(path.resolve(input.existingWorktree)) !== normalizePath(canonicalCandidatePath)) {
    return { status:'blocked', reason:'integration-worktree-path-mismatch' };
  }
  const candidatePath = canonicalCandidatePath;
  const existing = candidateState(candidatePath, expectedCommonDir);
  if (existing) {
    if (input.candidateBase && input.candidateBase !== targetCommit) {
      return { status:'blocked', reason:'integration-target-advanced', candidatePath, candidateBase:input.candidateBase, targetCommit, targetCheckout:targetState.targetCheckout };
    }
    return { ...existing, candidateBase:input.candidateBase ?? targetCommit, targetCommit, targetCheckout:targetState.targetCheckout };
  }

  // The task may have been rebased onto a newer target after it was prepared.
  // Replay only commits that are not already reachable from the current target;
  // using the original task baseline would reapply target-side commits.
  const revisions = revisionList(sourceGitRoot, targetCommit, input.resultCommit);
  if (!revisions.commits.length) return { status:'blocked', reason:'integration-result-empty', targetCommit, targetCheckout:targetState.targetCheckout };
  if (revisions.merges.length) return { status:'blocked', reason:'integration-nonlinear-history', merges:revisions.merges, targetCommit, targetCheckout:targetState.targetCheckout };

  fs.mkdirSync(path.dirname(candidatePath), { recursive:true });
  const added = gitResult(sourceGitRoot, ['worktree', 'add', '--detach', candidatePath, targetCommit]);
  if (added.status !== 0 || added.error) throw gitError(sourceGitRoot, ['worktree', 'add', '--detach', candidatePath, targetCommit], added);
  const picked = gitResult(candidatePath, [
    '-c', 'user.name=AI R&D Integrator',
    '-c', 'user.email=ai-rd-integrator@local',
    'cherry-pick', ...revisions.commits,
  ]);
  if (picked.status !== 0 || picked.error) {
    const current = candidateState(candidatePath, expectedCommonDir);
    return {
      ...(current ?? { status:'blocked', reason:'integration-cherry-pick-failed', candidatePath }),
      candidateBase:targetCommit,
      targetCommit,
      targetCheckout:targetState.targetCheckout,
      diagnostic:String(picked.stderr || picked.stdout || picked.error?.message || '').trim(),
    };
  }
  return {
    status:'ready',
    reason:null,
    candidatePath,
    candidateBase:targetCommit,
    candidateCommit:gitStrict(candidatePath, ['rev-parse', 'HEAD']),
    targetCommit,
    targetCheckout:targetState.targetCheckout,
  };
}

export function promoteIntegrationCandidate(input = {}) {
  const target = inspectTargetCheckout(input.sourceGitRoot, input.target);
  if (!target.ok) return { ok:false, reason:target.reason, ...target };
  if (target.head !== input.candidateBase) {
    return { ok:false, reason:'integration-target-advanced', targetCheckout:target.targetCheckout, targetCommit:target.head };
  }
  const candidateHead = gitStrict(input.candidatePath, ['rev-parse', 'HEAD']);
  if (candidateHead !== input.candidateCommit) return { ok:false, reason:'integration-candidate-changed', candidateCommit:candidateHead };
  const ancestry = gitResult(input.candidatePath, ['merge-base', '--is-ancestor', input.candidateBase, candidateHead]);
  if (ancestry.status !== 0 || ancestry.error) return { ok:false, reason:'integration-candidate-not-fast-forward' };
  const merged = gitResult(target.targetCheckout, ['merge', '--ff-only', candidateHead]);
  if (merged.status !== 0 || merged.error) {
    return { ok:false, reason:'integration-promotion-failed', targetCheckout:target.targetCheckout, diagnostic:String(merged.stderr || merged.stdout || merged.error?.message || '').trim() };
  }
  const targetCommit = gitStrict(target.targetCheckout, ['rev-parse', 'HEAD']);
  if (targetCommit !== candidateHead) return { ok:false, reason:'integration-promotion-head-mismatch', targetCheckout:target.targetCheckout, targetCommit };
  return { ok:true, reason:null, targetCheckout:target.targetCheckout, targetCommit, method:'auto-cherry-pick-ff' };
}

export function removeIntegrationWorktree(input = {}) {
  const candidatePath = input.candidatePath ? path.resolve(input.candidatePath) : null;
  if (!candidatePath || !fs.existsSync(candidatePath)) return { removed:false, reason:'already-absent' };
  const result = gitResult(input.targetCheckout, ['worktree', 'remove', '--force', candidatePath]);
  if (result.status !== 0 || result.error) {
    return { removed:false, reason:'integration-worktree-cleanup-failed', path:candidatePath, diagnostic:String(result.stderr || result.error?.message || '').trim() };
  }
  return { removed:true, reason:null, path:candidatePath };
}

export function cleanupTaskSource(input = {}) {
  const sourceGitRoot = path.resolve(input.sourceGitRoot);
  const targetCheckout = path.resolve(input.targetCheckout);
  if (input.keepWorktree === true) return { worktree:'kept', branch:'kept', reason:'keep-worktree-requested' };
  if (normalizePath(sourceGitRoot) === normalizePath(targetCheckout)) return { worktree:'kept', branch:'kept', reason:'source-is-target' };
  const protectedPath = (input.protectedPaths ?? []).filter(Boolean).find((item) => pathContains(sourceGitRoot, item));
  if (protectedPath) {
    return { worktree:'pending', branch:'pending', reason:'source-contains-protected-state', path:sourceGitRoot, protectedPath:path.resolve(protectedPath) };
  }
  if (!fs.existsSync(sourceGitRoot)) return { worktree:'absent', branch:'absent', reason:null };
  const head = gitStrict(sourceGitRoot, ['rev-parse', 'HEAD']);
  const branch = gitStrict(sourceGitRoot, ['branch', '--show-current']);
  const dirty = status(sourceGitRoot);
  if (head !== input.resultCommit) return { worktree:'pending', branch:branch || 'absent', reason:'source-head-changed', path:sourceGitRoot, head };
  if (dirty) return { worktree:'pending', branch:branch || 'absent', reason:'source-worktree-dirty', path:sourceGitRoot, dirty };
  const sourceWasCurrentDirectory = normalizePath(sourceGitRoot) === normalizePath(process.cwd());
  if (sourceWasCurrentDirectory) process.chdir(targetCheckout);
  const removed = gitResult(targetCheckout, ['worktree', 'remove', sourceGitRoot]);
  if (removed.status !== 0 || removed.error) {
    if (sourceWasCurrentDirectory && fs.existsSync(sourceGitRoot)) process.chdir(sourceGitRoot);
    return { worktree:'pending', branch:branch || 'absent', reason:'source-worktree-cleanup-failed', path:sourceGitRoot, diagnostic:String(removed.stderr || removed.error?.message || '').trim() };
  }
  let branchState = branch ? 'pending' : 'absent';
  let reason = null;
  if (branch && branch !== input.target) {
    const ref = `refs/heads/${branch}`;
    const current = gitResult(targetCheckout, ['show-ref', '--verify', '--hash', ref]);
    if (current.status === 1) branchState = 'absent';
    else if (current.status !== 0 || current.error) reason = 'source-branch-inspection-failed';
    else if (current.stdout.trim() !== input.resultCommit) reason = 'source-branch-advanced';
    else {
      const deleted = gitResult(targetCheckout, ['update-ref', '-d', ref, input.resultCommit]);
      if (deleted.status === 0 && !deleted.error) branchState = 'removed';
      else reason = 'source-branch-cleanup-failed';
    }
  } else if (branch === input.target) {
    reason = 'source-branch-is-target';
  }
  return { worktree:'removed', branch:branchState, branchName:branch || null, reason, path:sourceGitRoot };
}
