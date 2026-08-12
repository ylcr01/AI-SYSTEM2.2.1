import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, appendJsonLineLocked, withFileLock } from './atomic-file.mjs';
import { SYSTEM_ROOT, normalizePath } from './registry.mjs';
import { createSpecImpact } from './spec-impact.mjs';

const CURRENT_SCHEMA = 6;
const TERMINAL = new Set(['accepted','cancelled']);
const WRITING = new Set(['prepared','implementing','verifying','reviewing','needs_rework']);
const TRANSITIONS = {
  prepared: new Set(['implementing','verifying','reviewing','waiting_acceptance','needs_rework','blocked','saved','cancelled']),
  implementing: new Set(['verifying','reviewing','waiting_acceptance','needs_rework','blocked','saved','cancelled']),
  verifying: new Set(['verifying','reviewing','waiting_acceptance','needs_rework','blocked','saved','cancelled']),
  reviewing: new Set(['reviewing','waiting_acceptance','needs_rework','blocked','saved','cancelled']),
  blocked: new Set(['implementing','verifying','saved','cancelled']),
  saved: new Set(['implementing','verifying','cancelled']),
  needs_rework: new Set(['implementing','verifying','reviewing','waiting_acceptance','blocked','saved','cancelled']),
  waiting_acceptance: new Set(['accepted','needs_rework','cancelled'])
};

function paths(stateRoot) {
  const root = path.resolve(stateRoot ?? path.join(SYSTEM_ROOT, '80-运行记录'));
  return {
    root,
    active: path.join(root, '进行中'),
    pending: path.join(root, '.pending'),
    locks: path.join(root, '.locks'),
    history: path.join(root, '历史.jsonl'),
    historyLock: path.join(root, '.locks', 'history.lock')
  };
}

function taskFile(value, id) {
  if (!/^task-[A-Za-z0-9._-]+$/u.test(id ?? '')) throw new Error('任务编号无效');
  return path.join(value.active, `${id}.json`);
}

function lockFile(value, id) {
  return path.join(value.locks, `${id}.lock`);
}

function workspaceLockFile(value, gitRoot) {
  const key = crypto.createHash('sha256').update(normalizePath(gitRoot)).digest('hex').slice(0, 24);
  return path.join(value.locks, `workspace-${key}.lock`);
}

function activeTasks(value) {
  if (!fs.existsSync(value.active)) return [];
  return fs.readdirSync(value.active)
    .filter((name) => name.endsWith('.json'))
    .map((name) => currentTask(readRaw(path.join(value.active, name))));
}

function assertWorkspaceAvailable(value, gitRoot, taskId = null) {
  if (!gitRoot) return;
  const conflict = activeTasks(value).find((item) => item.taskId !== taskId
    && WRITING.has(item.status)
    && normalizePath(item.baseline?.gitRoot) === normalizePath(gitRoot));
  if (conflict) {
    throw new Error(`当前 Git 工作树已有活动写 Task: ${conflict.taskId} (${conflict.status})。同一工作树不能并行写；请使用 \`git worktree add <新路径> -b codex/<分支名>\` 创建独立 worktree，并从新路径重新准备。系统不会自动创建或删除 worktree。`);
  }
}

function createId() {
  return `task-${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${crypto.randomUUID().slice(0, 8)}`;
}

function readRaw(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function currentTask(raw) {
  if (raw.schemaVersion !== CURRENT_SCHEMA) {
    throw new Error(`不支持的 Task Schema: ${raw.schemaVersion ?? 'unknown'}；历史版本请使用对应系统读取`);
  }
  return raw;
}

function validateTransition(from, to, event) {
  if (from === to) return;
  if (!TRANSITIONS[from]?.has(to)) throw new Error(`非法状态转换: ${from} → ${to}`);
  if (to === 'accepted' && event !== 'user-accept') throw new Error('accepted 只能由用户验收产生');
  if (to === 'cancelled' && event !== 'user-cancel') throw new Error('cancelled 只能由用户取消产生');
}

export function createTask(input = {}) {
  const value = paths(input.stateRoot);
  fs.mkdirSync(value.active, { recursive: true });
  fs.mkdirSync(value.locks, { recursive: true });
  const now = new Date().toISOString();
  const task = {
    schemaVersion: CURRENT_SCHEMA,
    taskId: input.taskId ?? createId(),
    stateRevision: 1,
    status: 'prepared',
    goal: input.goal,
    acceptance: input.acceptance ?? [],
    authorization: input.authorization,
    classification: input.classification,
    context: input.context,
    baseline: input.baseline ?? null,
    changeSet: null,
    evidence: [],
    reviews: [],
    reviewPackage: null,
    verification: input.verification,
    blockers: [],
    residualRisks: [],
    specImpact: createSpecImpact(input.specImpact ?? {}),
    specTraceability: input.specTraceability ?? null,
    specConsistency: input.specConsistency ?? null,
    experienceCandidates: [],
    handoff: null,
    createdAt: now,
    updatedAt: now,
    acceptedAt: null
  };
  const write = () => {
    assertWorkspaceAvailable(value, input.baseline?.gitRoot);
    atomicWriteJson(taskFile(value, task.taskId), task, value.pending);
    return { task, filePath: taskFile(value, task.taskId), stateRoot: value.root };
  };
  return input.baseline?.gitRoot
    ? withFileLock(workspaceLockFile(value, input.baseline.gitRoot), write, { timeoutMs: 10000, staleMs: 60000 })
    : write();
}

export function readTask(input = {}) {
  const value = paths(input.stateRoot);
  const file = taskFile(value, input.taskId);
  if (!fs.existsSync(file)) throw new Error(`未找到进行中的任务: ${input.taskId}`);
  const raw = readRaw(file);
  if (TERMINAL.has(raw.status)) throw new Error('任务已经结束');
  return { task: currentTask(raw), filePath: file, stateRoot: value.root, source: 'active' };
}

export function readHistory(input = {}) {
  const value = paths(input.stateRoot);
  if (!fs.existsSync(value.history)) return [];
  return fs.readFileSync(value.history, 'utf8').split(/\r?\n/u).filter(Boolean).map((line) => currentTask(JSON.parse(line)));
}

export function findTask(input = {}) {
  const value = paths(input.stateRoot);
  const file = taskFile(value, input.taskId);
  if (fs.existsSync(file)) return { task: currentTask(readRaw(file)), filePath: file, stateRoot: value.root, source: 'active' };
  const history = readHistory({ stateRoot: value.root });
  const task = [...history].reverse().find((item) => item.taskId === input.taskId);
  if (!task) throw new Error(`未找到任务: ${input.taskId}`);
  return { task: currentTask(task), filePath: value.history, stateRoot: value.root, source: 'history' };
}

export function updateTask(input = {}) {
  const value = paths(input.stateRoot);
  return withFileLock(lockFile(value, input.taskId), () => {
    const file = taskFile(value, input.taskId);
    if (!fs.existsSync(file)) throw new Error(`未找到进行中的任务: ${input.taskId}`);
    const current = currentTask(readRaw(file));
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== current.stateRevision) {
      throw new Error(`任务状态版本冲突: 期望 ${input.expectedRevision}，当前 ${current.stateRevision}`);
    }
    let next = structuredClone(current);
    if (typeof input.mutate === 'function') next = input.mutate(next) ?? next;
    else next = { ...next, ...(input.patch ?? {}) };
    if (next.taskId !== current.taskId) throw new Error('状态更新不能改变 Task ID');
    const target = input.transitionTo ?? next.status;
    validateTransition(current.status, target, input.event);
    const write = () => {
      if (!WRITING.has(current.status) && WRITING.has(target)) {
        assertWorkspaceAvailable(value, current.baseline?.gitRoot, current.taskId);
      }
      next.status = target;
      next.schemaVersion = CURRENT_SCHEMA;
      next.stateRevision = current.stateRevision + 1;
      next.updatedAt = new Date().toISOString();
      if (TERMINAL.has(target)) {
        if (target === 'accepted') next.acceptedAt = next.acceptedAt ?? next.updatedAt;
        appendJsonLineLocked(value.history, next, value.historyLock);
        fs.rmSync(file, { force: true });
        return { task: next, filePath: null, stateRoot: value.root };
      }
      atomicWriteJson(file, next, value.pending);
      return { task: next, filePath: file, stateRoot: value.root };
    };
    return !WRITING.has(current.status) && WRITING.has(target) && current.baseline?.gitRoot
      ? withFileLock(workspaceLockFile(value, current.baseline.gitRoot), write, { timeoutMs: 10000, staleMs: 60000 })
      : write();
  }, { timeoutMs: 10000, staleMs: 60000 });
}

export function listTasks(input = {}) {
  const value = paths(input.stateRoot);
  let tasks = activeTasks(value)
    .sort((left, right) => (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt));
  if (input.gitRoot) {
    tasks = tasks.filter((task) => normalizePath(task.baseline?.gitRoot) === normalizePath(input.gitRoot));
  }
  if (input.limit > 0) tasks = tasks.slice(0, input.limit);
  return { tasks, stateRoot: value.root };
}

export const allowedTransitions = TRANSITIONS;
export const taskSchemaVersion = CURRENT_SCHEMA;
