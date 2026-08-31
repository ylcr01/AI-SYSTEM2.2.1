const PUBLIC_STATES = {
  working: { id: 'working', label: '正在处理' },
  needs_decision: { id: 'needs_decision', label: '需要你决定' },
  delivered: { id: 'delivered', label: '本轮已交付' },
  done: { id: 'done', label: '已结束' },
};

export const COMPLETION_MEASUREMENT_VERSION = 'completion-rounds-v1';
export const DEFAULT_QUIET_DAYS = 7;

export const FOLLOW_UP_KINDS = new Set([
  'related-question',
  'defect-return',
  'scope-extension',
  'positive-acknowledgement',
  'topic-advance',
]);

const PROBLEM_TYPES = new Set([
  'bugfix', 'feature', 'refactor', 'migration', 'integration',
  'documentation', 'maintenance', 'external-operation', 'unknown',
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
  'defect-return',
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

function normalizedProblemType(value) {
  const type = String(value ?? '').trim();
  return PROBLEM_TYPES.has(type) ? type : 'unknown';
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
  return isoOrNull(task.outcomeMetrics?.completedAt ?? task.acceptedAt ?? task.closedAt ?? task.updatedAt ?? task.createdAt);
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

function normalizedObservations(value = {}) {
  const candidates = [
    ...(Array.isArray(value.observations) ? value.observations : []),
    value.firstFollowUp,
    value.terminalFollowUp,
  ].map(normalizedFollowUp).filter(Boolean);
  const seen = new Set();
  return candidates.filter((item) => {
    if (seen.has(item.observationId)) return false;
    seen.add(item.observationId);
    return true;
  });
}

export function normalizeConversationOutcome(value) {
  if (!value || !value.deliveryId) return null;
  const firstDeliveryFollowUpKind = FOLLOW_UP_KINDS.has(value.firstDeliveryFollowUpKind)
    ? value.firstDeliveryFollowUpKind
    : null;
  return {
    schemaVersion: 2,
    deliveryId: String(value.deliveryId),
    deliveredAt: isoOrNull(value.deliveredAt),
    firstFollowUp: normalizedFollowUp(value.firstFollowUp),
    terminalFollowUp: normalizedFollowUp(value.terminalFollowUp),
    firstDeliveryFollowUpKind,
    counts: followUpCounts(value.counts),
    observations: normalizedObservations(value),
  };
}

export function beginConversationDelivery(previous, input = {}) {
  const normalized = normalizeConversationOutcome(previous);
  return {
    schemaVersion: 2,
    deliveryId: String(input.deliveryId),
    deliveredAt: isoOrNull(input.deliveredAt) ?? new Date().toISOString(),
    firstFollowUp: null,
    terminalFollowUp: null,
    firstDeliveryFollowUpKind: normalized?.firstDeliveryFollowUpKind ?? null,
    counts: followUpCounts(normalized?.counts),
    observations: normalized?.observations ?? [],
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
  const duplicate = normalized.observations.find((item) => item.observationId === observation.observationId);
  if (duplicate) {
    if (duplicate.kind !== observation.kind) throw new Error('同一 observation-id 不能记录为不同后续类型');
    return normalized;
  }
  const counts = { ...normalized.counts, [input.kind]: normalized.counts[input.kind] + 1 };
  return {
    ...normalized,
    firstFollowUp: normalized.firstFollowUp ?? observation,
    terminalFollowUp: input.terminal === true ? observation : normalized.terminalFollowUp,
    firstDeliveryFollowUpKind: normalized.firstDeliveryFollowUpKind ?? input.kind,
    counts,
    observations: [...normalized.observations, observation],
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
  const measurementVersion = input.measurementVersion === null ? null : COMPLETION_MEASUREMENT_VERSION;
  const problemType = normalizedProblemType(input.problemType);
  const eligible = measurementVersion !== null && input.eligible !== false && problemType !== 'unknown';
  return {
    schemaVersion: measurementVersion ? 2 : 1,
    measurementVersion,
    problemType,
    eligible,
    exclusionReason: eligible ? null : (input.exclusionReason ?? (problemType === 'unknown' ? 'unknown-problem-type' : 'legacy-before-completion-rounds')),
    trackingStartedAt: input.trackingStartedAt === null ? null : (isoOrNull(input.trackingStartedAt) ?? at),
    preparedAt: isoOrNull(input.preparedAt) ?? at,
    firstDeliveryAt: null,
    firstQualifiedDeliveryAt: null,
    readyForAcceptanceAt: null,
    lastOutcomeActivityAt: null,
    completedAt: null,
    completionBasis: null,
    relatedFollowUpCount: 0,
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
      measurementVersion: null,
    });
  }
  const measured = value.measurementVersion === COMPLETION_MEASUREMENT_VERSION || Number(value.schemaVersion) >= 2;
  const base = createOutcomeMetrics({
    at: value.trackingStartedAt ?? input.createdAt,
    preparedAt: value.preparedAt ?? input.createdAt,
    trackingStartedAt: value.trackingStartedAt ?? null,
    measurementVersion: measured ? COMPLETION_MEASUREMENT_VERSION : null,
    problemType: value.problemType,
    eligible: value.eligible,
    exclusionReason: value.exclusionReason,
  });
  const problemType = normalizedProblemType(value.problemType);
  const eligible = measured && value.eligible !== false && problemType !== 'unknown';
  return {
    ...base,
    ...value,
    schemaVersion: measured ? 2 : 1,
    measurementVersion: measured ? COMPLETION_MEASUREMENT_VERSION : null,
    problemType,
    eligible,
    exclusionReason: eligible ? null : (value.exclusionReason ?? (measured ? 'unknown-problem-type' : 'legacy-before-completion-rounds')),
    trackingStartedAt: isoOrNull(value.trackingStartedAt),
    preparedAt: isoOrNull(value.preparedAt) ?? isoOrNull(input.createdAt),
    firstDeliveryAt: isoOrNull(value.firstDeliveryAt),
    firstQualifiedDeliveryAt: isoOrNull(value.firstQualifiedDeliveryAt),
    readyForAcceptanceAt: isoOrNull(value.readyForAcceptanceAt),
    lastOutcomeActivityAt: isoOrNull(value.lastOutcomeActivityAt),
    completedAt: isoOrNull(value.completedAt),
    completionBasis: value.completionBasis == null ? null : String(value.completionBasis),
    relatedFollowUpCount: integerNonNegative(value.relatedFollowUpCount),
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
  if (!RETURN_REASON_CATEGORIES.has(category)) throw new Error(`退回原因分类无效: ${category}`);
  return category;
}

const COMPLETION_EVENTS = {
  'user-accept': 'explicit-acceptance',
  'conversation-scope-extension': 'scope-extension',
  'conversation-positive-acknowledgement': 'positive-acknowledgement',
  'conversation-topic-advance': 'topic-advance',
};

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

  if (input.to === 'waiting_acceptance') {
    next.readyForAcceptanceAt ??= at;
    if (next.measurementVersion === COMPLETION_MEASUREMENT_VERSION) {
      next.firstQualifiedDeliveryAt ??= at;
      next.lastOutcomeActivityAt = at;
      next.completedAt = null;
      next.completionBasis = null;
    }
  }

  if (['realign', 'verification-continue', 'user-accept', 'user-reject', 'user-cancel'].includes(input.event)) {
    next.userDecisionCount += 1;
  }

  const relatedEvent = ['conversation-related-question', 'conversation-defect-return', 'user-reject'].includes(input.event);
  if (relatedEvent && next.measurementVersion === COMPLETION_MEASUREMENT_VERSION) {
    next.relatedFollowUpCount += 1;
    next.lastOutcomeActivityAt = at;
    next.completedAt = null;
    next.completionBasis = null;
  }

  if (input.event === 'user-reject' || input.event === 'conversation-defect-return') {
    next.reworkCount += 1;
    if (input.event === 'user-reject' && next.firstPassAccepted === null) next.firstPassAccepted = false;
    next.returnReasons.push({
      at,
      category: input.event === 'conversation-defect-return' ? 'defect-return' : normalizeReturnReasonCategory(input.reasonCategory),
      note: input.note == null ? null : String(input.note),
    });
  } else if (input.event === 'user-accept' && next.firstPassAccepted === null) {
    next.firstPassAccepted = true;
  }

  if (next.measurementVersion === COMPLETION_MEASUREMENT_VERSION && COMPLETION_EVENTS[input.event]) {
    next.completedAt = at;
    next.lastOutcomeActivityAt = at;
    next.completionBasis = COMPLETION_EVENTS[input.event];
  }

  return next;
}

function completionView(task, nowMs, quietDays) {
  const metrics = normalizeOutcomeMetrics(task.outcomeMetrics, { createdAt: task.createdAt });
  if (metrics.measurementVersion !== COMPLETION_MEASUREMENT_VERSION || !metrics.eligible) return null;
  if (!metrics.firstQualifiedDeliveryAt) return { state: 'pending-delivery', round: null, basis: null };
  const round = 1 + metrics.relatedFollowUpCount;
  if (metrics.completedAt) return { state: 'completed', round, basis: metrics.completionBasis ?? 'terminal-event' };
  if (['accepted', 'closed'].includes(task.status)) return { state: 'completed', round, basis: task.status };
  const activity = isoOrNull(metrics.lastOutcomeActivityAt ?? metrics.readyForAcceptanceAt ?? metrics.firstQualifiedDeliveryAt);
  const quietMs = quietDays * 24 * 60 * 60 * 1000;
  if (task.status === 'waiting_acceptance' && activity && nowMs - Date.parse(activity) >= quietMs) {
    return { state: 'completed', round, basis: 'quiet-window' };
  }
  if (task.status === 'waiting_acceptance') return { state: 'observing', round: null, basis: null };
  return { state: 'in-progress', round: null, basis: null };
}

function distributionFor(items) {
  const exact = new Map();
  for (const item of items) exact.set(item.completion.round, (exact.get(item.completion.round) ?? 0) + 1);
  const total = items.length;
  const groupedCounts = {
    one: exact.get(1) ?? 0,
    two: exact.get(2) ?? 0,
    three: exact.get(3) ?? 0,
    fourPlus: [...exact.entries()].filter(([round]) => round >= 4).reduce((sum, [, count]) => sum + count, 0),
  };
  return {
    denominator: total,
    exact: [...exact.entries()].sort(([left], [right]) => left - right).map(([round, count]) => ({
      round,
      count,
      rate: total ? Number((count / total).toFixed(4)) : null,
    })),
    grouped: Object.fromEntries(Object.entries(groupedCounts).map(([key, count]) => [key, {
      count,
      rate: total ? Number((count / total).toFixed(4)) : null,
    }])),
  };
}

export function summarizeOutcomeMetrics(tasks = [], options = {}) {
  const from = periodBoundary(options.from, '--from');
  const to = periodBoundary(options.to, '--to');
  if (from && to && from > to) throw new Error('--from 不能晚于 --to');
  const quietDays = options.quietDays === undefined ? DEFAULT_QUIET_DAYS : Number(options.quietDays);
  if (!Number.isFinite(quietDays) || quietDays < 0) throw new Error('--quiet-days 必须是大于等于 0 的数字');
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('now 必须是有效时间');
  const requestedTypes = new Set((options.problemTypes ?? []).map(normalizedProblemType));

  const selected = tasks.filter((task) => {
    const timestamp = taskTimestamp(task);
    if (timestamp && ((from && timestamp < from) || (to && timestamp > to))) return false;
    const type = normalizedProblemType(task.outcomeMetrics?.problemType ?? task.classification?.problemType);
    return requestedTypes.size === 0 || requestedTypes.has(type);
  });
  const normalized = selected.map((task) => ({
    task,
    metrics: normalizeOutcomeMetrics(task.outcomeMetrics, { createdAt: task.createdAt }),
  }));
  const measured = normalized.filter((item) => item.metrics.measurementVersion === COMPLETION_MEASUREMENT_VERSION);
  const eligible = measured.filter((item) => item.metrics.eligible);
  const excluded = measured.filter((item) => !item.metrics.eligible);
  const comparable = eligible.filter((item) => item.metrics.firstQualifiedDeliveryAt).map((item) => ({
    ...item,
    completion: completionView(item.task, now.getTime(), quietDays),
  }));
  const completed = comparable.filter((item) => item.completion.state === 'completed');
  const observing = comparable.filter((item) => item.completion.state === 'observing');
  const inProgress = comparable.filter((item) => item.completion.state === 'in-progress');
  const pendingDelivery = eligible.length - comparable.length;

  const stateCounts = { working:0, needs_decision:0, delivered:0, done:0 };
  for (const task of selected) {
    const state = publicTaskStateForTask(task).id;
    stateCounts[state] = (stateCounts[state] ?? 0) + 1;
  }

  const typeNames = [...new Set(measured.map((item) => item.metrics.problemType))].sort();
  const byProblemType = typeNames.map((problemType) => {
    const typeComparable = comparable.filter((item) => item.metrics.problemType === problemType);
    const typeCompleted = typeComparable.filter((item) => item.completion.state === 'completed');
    return {
      problemType,
      measured: measured.filter((item) => item.metrics.problemType === problemType).length,
      comparable: typeComparable.length,
      completed: typeCompleted.length,
      observing: typeComparable.filter((item) => item.completion.state === 'observing').length,
      rounds: distributionFor(typeCompleted),
    };
  });

  const tracked = normalized.filter((item) => item.metrics.trackingStartedAt);
  const decided = tracked.filter((item) => typeof item.metrics.firstPassAccepted === 'boolean');
  const firstPassAccepted = decided.filter((item) => item.metrics.firstPassAccepted === true).length;
  const verificationTasks = tracked.filter((item) => item.metrics.verificationRunCount > 0);
  const verificationRuns = verificationTasks.reduce((sum, item) => sum + item.metrics.verificationRunCount, 0);
  const verificationDurationMs = verificationTasks.reduce((sum, item) => sum + item.metrics.verificationDurationMs, 0);
  const reworkTasks = tracked.filter((item) => item.metrics.reworkCount > 0);
  const reworkCount = reworkTasks.reduce((sum, item) => sum + item.metrics.reworkCount, 0);
  const userDecisionCount = tracked.reduce((sum, item) => sum + item.metrics.userDecisionCount, 0);
  const deliveryTasks = tracked.filter((item) => item.metrics.deliveryAttemptCount > 0);
  const deliveryAttempts = deliveryTasks.reduce((sum, item) => sum + item.metrics.deliveryAttemptCount, 0);
  const multiDeliveryTasks = deliveryTasks.filter((item) => item.metrics.deliveryAttemptCount > 1);
  const postFirstDeliveryRealignments = tracked.reduce((sum, item) => {
    const firstDeliveryAt = isoOrNull(item.metrics.firstDeliveryAt);
    if (!firstDeliveryAt) return sum;
    return sum + (item.task.goal?.alignment?.events ?? []).filter((event) => {
      const at = isoOrNull(event?.at);
      return event?.type === 'realignment' && at && at > firstDeliveryAt;
    }).length;
  }, 0);
  const conversationTracked = selected.filter((task) => normalizeConversationOutcome(task.conversationOutcome));
  const followUps = Object.fromEntries([...FOLLOW_UP_KINDS].map((kind) => [
    kind,
    conversationTracked.reduce((sum, task) => sum + normalizeConversationOutcome(task.conversationOutcome).counts[kind], 0),
  ]));
  const reasons = new Map();
  for (const item of tracked) {
    for (const reason of item.metrics.returnReasons ?? []) reasons.set(reason.category, (reasons.get(reason.category) ?? 0) + 1);
  }

  const exclusionReasons = new Map();
  for (const item of excluded) exclusionReasons.set(item.metrics.exclusionReason, (exclusionReasons.get(item.metrics.exclusionReason) ?? 0) + 1);
  const warnings = [];
  if (completed.length < 10) warnings.push('新版已完成可比样本少于 10，只能用于方向观察');
  else if (completed.length < 20) warnings.push('新版已完成可比样本少于 20，尚不足以判断机制稳定性');
  else if (completed.length < 30) warnings.push('新版已完成可比样本为 20～29，可作阶段判断，建议达到 30 后复核');
  if (normalized.length > measured.length) warnings.push(`${normalized.length - measured.length} 条旧口径记录已保留，但默认退出完成轮次统计`);
  if (observing.length) warnings.push(`${observing.length} 条样本仍在 ${quietDays} 天静默观察期，不进入完成轮次分母`);
  if (excluded.length) warnings.push(`${excluded.length} 条新版记录因类型或排除原因不进入可比样本`);
  warnings.push('本摘要不包含可比基线，不能单独证明机制净收益');

  return {
    schemaVersion: 3,
    view: 'completion-rounds',
    measurementVersion: COMPLETION_MEASUREMENT_VERSION,
    period: { from, to, quietDays, asOf: now.toISOString() },
    filters: { problemTypes: [...requestedTypes] },
    sample: {
      total: selected.length,
      measured: measured.length,
      legacyExcluded: normalized.length - measured.length,
      eligible: eligible.length,
      excluded: excluded.length,
      pendingDelivery,
      comparable: comparable.length,
      completed: completed.length,
      observing: observing.length,
      inProgress: inProgress.length,
      stateCounts,
    },
    completionRounds: distributionFor(completed),
    byProblemType,
    exclusions: [...exclusionReasons.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([reason, count]) => ({ reason, count })),
    explicitAcceptance: {
      decided: decided.length,
      unknown: tracked.length - decided.length,
      passed: firstPassAccepted,
      rate: decided.length ? Number((firstPassAccepted / decided.length).toFixed(4)) : null,
      coverage: tracked.length ? Number((decided.length / tracked.length).toFixed(4)) : null,
      role: 'secondary-optional-fact',
    },
    conversationFacts: { tracked: conversationTracked.length, followUps },
    rework: {
      tasks: reworkTasks.length,
      count: reworkCount,
      countingScope: 'same-sample-related-return',
      unlinkedRepairTasksIncluded: false,
    },
    technicalDeliveryAttempts: {
      tasks: deliveryTasks.length,
      attempts: deliveryAttempts,
      multiAttemptTasks: multiDeliveryTasks.length,
      additionalAttempts: deliveryAttempts - deliveryTasks.length,
      postFirstDeliveryRealignments,
    },
    userDecisions: { count: userDecisionCount },
    verification: {
      tasks: verificationTasks.length,
      runs: verificationRuns,
      totalMs: verificationDurationMs,
      averageMs: verificationRuns ? Math.round(verificationDurationMs / verificationRuns) : null,
    },
    returnReasons: [...reasons.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([category, count]) => ({ category, count })),
    warnings,
  };
}
