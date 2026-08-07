import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, appendJsonLineLocked, withFileLock } from './atomic-file.mjs';
import { SYSTEM_ROOT } from './registry.mjs';
import { createSpecImpact } from './spec-impact.mjs';

const CURRENT_SCHEMA = 6;
const ACTIVE = new Set(['prepared','waiting_decision','implementing','verifying','reviewing','blocked','saved','needs_rework','waiting_acceptance']);
const TERMINAL = new Set(['accepted','cancelled']);
const TRANSITIONS = {
  prepared: new Set(['implementing','verifying','reviewing','waiting_acceptance','needs_rework','waiting_decision','blocked','saved','cancelled']),
  waiting_decision: new Set(['implementing','blocked','saved','cancelled']),
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
    historyLock: path.join(root, '.locks', 'history.lock'),
    cache: path.join(root, 'check-cache.json')
  };
}

function taskFile(value, id) {
  if (!/^task-[A-Za-z0-9._-]+$/u.test(id ?? '')) throw new Error('任务编号无效');
  return path.join(value.active, `${id}.json`);
}

function lockFile(value, id) {
  return path.join(value.locks, `${id}.lock`);
}

function createId() {
  return `task-${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${crypto.randomUUID().slice(0, 8)}`;
}

function readRaw(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function legacyStatus(value) {
  if (value === '等待验收') return 'waiting_acceptance';
  if (value === '需要修改') return 'needs_rework';
  if (value === '进行中') return 'implementing';
  return ACTIVE.has(value) || TERMINAL.has(value) ? value : 'implementing';
}

function migrateTask(raw) {
  if (raw.schemaVersion === CURRENT_SCHEMA) return raw;
  if (![3, 4, 5].includes(raw.schemaVersion)) throw new Error('不支持的 Task Schema');
  const acceptance = Array.isArray(raw.acceptance)
    ? raw.acceptance
    : Array.isArray(raw.acceptanceCriteria)
      ? raw.acceptanceCriteria.map((item, index) => ({ id: `A${index + 1}`, description: String(item), requiredCovers: ['behavior'], status: 'open' }))
      : [];
  return {
    schemaVersion: CURRENT_SCHEMA,
    taskId: raw.taskId,
    stateRevision: Number(raw.stateRevision ?? 1),
    status: legacyStatus(raw.status),
    goal: raw.goal ?? { summary: raw.summary ?? 'Legacy task', nonGoals: [] },
    acceptance,
    authorization: raw.authorization ?? { scope: raw.authorizedScope ? [raw.authorizedScope] : [], externalActions: [] },
    classification: raw.classification ?? { controlMode: 'standard', structureImpact: 'local', continuity: 'tracked', artifactKinds: ['code'] },
    context: raw.context ?? {},
    baseline: raw.baseline ?? null,
    changeSet: raw.changeSet ?? null,
    evidence: raw.evidence ?? [],
    reviews: raw.reviews ?? [],
    reviewPackage: raw.reviewPackage ?? null,
    verification: raw.verification ?? {},
    blockers: raw.blockers ?? [],
    residualRisks: raw.residualRisks ?? [],
    specImpact: createSpecImpact(raw.specImpact ?? {}),
    specTraceability: raw.specTraceability ?? null,
    specConsistency: raw.specConsistency ?? null,
    experienceCandidates: raw.experienceCandidates ?? [],
    handoff: raw.handoff ?? null,
    compatibility: { ...(raw.compatibility ?? {}), sourceSchemaVersion: raw.schemaVersion },
    deliveryDecision: raw.deliveryDecision ?? null,
    userAcceptance: raw.userAcceptance ?? null,
    createdAt: raw.createdAt ?? raw.startedAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
    acceptedAt: raw.acceptedAt ?? null
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
  atomicWriteJson(taskFile(value, task.taskId), task, value.pending);
  return { task, filePath: taskFile(value, task.taskId), stateRoot: value.root, cacheFile: value.cache };
}

export function readTask(input = {}) {
  const value = paths(input.stateRoot);
  const file = taskFile(value, input.taskId);
  if (!fs.existsSync(file)) throw new Error(`未找到进行中的任务: ${input.taskId}`);
  const raw = readRaw(file);
  if (TERMINAL.has(raw.status)) throw new Error('任务已经结束');
  return { task: migrateTask(raw), filePath: file, stateRoot: value.root, cacheFile: value.cache, source: 'active' };
}

export function readHistory(input = {}) {
  const value = paths(input.stateRoot);
  if (!fs.existsSync(value.history)) return [];
  return fs.readFileSync(value.history, 'utf8').split(/\r?\n/u).filter(Boolean).map((line) => migrateTask(JSON.parse(line)));
}

export function findTask(input = {}) {
  const value = paths(input.stateRoot);
  const file = taskFile(value, input.taskId);
  if (fs.existsSync(file)) return { task: migrateTask(readRaw(file)), filePath: file, stateRoot: value.root, cacheFile: value.cache, source: 'active' };
  const history = readHistory({ stateRoot: value.root });
  const task = [...history].reverse().find((item) => item.taskId === input.taskId);
  if (!task) throw new Error(`未找到任务: ${input.taskId}`);
  return { task, filePath: value.history, stateRoot: value.root, cacheFile: value.cache, source: 'history' };
}

export function updateTask(input = {}) {
  const value = paths(input.stateRoot);
  return withFileLock(lockFile(value, input.taskId), () => {
    const file = taskFile(value, input.taskId);
    if (!fs.existsSync(file)) throw new Error(`未找到进行中的任务: ${input.taskId}`);
    const current = migrateTask(readRaw(file));
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== current.stateRevision) {
      throw new Error(`任务状态版本冲突: 期望 ${input.expectedRevision}，当前 ${current.stateRevision}`);
    }
    let next = structuredClone(current);
    if (typeof input.mutate === 'function') next = input.mutate(next) ?? next;
    else next = { ...next, ...(input.patch ?? {}) };
    if (next.taskId !== current.taskId) throw new Error('状态更新不能改变 Task ID');
    const target = input.transitionTo ?? next.status;
    validateTransition(current.status, target, input.event);
    next.status = target;
    next.schemaVersion = CURRENT_SCHEMA;
    next.stateRevision = current.stateRevision + 1;
    next.updatedAt = new Date().toISOString();
    if (TERMINAL.has(target)) {
      if (target === 'accepted') next.acceptedAt = next.acceptedAt ?? next.updatedAt;
      appendJsonLineLocked(value.history, next, value.historyLock);
      fs.rmSync(file, { force: true });
      return { task: next, filePath: null, stateRoot: value.root, cacheFile: value.cache };
    }
    atomicWriteJson(file, next, value.pending);
    return { task: next, filePath: file, stateRoot: value.root, cacheFile: value.cache };
  }, { timeoutMs: 10000, staleMs: 60000 });
}

export function listTasks(input = {}) {
  const value = paths(input.stateRoot);
  if (!fs.existsSync(value.active)) return { tasks: [], stateRoot: value.root };
  const tasks = fs.readdirSync(value.active)
    .filter((name) => name.endsWith('.json'))
    .map((name) => migrateTask(readRaw(path.join(value.active, name))))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return { tasks, stateRoot: value.root };
}

export const allowedTransitions = TRANSITIONS;
export const taskSchemaVersion = CURRENT_SCHEMA;
