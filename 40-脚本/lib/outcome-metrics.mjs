const PUBLIC_STATES = {
  working: { id: 'working', label: '正在处理' },
  needs_decision: { id: 'needs_decision', label: '需要你决定' },
  delivered: { id: 'delivered', label: '本轮已交付' },
  done: { id: 'done', label: '已结束' },
};

export const FOLLOW_UP_KINDS = new Set([
  'related-question',
  'defect-return',
  'scope-extension',
  'positive-acknowledgement',
  'topic-advance',
]);

const SINGLE_TURN_CLOSURES = new Set([
  'scope-extension',
  'positive-acknowledgement',
  'topic-advance',
]);

const WORKING_INTERNAL_STATES = new Set([
  'prepared', 'implementing', 'verifying', 'reviewing', 'ready_to_integrate', 'needs_rework',
]);

const RETURN_REASON_CATEGORIES = new Set([
  'goal-mismatch',
  'scope',
  'verification-gap',
  'code-quality',
  'regression',
  'unnecessary-change',
  'other',
  'uncategorized',
]);

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function integerNonNegative(value, fallback = 0) {
  return Math.trunc(finiteNonNegative(value, fallback));
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function periodBoundary(value, label) {
  if (!value) return null;
  const text = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(text)
    ? new Date(`${text}${label === '--to' ? 'T23:59:59.999' : 'T00:00:00.000'}`)
    : new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} 必须是有效日期或时间`);
  return date.toISOString();
}

function taskTimestamp(task) {
  return isoOrNull(task.acceptedAt ?? task.closedAt ?? task.updatedAt ?? task.createdAt);
}

export function publicTaskState(status) {
  if (status === 'waiting_acceptance') return PUBLIC_STATES.delivered;
  if (status === 'accepted' || status === 'closed' || status === 'cancelled') return PUBLIC_STATES.done;
  if (WORKING_INTERNAL_STATES.has(status)) return PUBLIC_STATES.working;
  return PUBLIC_STATES.needs_decision;
}

function followUpCounts(value = {}) {
  return Object.fromEntries([...FOLLOW_UP_KINDS].map((kind) => [kind, integerNonNegative(value[kind])]));
}

function normalizedFollowUp(value) {
  if (!value || !FOLLOW_UP_KINDS.has(value.kind)) return null;
  const observationId = String(value.observationId ?? '').trim();
  const observedAt = isoOrNull(value.observedAt);
  if (!observationId || !observedAt) return null;
  return { observationId, kind: value.kind, observedAt };
}

export function normalizeConversationOutcome(value) {
  if (!value || !value.deliveryId) return null;
  const firstDeliveryFollowUpKind = FOLLOW_UP_KINDS.has(value.firstDeliveryFollowUpKind)
    ? value.firstDeliveryFollowUpKind
    : null;
  return {
    schemaVersion: 1,
    deliveryId: String(value.deliveryId),
    deliveredAt: isoOrNull(value.deliveredAt),
    firstFollowUp: normalizedFollowUp(value.firstFollowUp),
    terminalFollowUp: normalizedFollowUp(value.terminalFollowUp),
    firstDeliveryFollowUpKind,
    counts: followUpCounts(value.counts),
  };
}

export function beginConversationDelivery(previous, input = {}) {
  const normalized = normalizeConversationOutcome(previous);
  return {
    schemaVersion: 1,
    deliveryId: String(input.deliveryId),
    deliveredAt: isoOrNull(input.deliveredAt) ?? new Date().toISOString(),
    firstFollowUp: null,
    terminalFollowUp: null,
    firstDeliveryFollowUpKind: normalized?.firstDeliveryFollowUpKind ?? null,
    counts: followUpCounts(normalized?.counts),
  };
}

export function observeConversationFollowUp(previous, input = {}) {
  const normalized = normalizeConversationOutcome(previous);
  if (!normalized) throw new Error('任务缺少可关联的交付 continuation');
  if (!FOLLOW_UP_KINDS.has(input.kind)) throw new Error(`后续类型无效: ${input.kind ?? 'unknown'}`);
  const observation = {
    observationId: String(input.observationId),
    kind: input.kind,
    observedAt: isoOrNull(input.observedAt) ?? new Date().toISOString(),
  };
  const counts = { ...normalized.counts, [input.kind]: normalized.counts[input.kind] + 1 };
  return {
    ...normalized,
    firstFollowUp: normalized.firstFollowUp ?? observation,
    terminalFollowUp: input.terminal === true ? observation : normalized.terminalFollowUp,
    firstDeliveryFollowUpKind: normalized.firstDeliveryFollowUpKind ?? input.kind,
    counts,
  };
}

export function singleTurnClosure(conversationOutcome) {
  const kind = normalizeConversationOutcome(conversationOutcome)?.firstDeliveryFollowUpKind;
  if (!kind) return null;
  return SINGLE_TURN_CLOSURES.has(kind);
}

export function publicTaskStateForTask(task = {}) {
  const stopReason = String(task.verification?.stopReason ?? '');
  if (['alignment-required', 'alignment-risk-escalation', 'budget'].includes(stopReason)) {
    return PUBLIC_STATES.needs_decision;
  }
  return publicTaskState(task.status);
}

export function createOutcomeMetrics(input = {}) {
  const at = isoOrNull(input.at) ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    trackingStartedAt: input.trackingStartedAt === null ? null : (isoOrNull(input.trackingStartedAt) ?? at),
    preparedAt: isoOrNull(input.preparedAt) ?? at,
    firstDeliveryAt: null,
    readyForAcceptanceAt: null,
    deliveryAttemptCount: 0,
    verificationRunCount: 0,
    verificationDurationMs: 0,
    userDecisionCount: integerNonNegative(input.initialUserDecisionCount),
    reworkCount: 0,
    firstPassAccepted: null,
    returnReasons: [],
  };
}

export function normalizeOutcomeMetrics(value, input = {}) {
  if (!value) {
    return createOutcomeMetrics({
      at: input.createdAt,
      preparedAt: input.createdAt,
      trackingStartedAt: null,
    });
  }
  const base = createOutcomeMetrics({
    at: value.trackingStartedAt ?? input.createdAt,
    preparedAt: value.preparedAt ?? input.createdAt,
    trackingStartedAt: value.trackingStartedAt ?? null,
  });
  return {
    ...base,
    ...value,
    schemaVersion: 1,
    trackingStartedAt: isoOrNull(value.trackingStartedAt),
    preparedAt: isoOrNull(value.preparedAt) ?? isoOrNull(input.createdAt),
    firstDeliveryAt: isoOrNull(value.firstDeliveryAt),
    readyForAcceptanceAt: isoOrNull(value.readyForAcceptanceAt),
    deliveryAttemptCount: integerNonNegative(value.deliveryAttemptCount),
    verificationRunCount: integerNonNegative(value.verificationRunCount),
    verificationDurationMs: finiteNonNegative(value.verificationDurationMs),
    userDecisionCount: integerNonNegative(value.userDecisionCount),
    reworkCount: integerNonNegative(value.reworkCount),
    firstPassAccepted: typeof value.firstPassAccepted === 'boolean' ? value.firstPassAccepted : null,
    returnReasons: Array.isArray(value.returnReasons) ? value.returnReasons.map((item) => ({
      at: isoOrNull(item.at),
      category: RETURN_REASON_CATEGORIES.has(item.category) ? item.category : 'uncategorized',
      note: item.note == null ? null : String(item.note),
    })) : [],
  };
}

export function normalizeReturnReasonCategory(value) {
  if (value == null || String(value).trim() === '') return 'uncategorized';
  const category = String(value).trim();
  if (!RETURN_REASON_CATEGORIES.has(category)) {
    throw new Error(`退回原因分类无效: ${category}`);
  }
  return category;
}

export function applyOutcomeMetricEvent(value, input = {}) {
  const at = isoOrNull(input.at) ?? new Date().toISOString();
  const next = normalizeOutcomeMetrics(value, { createdAt: input.createdAt ?? at });
  next.trackingStartedAt ??= at;

  if (input.event === 'delivery') {
    next.firstDeliveryAt ??= at;
    next.deliveryAttemptCount += 1;
    if (input.durationMs !== undefined) {
      next.verificationRunCount += 1;
      next.verificationDurationMs += finiteNonNegative(input.durationMs);
    }
  }

  if (input.to === 'waiting_acceptance') next.readyForAcceptanceAt ??= at;

  if (['realign', 'verification-continue', 'user-accept', 'user-reject', 'user-cancel'].includes(input.event)) {
    next.userDecisionCount += 1;
  }

  if (input.event === 'user-reject') {
    next.reworkCount += 1;
    if (next.firstPassAccepted === null) next.firstPassAccepted = false;
    next.returnReasons.push({
      at,
      category: normalizeReturnReasonCategory(input.reasonCategory),
      note: input.note == null ? null : String(input.note),
    });
  } else if (input.event === 'user-accept' && next.firstPassAccepted === null) {
    next.firstPassAccepted = true;
  }

  return next;
}

export function summarizeOutcomeMetrics(tasks = [], options = {}) {
  const from = periodBoundary(options.from, '--from');
  const to = periodBoundary(options.to, '--to');
  if (from && to && from > to) throw new Error('--from 不能晚于 --to');

  const selected = tasks.filter((task) => {
    const timestamp = taskTimestamp(task);
    if (!timestamp) return !from && !to;
    return (!from || timestamp >= from) && (!to || timestamp <= to);
  });
  const tracked = selected.filter((task) => task.outcomeMetrics?.trackingStartedAt);
  const decided = tracked.filter((task) => typeof task.outcomeMetrics.firstPassAccepted === 'boolean');
  const unknown = tracked.length - decided.length;
  const firstPassAccepted = decided.filter((task) => task.outcomeMetrics.firstPassAccepted === true).length;
  const verificationTasks = tracked.filter((task) => task.outcomeMetrics.verificationRunCount > 0);
  const verificationRuns = verificationTasks.reduce((sum, task) => sum + task.outcomeMetrics.verificationRunCount, 0);
  const verificationDurationMs = verificationTasks.reduce((sum, task) => sum + task.outcomeMetrics.verificationDurationMs, 0);
  const reworkTasks = tracked.filter((task) => task.outcomeMetrics.reworkCount > 0);
  const reworkCount = reworkTasks.reduce((sum, task) => sum + task.outcomeMetrics.reworkCount, 0);
  const userDecisionCount = tracked.reduce((sum, task) => sum + task.outcomeMetrics.userDecisionCount, 0);
  const conversationTracked = selected.filter((task) => normalizeConversationOutcome(task.conversationOutcome));
  const singleTurnDecided = conversationTracked.filter((task) => singleTurnClosure(task.conversationOutcome) !== null);
  const singleTurnPassed = singleTurnDecided.filter((task) => singleTurnClosure(task.conversationOutcome) === true);
  const followUps = Object.fromEntries([...FOLLOW_UP_KINDS].map((kind) => [
    kind,
    conversationTracked.reduce((sum, task) => sum + normalizeConversationOutcome(task.conversationOutcome).counts[kind], 0),
  ]));
  const implicitClosures = selected.filter((task) => task.status === 'closed').length;
  const reasons = new Map();
  for (const task of tracked) {
    for (const reason of task.outcomeMetrics.returnReasons ?? []) {
      reasons.set(reason.category, (reasons.get(reason.category) ?? 0) + 1);
    }
  }
  const stateCounts = { working:0, needs_decision:0, delivered:0, done:0 };
  for (const task of selected) {
    const state = publicTaskStateForTask(task).id;
    stateCounts[state] = (stateCounts[state] ?? 0) + 1;
  }
  const warnings = [];
  if (tracked.length < 10) warnings.push('有效指标样本少于 10，只能用于方向观察');
  if (selected.length > tracked.length) warnings.push(`${selected.length - tracked.length} 条旧 Task 没有完整指标，未纳入比率和耗时计算`);
  if (unknown > 0) warnings.push(`${unknown} 条已跟踪 Task 没有明确用户验收，不能纳入首轮验收结论`);
  if (conversationTracked.length < 10) warnings.push('对话收口样本少于 10，只能用于方向观察');
  if (conversationTracked.length > singleTurnDecided.length) {
    warnings.push(`${conversationTracked.length - singleTurnDecided.length} 条已交付 Task 尚未观察到后续消息，单轮闭环保持未知`);
  }
  warnings.push('返工只统计同一 Task 内显式记录的用户退回；未关联的新修复 Task 不在返工计数中');
  warnings.push('本摘要不包含可比基线，不能单独证明机制净收益');

  return {
    schemaVersion: 2,
    view: 'outcome-metrics',
    period: { from, to },
    sample: {
      total: selected.length,
      tracked: tracked.length,
      legacyWithoutMetrics: selected.length - tracked.length,
      stateCounts,
    },
    firstPassAcceptance: {
      decided: decided.length,
      unknown,
      passed: firstPassAccepted,
      rate: decided.length ? Number((firstPassAccepted / decided.length).toFixed(4)) : null,
      coverage: tracked.length ? Number((decided.length / tracked.length).toFixed(4)) : null,
    },
    explicitAcceptance: {
      decided: decided.length,
      unknown,
      passed: firstPassAccepted,
      rate: decided.length ? Number((firstPassAccepted / decided.length).toFixed(4)) : null,
      coverage: tracked.length ? Number((decided.length / tracked.length).toFixed(4)) : null,
    },
    conversationClosure: {
      tracked: conversationTracked.length,
      implicitClosures,
      singleTurn: {
        decided: singleTurnDecided.length,
        unknown: conversationTracked.length - singleTurnDecided.length,
        passed: singleTurnPassed.length,
        rate: singleTurnDecided.length ? Number((singleTurnPassed.length / singleTurnDecided.length).toFixed(4)) : null,
        coverage: conversationTracked.length ? Number((singleTurnDecided.length / conversationTracked.length).toFixed(4)) : null,
      },
      followUps,
    },
    rework: {
      tasks: reworkTasks.length,
      count: reworkCount,
      countingScope: 'same-task-explicit-user-reject',
      unlinkedRepairTasksIncluded: false,
    },
    userDecisions: { count: userDecisionCount },
    verification: {
      tasks: verificationTasks.length,
      runs: verificationRuns,
      totalMs: verificationDurationMs,
      averageMs: verificationRuns ? Math.round(verificationDurationMs / verificationRuns) : null,
    },
    returnReasons: [...reasons.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, count]) => ({ category, count })),
    warnings,
  };
}
