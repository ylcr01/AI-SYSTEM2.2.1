import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendJsonLineLocked } from './atomic-file.mjs';
import { findGitRoot, normalizePath, runGit } from './registry.mjs';
import { resolveStateRoot } from './state-manager.mjs';
import { PROBLEM_TYPES } from './task-policy.mjs';
import {
  FOLLOW_UP_KINDS,
  applyOutcomeMetricEvent,
  beginConversationDelivery,
  createOutcomeMetrics,
  observeConversationFollowUp,
} from './outcome-metrics.mjs';

const LIGHT_TASK_PREFIX = 'result-';
const CLOSING_KINDS = new Set(['scope-extension', 'positive-acknowledgement', 'topic-advance']);

function ledgerPaths(stateRoot) {
  const root = resolveStateRoot(stateRoot);
  return {
    root,
    events: path.join(root, '结果事件.jsonl'),
    lock: path.join(root, '.locks', 'outcome-ledger.lock'),
  };
}

function makeId(prefix) {
  return `${prefix}${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${crypto.randomUUID().slice(0, 8)}`;
}

function observationId(value) {
  const normalized = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(normalized)) {
    throw new Error('observation-id 必须是 1～200 位不透明标识，只能包含字母、数字、点、下划线、冒号或连字符');
  }
  return normalized;
}

function problemType(value) {
  const normalized = String(value ?? '').trim();
  if (!PROBLEM_TYPES.has(normalized)) throw new Error(`problem-type 无效: ${normalized || 'unknown'}`);
  return normalized;
}

function normalizedScopes(value) {
  const values = (Array.isArray(value) ? value : value == null ? [] : [value])
    .map((item) => String(item).trim().replaceAll('\\', '/'))
    .filter(Boolean);
  if (!values.length) throw new Error('轻量交付必须重复 --scope 声明本次提交的精确文件或目录');
  return [...new Set(values.map((item) => {
    if (item.includes(',') || /[*?\[\]]/u.test(item)) throw new Error('轻量交付 scope 不支持逗号或 glob');
    if (path.posix.isAbsolute(item) || path.win32.isAbsolute(item)) throw new Error('轻量交付 scope 必须是 Git Root 内相对路径');
    const normalized = path.posix.normalize(item.replace(/^\.\//u, ''));
    if (normalized === '..' || normalized.startsWith('../')) throw new Error('轻量交付 scope 不得越过 Git Root');
    return normalized;
  }))];
}

function assertCommitScope(gitRoot, commit, scopes) {
  const output = runGit(gitRoot, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', commit]);
  if (output === null) throw new Error('无法读取轻量交付提交的 ChangeSet');
  const files = output.split(/\r?\n/u).map((item) => item.trim().replaceAll('\\', '/')).filter(Boolean);
  if (!files.length) throw new Error('轻量交付提交没有可记录的文件变化');
  const outside = files.filter((file) => !scopes.some((scope) => scope === '.' || file === scope || file.startsWith(`${scope}/`)));
  if (outside.length) throw new Error(`轻量交付提交包含 Scope 外文件: ${outside.join(', ')}`);
  return files;
}

export function readLightOutcomeEvents(input = {}) {
  const files = ledgerPaths(input.stateRoot);
  if (!fs.existsSync(files.events)) return [];
  return fs.readFileSync(files.events, 'utf8').split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`结果事件账本第 ${index + 1} 行不是有效 JSON`); }
  });
}

function sampleEvents(events, taskId) {
  return events.filter((event) => event.taskId === taskId);
}

function assertLocalCommit(cwd, commit) {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) throw new Error('轻量交付必须位于可确认的 Git 工作树');
  const requested = String(commit ?? '').trim();
  if (!requested) throw new Error('轻量交付必须提供验证后形成的本地 --commit');
  const resolved = runGit(gitRoot, ['rev-parse', `${requested}^{commit}`]);
  const head = runGit(gitRoot, ['rev-parse', 'HEAD']);
  if (!resolved || !head || resolved !== head) throw new Error('轻量交付提交必须等于当前工作树 HEAD');
  const status = runGit(gitRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status === null) throw new Error('无法确认轻量交付工作树状态');
  if (status !== '') throw new Error('轻量交付记录要求验证后的修改已经全部本地提交且工作树干净');
  return { gitRoot, commit: head };
}

export function recordLightDelivery(input = {}) {
  const files = ledgerPaths(input.stateRoot);
  const commit = assertLocalCommit(path.resolve(input.cwd ?? process.cwd()), input.commit);
  const scopes = normalizedScopes(input.scope);
  const changedFiles = assertCommitScope(commit.gitRoot, commit.commit, scopes);
  const type = problemType(input.problemType);
  const existingEvents = readLightOutcomeEvents({ stateRoot:files.root });
  const requestedTaskId = String(input.taskId ?? '').trim();
  const taskId = requestedTaskId || makeId(LIGHT_TASK_PREFIX);
  if (!taskId.startsWith(LIGHT_TASK_PREFIX)) throw new Error(`轻量结果编号必须以 ${LIGHT_TASK_PREFIX} 开头`);
  const previous = sampleEvents(existingEvents, taskId);
  if (requestedTaskId) {
    if (!previous.length) throw new Error(`未找到轻量结果记录: ${taskId}`);
    const reconstructed = readLightOutcomeTasks({ stateRoot:files.root }).find((task) => task.taskId === taskId);
    if (reconstructed?.status !== 'needs_rework') throw new Error('只有缺陷退回后的轻量结果可以继续记录同一问题的新提交');
    if (normalizePath(reconstructed.baseline?.gitRoot) !== normalizePath(commit.gitRoot)) throw new Error('轻量结果不能跨 Git 项目续写');
    if (reconstructed.classification?.problemType !== type) throw new Error('同一轻量结果不能改变 problem-type');
  }
  const now = new Date().toISOString();
  const deliveryId = makeId('delivery-');
  const event = {
    schemaVersion:1,
    event:'delivery',
    taskId,
    deliveryId,
    observedAt:now,
    gitRoot:commit.gitRoot,
    commit:commit.commit,
    scopes,
    changedFiles,
    problemType:type,
    eligible:input.eligible !== false && type !== 'unknown',
    exclusionReason:input.eligible === false || type === 'unknown'
      ? String(input.exclusionReason ?? (type === 'unknown' ? 'unknown-problem-type' : 'explicit-exclusion'))
      : null,
  };
  appendJsonLineLocked(files.events, event, files.lock);
  return {
    schemaVersion:2,
    view:'outcome',
    taskId,
    state:'delivered',
    stateLabel:'本轮已交付',
    source:'light-direct',
    problemType:type,
    localCommit:commit.commit,
    scopes,
    continuation:{ taskId, deliveryId },
    next:'无需形式确认；下一条相关消息将更新同一问题的完成轮次。',
  };
}

export function recordLightFollowUp(input = {}) {
  const files = ledgerPaths(input.stateRoot);
  const events = readLightOutcomeEvents({ stateRoot:files.root });
  const taskId = String(input.taskId ?? '').trim();
  const deliveryId = String(input.deliveryId ?? '').trim();
  const kind = String(input.kind ?? '').trim();
  const id = observationId(input.observationId);
  if (!taskId.startsWith(LIGHT_TASK_PREFIX)) throw new Error('不是轻量结果编号');
  if (!FOLLOW_UP_KINDS.has(kind)) throw new Error(`后续类型无效: ${kind || 'unknown'}`);
  const previous = sampleEvents(events, taskId);
  if (!previous.length) throw new Error(`未找到轻量结果记录: ${taskId}`);
  const lastDelivery = [...previous].reverse().find((event) => event.event === 'delivery');
  if (!lastDelivery || lastDelivery.deliveryId !== deliveryId) throw new Error('delivery-id 与当前轻量交付不匹配');
  const duplicate = previous.find((event) => event.event === 'follow-up' && event.observationId === id);
  if (duplicate) {
    if (duplicate.kind !== kind) throw new Error('同一 observation-id 不能记录为不同后续类型');
    return { recorded:false, idempotent:true, followUp:{ kind, observationId:id }, taskId };
  }
  const current = readLightOutcomeTasks({ stateRoot:files.root }).find((task) => task.taskId === taskId);
  if (!current || current.status === 'closed') throw new Error('轻量结果已经根据后续对话收口');
  if (current.status !== 'waiting_acceptance') throw new Error(`轻量结果当前不能记录交付后续: ${current.status}`);
  appendJsonLineLocked(files.events, {
    schemaVersion:1,
    event:'follow-up',
    taskId,
    deliveryId,
    observationId:id,
    kind,
    observedAt:new Date().toISOString(),
  }, files.lock);
  return {
    schemaVersion:2,
    view:'outcome',
    taskId,
    state:kind === 'defect-return' ? 'working' : CLOSING_KINDS.has(kind) ? 'done' : 'delivered',
    recorded:true,
    idempotent:false,
    followUp:{ kind, observationId:id },
  };
}

function followUpEvent(kind) {
  return kind === 'defect-return'
    ? 'conversation-defect-return'
    : kind === 'related-question'
      ? 'conversation-related-question'
      : `conversation-${kind}`;
}

export function readLightOutcomeTasks(input = {}) {
  const events = readLightOutcomeEvents(input);
  const groups = new Map();
  for (const event of events) {
    if (!event?.taskId?.startsWith(LIGHT_TASK_PREFIX)) continue;
    if (!groups.has(event.taskId)) groups.set(event.taskId, []);
    groups.get(event.taskId).push(event);
  }
  return [...groups.entries()].map(([taskId, items]) => {
    const firstDelivery = items.find((event) => event.event === 'delivery');
    if (!firstDelivery) return null;
    let status = 'prepared';
    let updatedAt = firstDelivery.observedAt;
    let conversationOutcome = null;
    let metrics = createOutcomeMetrics({
      at:firstDelivery.observedAt,
      problemType:firstDelivery.problemType,
      eligible:firstDelivery.eligible,
      exclusionReason:firstDelivery.exclusionReason,
    });
    let lastDelivery = firstDelivery;
    for (const event of items) {
      updatedAt = event.observedAt ?? updatedAt;
      if (event.event === 'delivery') {
        lastDelivery = event;
        status = 'waiting_acceptance';
        conversationOutcome = beginConversationDelivery(conversationOutcome, {
          deliveryId:event.deliveryId,
          deliveredAt:event.observedAt,
        });
        metrics = applyOutcomeMetricEvent(metrics, {
          event:'delivery',
          to:'waiting_acceptance',
          at:event.observedAt,
        });
      } else if (event.event === 'follow-up') {
        const closing = CLOSING_KINDS.has(event.kind);
        status = event.kind === 'defect-return' ? 'needs_rework' : closing ? 'closed' : 'waiting_acceptance';
        conversationOutcome = observeConversationFollowUp(conversationOutcome, {
          kind:event.kind,
          observationId:event.observationId,
          observedAt:event.observedAt,
          terminal:event.kind !== 'related-question',
        });
        metrics = applyOutcomeMetricEvent(metrics, {
          event:followUpEvent(event.kind),
          to:status,
          at:event.observedAt,
        });
      }
    }
    return {
      schemaVersion:10,
      taskId,
      source:'light-direct',
      status,
      classification:{ problemType:firstDelivery.problemType, continuity:'ephemeral' },
      baseline:{ gitRoot:firstDelivery.gitRoot },
      integration:{ required:false, resultCommit:lastDelivery.commit },
      outcomeMetrics:metrics,
      conversationOutcome,
      createdAt:firstDelivery.observedAt,
      updatedAt,
      acceptedAt:null,
      closedAt:status === 'closed' ? updatedAt : null,
    };
  }).filter(Boolean).filter((task) => !input.gitRoot || normalizePath(task.baseline.gitRoot) === normalizePath(input.gitRoot));
}
