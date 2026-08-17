import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
  return {
    schemaVersion: 1,
    originalRequest: String(value.originalRequest ?? '').trim(),
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
    const actual = new Set(alignment.alignment.reasonCodes ?? []);
    const missing = DIRECT_REASON_CODES.filter((code) => !actual.has(code));
    if (missing.length) throw new Error(`direct 缺少依据: ${missing.join(', ')}`);
  }
  if ((mode === 'confirmed' || mode === 'delegated') && !alignment.alignment.decisionNote) {
    throw new Error('confirmed/delegated 必须记录 decisionNote');
  }
  if (mode === 'delegated' && !alignment.alignment.delegatedTopics?.length) {
    throw new Error('delegated 必须明确 delegatedTopics');
  }
  return alignment;
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
  };
  return crypto.createHash('sha256').update(stableJson(canonical)).digest('hex');
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
