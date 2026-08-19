import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePreservation } from './behavior-preservation.mjs';

export const ALIGNMENT_MODES = ['direct', 'confirmed', 'delegated'];
export const DIRECT_REASON_CODES = [
  'single-observable-outcome',
  'local-scope',
  'acceptance-derivable',
  'no-project-conflict',
];

function splitValues(value) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values
    .flatMap((item) => typeof item === 'string' ? item.split(/[\n;；]/u) : [])
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function uniqueValues(value) {
  return [...new Set(splitValues(value))];
}

function codeValues(value) {
  return [...new Set(splitValues(value)
    .flatMap((item) => item.split(/[,，]/u))
    .map((item) => item.trim())
    .filter(Boolean))];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function normalizeUserText(value) {
  return String(value ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
}

export function loadAlignmentFile(file) {
  if (!file) return null;
  let raw;
  try {
    raw = fs.readFileSync(path.resolve(file), 'utf8');
  } catch (error) {
    throw new Error(`无法读取对齐文件: ${error.message}`);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('对齐文件不是有效 JSON');
  }
  return normalizeAlignment(value);
}

export function normalizeAlignment(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('对齐内容必须是 JSON 对象');
  }
  const alignment = value.alignment ?? {};
  const preservation = value.preservation ? normalizePreservation(value.preservation) : null;
  return {
    schemaVersion: 1,
    originalRequest: normalizeUserText(value.originalRequest),
    goal: String(value.goal ?? '').trim(),
    expectedOutcomes: uniqueValues(value.expectedOutcomes),
    protectedBehaviors: uniqueValues(value.protectedBehaviors),
    acceptance: uniqueValues(value.acceptance),
    confirmedDecisions: uniqueValues(value.confirmedDecisions),
    nonGoals: uniqueValues(value.nonGoals),
    assumptions: uniqueValues(value.assumptions),
    alignment: {
      mode: String(alignment.mode ?? '').trim(),
      reasonCodes: codeValues(alignment.reasonCodes),
      decisionNote: alignment.decisionNote === undefined || alignment.decisionNote === null
        ? null
        : String(alignment.decisionNote).trim(),
      delegatedTopics: uniqueValues(alignment.delegatedTopics),
    },
    ...(preservation ? { preservation } : {}),
  };
}

export function validateAlignmentForPreparation({ alignment, classification }) {
  if (!alignment?.originalRequest) throw new Error('缺少 originalRequest');
  if (!alignment?.goal) throw new Error('缺少 Goal');
  if (!alignment?.expectedOutcomes?.length) throw new Error('至少需要一个 Expected Outcome');
  if (!alignment?.acceptance?.length && !alignment?.protectedBehaviors?.length) {
    throw new Error('至少需要一条 Acceptance 或 Protected Behavior');
  }
  const mode = alignment?.alignment?.mode;
  if (!ALIGNMENT_MODES.includes(mode)) throw new Error('alignment.mode 无效');
  const highControl = classification?.controlMode === 'controlled'
    || classification?.structureImpact === 'structural';
  if (highControl && mode === 'direct') {
    throw new Error('Controlled/Structural 任务必须 confirmed 或 delegated');
  }
  if (mode === 'direct') {
    const unknown = (alignment.alignment.reasonCodes ?? []).filter((code) => !DIRECT_REASON_CODES.includes(code));
    if (unknown.length) throw new Error(`direct 包含未知 reason code: ${unknown.join(', ')}`);
  }
  if ((mode === 'confirmed' || mode === 'delegated') && !alignment.alignment.decisionNote) {
    throw new Error('confirmed/delegated 必须记录 decisionNote');
  }
  if (mode === 'delegated' && !alignment.alignment.delegatedTopics?.length) {
    throw new Error('delegated 必须明确 delegatedTopics');
  }
  if ((alignment.preservation?.allowedDifferences ?? []).length && mode === 'direct') {
    throw new Error('存在 allowedDifferences 时不得使用 direct，必须 confirmed 或 delegated');
  }
  return alignment;
}

export function validateAlignmentForRealignment({ currentTask, nextAlignment }) {
  if (currentTask && (currentTask.status === 'accepted' || currentTask.status === 'cancelled')) {
    throw new Error('已结束任务不能重新对齐，应创建新 Task');
  }
  if (currentTask?.status === 'ready_to_integrate') {
    throw new Error('已 ready_to_integrate 的任务不能重新对齐，应创建新 Task');
  }
  if (!nextAlignment?.originalRequest) throw new Error('缺少 originalRequest');
  if (!nextAlignment?.goal) throw new Error('缺少 Goal');
  if (!nextAlignment?.expectedOutcomes?.length) throw new Error('至少需要一个 Expected Outcome');
  if (!nextAlignment?.acceptance?.length && !nextAlignment?.protectedBehaviors?.length) {
    throw new Error('至少需要一条 Acceptance 或 Protected Behavior');
  }
  const mode = nextAlignment?.alignment?.mode;
  if (mode !== 'confirmed' && mode !== 'delegated') {
    throw new Error('重新对齐只能使用 confirmed 或 delegated');
  }
  if (!nextAlignment.alignment.decisionNote) throw new Error('重新对齐必须记录 decisionNote');
  if (mode === 'delegated' && !nextAlignment.alignment.delegatedTopics?.length) {
    throw new Error('delegated 必须明确 delegatedTopics');
  }
  const initialOriginalRequest = normalizeUserText(currentTask?.goal?.originalRequest ?? currentTask?.goal?.summary ?? '');
  const nextOriginalRequest = normalizeUserText(nextAlignment?.originalRequest);
  if (nextOriginalRequest && nextOriginalRequest !== initialOriginalRequest) {
    throw new Error('alignment-original-request-mismatch: 重新对齐不能改变 initial originalRequest');
  }
  return nextAlignment;
}

export function evaluateFinalAlignment({ goal, classification }) {
  const required = classification?.controlMode === 'controlled'
    || classification?.structureImpact === 'structural';
  if (!required) return { required: false, satisfied: true, reason: null };
  const mode = goal?.alignment?.mode;
  if (mode === 'confirmed' || mode === 'delegated') {
    return { required: true, satisfied: true, reason: null };
  }
  if (mode === 'direct') {
    return { required: true, satisfied: false, reason: 'alignment-risk-escalation' };
  }
  return { required: true, satisfied: false, reason: 'alignment-required' };
}

export function computeAlignmentFingerprint({ goal, acceptance, scope }) {
  const canonical = {
    originalRequest: goal?.originalRequest ?? null,
    summary: goal?.summary ?? null,
    expectedOutcomes: goal?.expectedOutcomes ?? [],
    protectedBehaviors: goal?.protectedBehaviors ?? [],
    confirmedDecisions: goal?.confirmedDecisions ?? [],
    nonGoals: goal?.nonGoals ?? [],
    acceptance: (acceptance ?? []).map((item) => ({
      description: item.description ?? null,
      requiredCovers: item.requiredCovers ?? null,
      source: item.source ?? null,
    })),
    scope: scope?.path ?? null,
    mode: goal?.alignment?.mode ?? null,
    delegatedTopics: goal?.alignment?.delegatedTopics ?? [],
    preservation: goal?.preservation
      ? {
        mode: goal.preservation.mode ?? null,
        constraints: goal.preservation.constraints ?? [],
        referenceRoots: goal.preservation.referenceRoots ?? [],
        referenceCommit: goal.preservation.referenceCommit ?? null,
        referenceFiles: goal.preservation.referenceFiles ?? [],
        behaviors: goal.preservation.behaviors ?? [],
        excludedFiles: goal.preservation.excludedFiles ?? [],
        allowedDifferences: goal.preservation.allowedDifferences ?? [],
      }
      : null,
  };
  return crypto.createHash('sha256').update(stableJson(canonical)).digest('hex');
}

export function validateAlignmentFingerprint({ goal, acceptance, scope }) {
  if (!goal?.alignment?.baselineFingerprint || !goal?.preservation) {
    return { ok: true, reason: null };
  }
  const actual = computeAlignmentFingerprint({ goal, acceptance, scope });
  if (actual !== goal.alignment.baselineFingerprint) {
    return { ok: false, reason: 'alignment-fingerprint-mismatch' };
  }
  return { ok: true, reason: null };
}

export function buildAlignedGoal(alignment, acceptance, scope) {
  const meta = {
    schemaVersion: 1,
    mode: alignment.alignment.mode,
    reasonCodes: alignment.alignment.reasonCodes,
    decisionNote: alignment.alignment.decisionNote,
    delegatedTopics: alignment.alignment.delegatedTopics,
    revision: 1,
    createdAt: new Date().toISOString(),
    events: [],
  };
  const base = {
    originalRequest: alignment.originalRequest,
    summary: alignment.goal,
    expectedOutcomes: alignment.expectedOutcomes,
    protectedBehaviors: alignment.protectedBehaviors,
    confirmedDecisions: alignment.confirmedDecisions,
    nonGoals: alignment.nonGoals,
    assumptions: alignment.assumptions,
    openQuestions: [],
    ...(alignment.preservation ? { preservation: alignment.preservation } : {}),
  };
  const fingerprint = computeAlignmentFingerprint({
    goal: { ...base, alignment: { ...meta, baselineFingerprint: null } },
    acceptance,
    scope,
  });
  return { ...base, alignment: { ...meta, baselineFingerprint: fingerprint } };
}

export function synthesizeQuickAlignment({ intent, acceptance = [], nonGoals = [] }) {
  const values = uniqueValues(acceptance);
  return {
    schemaVersion: 1,
    originalRequest: intent,
    goal: intent,
    expectedOutcomes: values.length ? values : [intent],
    protectedBehaviors: [],
    acceptance: values,
    confirmedDecisions: [],
    nonGoals: uniqueValues(nonGoals),
    assumptions: [],
    alignment: {
      mode: 'direct',
      reasonCodes: ['quick-legacy'],
      decisionNote: null,
      delegatedTopics: [],
    },
  };
}

export function recordAlignmentEvent(goal, event) {
  if (!goal?.alignment) return goal;
  return {
    ...goal,
    alignment: {
      ...goal.alignment,
      events: [...(goal.alignment.events ?? []), { at: new Date().toISOString(), ...event }],
    },
  };
}
