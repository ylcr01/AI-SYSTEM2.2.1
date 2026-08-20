import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, appendJsonLineLocked, withFileLock } from './atomic-file.mjs';
import { SYSTEM_ROOT, normalizePath } from './registry.mjs';
import { createSpecImpact } from './spec-impact.mjs';
import { applyOutcomeMetricEvent, createOutcomeMetrics, normalizeOutcomeMetrics } from './outcome-metrics.mjs';

const CURRENT_SCHEMA = 9;
const TERMINAL = new Set(['accepted','cancelled']);
const WRITING = new Set(['prepared','implementing','verifying','reviewing','needs_rework']);
const TRANSITIONS = {
  prepared: new Set(['implementing','verifying','reviewing','ready_to_integrate','waiting_acceptance','needs_rework','blocked','saved','cancelled']),
  implementing: new Set(['implementing','verifying','reviewing','ready_to_integrate','waiting_acceptance','needs_rework','blocked','saved','cancelled']),
  verifying: new Set(['implementing','verifying','reviewing','ready_to_integrate','waiting_acceptance','needs_rework','blocked','saved','cancelled']),
  reviewing: new Set(['implementing','reviewing','ready_to_integrate','waiting_acceptance','needs_rework','blocked','saved','cancelled']),
  blocked: new Set(['implementing','verifying','saved','cancelled']),
  saved: new Set(['implementing','verifying','cancelled']),
  needs_rework: new Set(['implementing','verifying','reviewing','ready_to_integrate','waiting_acceptance','blocked','saved','cancelled']),
  ready_to_integrate: new Set(['verifying','waiting_acceptance','needs_rework','cancelled']),
  waiting_acceptance: new Set(['implementing','verifying','accepted','needs_rework','saved','cancelled'])
};

function paths(stateRoot) {
  const root = path.resolve(stateRoot ?? process.env.AI_RD_OS_STATE_ROOT ?? path.join(SYSTEM_ROOT, '80-运行记录'));
  return {
    root,
    active: path.join(root, '进行中'),
    waiting: path.join(root, '待验收'),
    pending: path.join(root, '.pending'),
    locks: path.join(root, '.locks'),
    history: path.join(root, '历史.jsonl'),
    historyLock: path.join(root, '.locks', 'history.lock')
  };
}

function taskFile(value, id, bucket = 'active') {
  if (!/^task-[A-Za-z0-9._-]+$/u.test(id ?? '')) throw new Error('任务编号无效');
  return path.join(value[bucket], `${id}.json`);
}

function locateTaskFile(value, id) {
  const active = taskFile(value, id, 'active');
  const waiting = taskFile(value, id, 'waiting');
  if (fs.existsSync(active)) return { file: active, source: 'active' };
  if (fs.existsSync(waiting)) return { file: waiting, source: 'waiting' };
  return null;
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

function nonTerminalTasks(value) {
  const files = [value.active, value.waiting].flatMap((dir) => fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => path.join(dir, name))
    : []);
  return files.map((file) => currentTask(readRaw(file)));
}

function assertWorkspaceAvailable(value, gitRoot, taskId = null) {
  if (!gitRoot) return;
  const conflict = activeTasks(value).find((item) => item.taskId !== taskId
    && WRITING.has(item.status)
    && normalizePath(item.baseline?.gitRoot) === normalizePath(gitRoot));
  if (conflict) {
    throw new Error(`当前 Git 工作树已有活动写 Task: ${conflict.taskId} (${conflict.status})。同一工作树不能并行写。若使用 Codex 桌面端，请为新对话选择“Worktree”，或先用 Handoff 将当前对话移入 Worktree；每个并行写 Task 必须独占一个 managed Worktree。其他宿主请使用 \`git worktree add --detach <新路径> <起点>\` 创建独立 worktree。进入 Worktree 后准备 Task 时必须声明 \`--integration-target <目标分支>\`。若冲突 Task 暂不继续，可运行 \`task.mjs 保存 --task-id ${conflict.taskId}\` 显式释放工作树，恢复时会重新检查写冲突。系统不会自动创建、移动或删除 worktree。`);
  }
}

function createId() {
  return `task-${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${crypto.randomUUID().slice(0, 8)}`;
}

function readRaw(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function currentTask(raw) {
  const upgraded = [6, 7, 8].includes(raw.schemaVersion)
    ? { ...raw, schemaVersion:CURRENT_SCHEMA, integration:raw.integration ?? null }
    : raw;
  if (upgraded.schemaVersion !== CURRENT_SCHEMA) {
    throw new Error(`不支持的 Task Schema: ${raw.schemaVersion ?? 'unknown'}；历史版本请使用对应系统读取`);
  }
  return {
    ...upgraded,
    outcomeMetrics: normalizeOutcomeMetrics(upgraded.outcomeMetrics, { createdAt:upgraded.createdAt }),
  };
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
  fs.mkdirSync(value.waiting, { recursive: true });
  fs.mkdirSync(value.locks, { recursive: true });
  const now = new Date().toISOString();
  const taskId = input.taskId ?? createId();
  const alignmentMode = input.goal?.alignment?.mode;
  const task = {
    schemaVersion: CURRENT_SCHEMA,
    taskId,
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
    verification: input.verification,
    blockers: [],
    residualRisks: [],
    specImpact: createSpecImpact(input.specImpact ?? {}),
    specTraceability: input.specTraceability ?? null,
    specConsistency: input.specConsistency ?? null,
    handoff: null,
    integration: input.integration?.required ? {
      schemaVersion:1,
      required:true,
      status:'pending_commit',
      target:input.integration.target,
      baseCommit:input.baseline?.head ?? null,
      resultCommit:null,
      pendingRef:`refs/ai/pending/${taskId}`,
      sourceGitRoot:input.baseline?.gitRoot ?? null,
      gitCommonDir:input.baseline?.gitCommonDir ?? null,
      targetGitRoot:null,
      targetCommit:null,
      integratedAt:null,
      integrationEvidence:null,
      revalidatedAt:null,
    } : null,
    outcomeMetrics: createOutcomeMetrics({
      at: now,
      initialUserDecisionCount: ['confirmed', 'delegated'].includes(alignmentMode) ? 1 : 0,
    }),
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
  const located = locateTaskFile(value, input.taskId);
  if (!located) throw new Error(`未找到未结束的任务: ${input.taskId}`);
  const { file, source } = located;
  const raw = readRaw(file);
  if (TERMINAL.has(raw.status)) throw new Error('任务已经结束');
  return { task: currentTask(raw), filePath: file, stateRoot: value.root, source };
}

export function readHistory(input = {}) {
  const value = paths(input.stateRoot);
  if (!fs.existsSync(value.history)) return [];
  return fs.readFileSync(value.history, 'utf8').split(/\r?\n/u).filter(Boolean).map((line) => currentTask(JSON.parse(line)));
}

export function findTask(input = {}) {
  const value = paths(input.stateRoot);
  const located = locateTaskFile(value, input.taskId);
  if (located) return { task: currentTask(readRaw(located.file)), filePath: located.file, stateRoot: value.root, source: located.source };
  const history = readHistory({ stateRoot: value.root });
  const task = [...history].reverse().find((item) => item.taskId === input.taskId);
  if (!task) throw new Error(`未找到任务: ${input.taskId}`);
  return { task: currentTask(task), filePath: value.history, stateRoot: value.root, source: 'history' };
}

export function updateTask(input = {}) {
  const value = paths(input.stateRoot);
  return withFileLock(lockFile(value, input.taskId), () => {
    const located = locateTaskFile(value, input.taskId);
    if (!located) throw new Error(`未找到未结束的任务: ${input.taskId}`);
    const file = located.file;
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
      next.outcomeMetrics = applyOutcomeMetricEvent(next.outcomeMetrics, {
        event: input.event,
        from: current.status,
        to: target,
        at: next.updatedAt,
        createdAt: current.createdAt,
        durationMs: input.metricDurationMs,
        reasonCategory: input.metricReasonCategory,
        note: input.metricNote,
      });
      if (TERMINAL.has(target)) {
        if (target === 'accepted') next.acceptedAt = next.acceptedAt ?? next.updatedAt;
        appendJsonLineLocked(value.history, next, value.historyLock);
        fs.rmSync(file, { force: true });
        return { task: next, filePath: null, stateRoot: value.root };
      }
      const bucket = target === 'waiting_acceptance' ? 'waiting' : 'active';
      fs.mkdirSync(value[bucket], { recursive: true });
      const destination = taskFile(value, next.taskId, bucket);
      atomicWriteJson(destination, next, value.pending);
      if (destination !== file) fs.rmSync(file, { force: true });
      return { task: next, filePath: destination, stateRoot: value.root };
    };
    return !WRITING.has(current.status) && WRITING.has(target) && current.baseline?.gitRoot
      ? withFileLock(workspaceLockFile(value, current.baseline.gitRoot), write, { timeoutMs: 10000, staleMs: 60000 })
      : write();
  }, { timeoutMs: 10000, staleMs: 60000 });
}

export function listTasks(input = {}) {
  const value = paths(input.stateRoot);
  let tasks = nonTerminalTasks(value)
    .sort((left, right) => (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt));
  if (input.gitRoot) {
    tasks = tasks.filter((task) => normalizePath(task.baseline?.gitRoot) === normalizePath(input.gitRoot));
  }
  if (input.limit > 0) tasks = tasks.slice(0, input.limit);
  return { tasks, stateRoot: value.root };
}

export function diagnoseState(input = {}) {
  const value = paths(input.stateRoot);
  const diagnostics = [];
  const seen = new Map();
  const counts = { active: 0, waiting: 0, history: 0, invalid: 0 };
  for (const [source, dir] of [['active', value.active], ['waiting', value.waiting]]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((item) => item.endsWith('.json'))) {
      try {
        const task = currentTask(readRaw(path.join(dir, name)));
        counts[source] += 1;
        if (seen.has(task.taskId)) diagnostics.push({ code: 'duplicate-task', taskId: task.taskId, locations: [seen.get(task.taskId), source] });
        else seen.set(task.taskId, source);
        if (source === 'active' && task.status === 'waiting_acceptance') diagnostics.push({ code: 'legacy-waiting-in-active', taskId: task.taskId });
        if (source === 'waiting' && task.status !== 'waiting_acceptance') diagnostics.push({ code: 'non-waiting-in-waiting-dir', taskId: task.taskId, status: task.status });
      } catch (error) {
        counts.invalid += 1;
        diagnostics.push({ code: 'invalid-task-record', file: name, source, diagnostic: error.message });
      }
    }
  }
  try { counts.history = readHistory({ stateRoot: value.root }).length; }
  catch (error) { diagnostics.push({ code: 'invalid-history', diagnostic: error.message }); }
  return { schemaVersion: 1, stateRoot: value.root, readOnly: true, ok: diagnostics.length === 0, counts, diagnostics };
}

export const allowedTransitions = TRANSITIONS;
export const taskSchemaVersion = CURRENT_SCHEMA;
