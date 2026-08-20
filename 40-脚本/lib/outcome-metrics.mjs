const PUBLIC_STATES = {
  working: { id: 'working', label: '正在处理' },
  needs_decision: { id: 'needs_decision', label: '需要你决定' },
  ready_for_acceptance: { id: 'ready_for_acceptance', label: '等待你验收' },
  done: { id: 'done', label: '已结束' },
};

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
  return isoOrNull(task.acceptedAt ?? task.updatedAt ?? task.createdAt);
}

export function publicTaskState(status) {
  if (status === 'waiting_acceptance') return PUBLIC_STATES.ready_for_acceptance;
  if (status === 'accepted' || status === 'cancelled') return PUBLIC_STATES.done;
  if (WORKING_INTERNAL_STATES.has(status)) return PUBLIC_STATES.working;
  return PUBLIC_STATES.needs_decision;
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
  const firstPassAccepted = decided.filter((task) => task.outcomeMetrics.firstPassAccepted === true).length;
  const verificationTasks = tracked.filter((task) => task.outcomeMetrics.verificationRunCount > 0);
  const verificationRuns = verificationTasks.reduce((sum, task) => sum + task.outcomeMetrics.verificationRunCount, 0);
  const verificationDurationMs = verificationTasks.reduce((sum, task) => sum + task.outcomeMetrics.verificationDurationMs, 0);
  const reworkTasks = tracked.filter((task) => task.outcomeMetrics.reworkCount > 0);
  const reworkCount = reworkTasks.reduce((sum, task) => sum + task.outcomeMetrics.reworkCount, 0);
  const userDecisionCount = tracked.reduce((sum, task) => sum + task.outcomeMetrics.userDecisionCount, 0);
  const reasons = new Map();
  for (const task of tracked) {
    for (const reason of task.outcomeMetrics.returnReasons ?? []) {
      reasons.set(reason.category, (reasons.get(reason.category) ?? 0) + 1);
    }
  }
  const stateCounts = { working:0, needs_decision:0, ready_for_acceptance:0, done:0 };
  for (const task of selected) {
    const state = publicTaskState(task.status).id;
    stateCounts[state] = (stateCounts[state] ?? 0) + 1;
  }
  const warnings = [];
  if (tracked.length < 10) warnings.push('有效指标样本少于 10，只能用于方向观察');
  if (selected.length > tracked.length) warnings.push(`${selected.length - tracked.length} 条旧 Task 没有完整指标，未纳入比率和耗时计算`);
  warnings.push('本摘要不包含可比基线，不能单独证明机制净收益');

  return {
    schemaVersion: 1,
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
      passed: firstPassAccepted,
      rate: decided.length ? Number((firstPassAccepted / decided.length).toFixed(4)) : null,
    },
    rework: { tasks: reworkTasks.length, count: reworkCount },
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

export const returnReasonCategories = [...RETURN_REASON_CATEGORIES];
