import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { appendJsonLineLocked } from './atomic-file.mjs';
import { captureRepositoryIdentity, computeChangeSet } from './git-state.mjs';
import { findGitRoot, normalizePath, runGit } from './registry.mjs';
import { resolveStateRoot, taskMatchesRepository } from './state-manager.mjs';
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

function validObservedAt(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function validDeliveryShape(event) {
  return event?.schemaVersion === 1
    && event.event === 'delivery'
    && typeof event.taskId === 'string' && event.taskId.startsWith(LIGHT_TASK_PREFIX)
    && typeof event.deliveryId === 'string' && event.deliveryId.length > 0
    && validObservedAt(event.observedAt)
    && typeof event.gitRoot === 'string' && event.gitRoot.length > 0
    && typeof event.commit === 'string' && /^[0-9a-f]{40,64}$/iu.test(event.commit)
    && PROBLEM_TYPES.has(event.problemType)
    && Array.isArray(event.scopes) && event.scopes.length > 0
    && event.scopes.every((item) => typeof item === 'string' && item.length > 0)
    && Array.isArray(event.changedFiles) && event.changedFiles.length > 0
    && event.changedFiles.every((item) => typeof item === 'string' && item.length > 0)
    && typeof event.eligible === 'boolean';
}

function validFollowUpShape(event) {
  return event?.schemaVersion === 1
    && event.event === 'follow-up'
    && typeof event.taskId === 'string' && event.taskId.startsWith(LIGHT_TASK_PREFIX)
    && typeof event.deliveryId === 'string' && event.deliveryId.length > 0
    && typeof event.observationId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(event.observationId)
    && FOLLOW_UP_KINDS.has(event.kind)
    && validObservedAt(event.observedAt);
}

export function diagnoseLightOutcomeLedger(input = {}) {
  const files = ledgerPaths(input.stateRoot);
  if (!fs.existsSync(files.events)) {
    return { schemaVersion:1, readOnly:true, ok:true, count:0, diagnostics:[] };
  }
  let lines;
  try {
    lines = fs.readFileSync(files.events, 'utf8').split(/\r?\n/u)
      .map((line, index) => ({ line, lineNumber:index + 1 }))
      .filter((item) => item.line.length > 0);
  } catch {
    return {
      schemaVersion:1,
      readOnly:true,
      ok:false,
      count:0,
      diagnostics:[{ code:'ledger-unreadable', line:null }],
    };
  }
  const diagnostics = [];
  const deliveries = new Set();
  for (const item of lines) {
    const { line, lineNumber } = item;
    let event;
    try { event = JSON.parse(line); }
    catch {
      diagnostics.push({ code:'invalid-json', line:lineNumber });
      continue;
    }
    if (event?.event === 'delivery') {
      if (!validDeliveryShape(event)) {
        diagnostics.push({ code:'invalid-delivery-shape', line:lineNumber });
        continue;
      }
      const key = `${event.taskId}\0${event.deliveryId}`;
      if (deliveries.has(key)) diagnostics.push({ code:'duplicate-delivery', line:lineNumber, taskId:event.taskId, deliveryId:event.deliveryId });
      else deliveries.add(key);
      continue;
    }
    if (event?.event === 'follow-up') {
      if (!validFollowUpShape(event)) {
        diagnostics.push({ code:'invalid-follow-up-shape', line:lineNumber });
        continue;
      }
      if (!deliveries.has(`${event.taskId}\0${event.deliveryId}`)) {
        diagnostics.push({ code:'orphan-follow-up', line:lineNumber, taskId:event.taskId, deliveryId:event.deliveryId });
      }
      continue;
    }
    diagnostics.push({ code:'unknown-event', line:lineNumber });
  }
  return {
    schemaVersion:1,
    readOnly:true,
    ok:diagnostics.length === 0,
    count:lines.length,
    diagnostics,
  };
}

function sampleEvents(events, taskId) {
  return events.filter((event) => event.taskId === taskId);
}

function requiredBinding(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`轻量交付缺少验证绑定字段 ${name}`);
  return normalized;
}

function sameStringSet(left, right) {
  const normalized = (value) => [...(Array.isArray(value) ? value : [])].map(String).sort();
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function deliveryMatchesRepository(event, repositoryIdentity) {
  return taskMatchesRepository({
    baseline:{
      gitRoot:event.gitRoot,
      gitCommonDir:event.gitCommonDir ?? null,
    },
  }, repositoryIdentity);
}

function assertIdempotentDeliveryMetadata(event, expected) {
  const matches = String(event.baselineHead ?? '').toLowerCase() === expected.baselineHead.toLowerCase()
    && String(event.verifiedChangeFingerprint ?? '').toLowerCase() === expected.verifiedChangeFingerprint.toLowerCase()
    && event.problemType === expected.problemType
    && sameStringSet(event.scopes, expected.scopes)
    && sameStringSet(event.changedFiles, expected.changedFiles)
    && event.eligible === expected.eligible
    && (event.exclusionReason ?? null) === expected.exclusionReason
    && isDeepStrictEqual(event.evaluationContext ?? null, expected.evaluationContext);
  if (!matches) throw new Error('同一轻量交付提交的重试元数据与既有记录冲突');
}

function lightDeliveryReceipt(event, flags = {}) {
  return {
    schemaVersion:2,
    view:'outcome',
    taskId:event.taskId,
    state:'delivered',
    stateLabel:'本轮已交付',
    source:'light-direct',
    problemType:event.problemType,
    localCommit:event.commit,
    scopes:event.scopes,
    recorded:flags.recorded !== false,
    idempotent:flags.idempotent === true,
    continuation:{ taskId:event.taskId, deliveryId:event.deliveryId },
    next:'无需形式确认；下一条相关消息将更新同一问题的完成轮次。',
  };
}

function assertLocalCommit(cwd, input) {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) throw new Error('轻量交付必须位于可确认的 Git 工作树');
  const requested = String(input.commit ?? '').trim();
  if (!requested) throw new Error('轻量交付必须提供验证后形成的本地 --commit');
  const baselineHead = requiredBinding(input.baselineHead, 'baselineHead');
  const baselineGitRoot = requiredBinding(input.baselineGitRoot, 'baselineGitRoot');
  const baselineGitCommonDir = requiredBinding(input.baselineGitCommonDir, 'baselineGitCommonDir');
  const verifiedChangeFingerprint = requiredBinding(input.verifiedChangeFingerprint, 'verifiedChangeFingerprint');
  const repositoryIdentity = captureRepositoryIdentity(gitRoot);
  if (normalizePath(repositoryIdentity.gitRoot) !== normalizePath(baselineGitRoot)
    || normalizePath(repositoryIdentity.gitCommonDir) !== normalizePath(baselineGitCommonDir)) {
    throw new Error('轻量交付当前仓库身份与验证 Baseline 不一致');
  }
  const resolved = runGit(gitRoot, ['rev-parse', `${requested}^{commit}`]);
  const head = runGit(gitRoot, ['rev-parse', 'HEAD']);
  if (!resolved || !head || resolved !== head) throw new Error('轻量交付提交必须等于当前工作树 HEAD');
  const status = runGit(gitRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status === null) throw new Error('无法确认轻量交付工作树状态');
  if (status !== '') throw new Error('轻量交付记录要求验证后的修改已经全部本地提交且工作树干净');
  if (!/^[0-9a-f]{40,64}$/iu.test(baselineHead)) throw new Error('轻量交付 baselineHead 必须是完整 Git Commit');
  const resolvedBaseline = runGit(gitRoot, ['rev-parse', `${baselineHead}^{commit}`]);
  if (!resolvedBaseline || resolvedBaseline.toLowerCase() !== baselineHead.toLowerCase()) {
    throw new Error('轻量交付验证 Baseline Commit 无法确认');
  }
  const commitLine = runGit(gitRoot, ['rev-list', '--parents', '--max-count=1', head]);
  const [recordedHead, ...parents] = String(commitLine ?? '').split(/\s+/u).filter(Boolean);
  if (recordedHead !== head || parents.length !== 1 || parents[0] !== resolvedBaseline) {
    throw new Error('轻量交付提交必须是验证 Baseline 的单父直系提交');
  }
  const changeSet = computeChangeSet({
    schemaVersion:4,
    gitRoot:repositoryIdentity.gitRoot,
    gitCommonDir:repositoryIdentity.gitCommonDir,
    head:resolvedBaseline,
    files:[],
  });
  if (!changeSet.semanticFingerprint
    || changeSet.semanticFingerprint.toLowerCase() !== verifiedChangeFingerprint.toLowerCase()) {
    throw new Error('轻量交付提交与验证通过的 ChangeSet 语义指纹不一致');
  }
  return {
    ...repositoryIdentity,
    baselineHead:resolvedBaseline,
    commit:head,
    semanticFingerprint:changeSet.semanticFingerprint,
  };
}

export function recordLightDelivery(input = {}) {
  const files = ledgerPaths(input.stateRoot);
  const commit = assertLocalCommit(path.resolve(input.cwd ?? process.cwd()), input);
  const scopes = normalizedScopes(input.scope);
  const changedFiles = assertCommitScope(commit.gitRoot, commit.commit, scopes);
  const type = problemType(input.problemType);
  const existingEvents = readLightOutcomeEvents({ stateRoot:files.root });
  const requestedTaskId = String(input.taskId ?? '').trim();
  if (requestedTaskId && !requestedTaskId.startsWith(LIGHT_TASK_PREFIX)) throw new Error(`轻量结果编号必须以 ${LIGHT_TASK_PREFIX} 开头`);
  const eligible = input.eligible !== false && type !== 'unknown';
  const exclusionReason = input.eligible === false || type === 'unknown'
    ? String(input.exclusionReason ?? (type === 'unknown' ? 'unknown-problem-type' : 'explicit-exclusion'))
    : null;
  const evaluationContext = input.evaluationContext ?? null;
  const sameCommit = existingEvents.filter((event) => event?.event === 'delivery'
    && String(event.commit ?? '').toLowerCase() === commit.commit.toLowerCase()
    && deliveryMatchesRepository(event, commit));
  if (sameCommit.length > 1) throw new Error('同一仓库提交已有多个轻量交付记录，无法安全判定重试归属');
  if (sameCommit.length === 1) {
    const [existing] = sameCommit;
    if (requestedTaskId && existing.taskId !== requestedTaskId) {
      throw new Error('同一轻量交付提交已归属于其他结果编号');
    }
    assertIdempotentDeliveryMetadata(existing, {
      baselineHead:commit.baselineHead,
      verifiedChangeFingerprint:commit.semanticFingerprint,
      problemType:type,
      scopes,
      changedFiles,
      eligible,
      exclusionReason,
      evaluationContext,
    });
    return lightDeliveryReceipt(existing, { recorded:false, idempotent:true });
  }
  const taskId = requestedTaskId || makeId(LIGHT_TASK_PREFIX);
  const previous = sampleEvents(existingEvents, taskId);
  if (requestedTaskId) {
    if (!previous.length) throw new Error(`未找到轻量结果记录: ${taskId}`);
    const reconstructed = readLightOutcomeTasks({ stateRoot:files.root }).find((task) => task.taskId === taskId);
    if (reconstructed?.status !== 'needs_rework') throw new Error('只有缺陷退回后的轻量结果可以继续记录同一问题的新提交');
    if (!taskMatchesRepository(reconstructed, commit)) throw new Error('轻量结果不能跨 Git 项目续写');
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
    gitCommonDir:commit.gitCommonDir,
    baselineHead:commit.baselineHead,
    commit:commit.commit,
    verifiedChangeFingerprint:commit.semanticFingerprint,
    scopes,
    changedFiles,
    problemType:type,
    eligible,
    exclusionReason,
    evaluationContext,
  };
  appendJsonLineLocked(files.events, event, files.lock);
  return lightDeliveryReceipt(event, { recorded:true, idempotent:false });
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
  const repositoryIdentity = input.repositoryIdentity ?? (input.gitRoot ? { gitRoot:input.gitRoot } : null);
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
      baseline:{
        gitRoot:firstDelivery.gitRoot,
        gitCommonDir:firstDelivery.gitCommonDir ?? null,
      },
      integration:{ required:false, resultCommit:lastDelivery.commit },
      evaluationContext:firstDelivery.evaluationContext ?? null,
      outcomeMetrics:metrics,
      conversationOutcome,
      createdAt:firstDelivery.observedAt,
      updatedAt,
      acceptedAt:null,
      closedAt:status === 'closed' ? updatedAt : null,
    };
  }).filter(Boolean).filter((task) => !repositoryIdentity || taskMatchesRepository(task, repositoryIdentity));
}
