// BR-AIRD-METRICS-001
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyOutcomeMetricEvent,
  beginConversationDelivery,
  createOutcomeMetrics,
  observeConversationFollowUp,
  publicTaskState,
  publicTaskStateForTask,
  singleTurnClosure,
  summarizeOutcomeMetrics,
} from '../../40-脚本/lib/outcome-metrics.mjs';

test('内部状态只映射为四种用户状态', () => {
  assert.equal(publicTaskState('prepared').id, 'working');
  assert.equal(publicTaskState('needs_rework').id, 'working');
  assert.equal(publicTaskState('blocked').id, 'needs_decision');
  assert.equal(publicTaskState('saved').id, 'needs_decision');
  assert.equal(publicTaskState('waiting_acceptance').id, 'delivered');
  assert.equal(publicTaskState('accepted').id, 'done');
  assert.equal(publicTaskState('closed').id, 'done');
  assert.equal(publicTaskState('cancelled').id, 'done');
  assert.equal(publicTaskState('unknown').id, 'needs_decision');
});

test('需要用户决定的停止原因覆盖内部 working 状态', () => {
  for (const stopReason of ['alignment-required', 'alignment-risk-escalation', 'budget']) {
    assert.equal(publicTaskStateForTask({ status:'needs_rework', verification:{ stopReason } }).id, 'needs_decision');
  }
  assert.equal(publicTaskStateForTask({ status:'needs_rework', verification:{ stopReason:'failed' } }).id, 'working');
});

test('完成轮次只增加同一问题的相关追问、缺陷返回或显式退回', () => {
  let metrics = createOutcomeMetrics({
    at:'2026-08-20T00:00:00.000Z', problemType:'bugfix', initialUserDecisionCount:1,
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'delivery', to:'waiting_acceptance', at:'2026-08-20T00:00:01.000Z', durationMs:120,
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'conversation-related-question', to:'waiting_acceptance', at:'2026-08-20T00:00:02.000Z',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'conversation-defect-return', to:'needs_rework', at:'2026-08-20T00:00:03.000Z',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'delivery', to:'waiting_acceptance', at:'2026-08-20T00:00:04.000Z', durationMs:80,
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'conversation-topic-advance', to:'closed', at:'2026-08-20T00:00:05.000Z',
  });

  assert.equal(metrics.firstQualifiedDeliveryAt, '2026-08-20T00:00:01.000Z');
  assert.equal(metrics.relatedFollowUpCount, 2);
  assert.equal(metrics.completionBasis, 'topic-advance');
  assert.equal(metrics.deliveryAttemptCount, 2);
  assert.equal(metrics.verificationRunCount, 2);
  assert.equal(metrics.verificationDurationMs, 200);
  assert.equal(metrics.reworkCount, 1);
  assert.deepEqual(metrics.returnReasons.map((item) => item.category), ['defect-return']);
});

test('新版摘要以完成轮次为主，旧口径和观察中样本不进入分母', () => {
  let oneRound = createOutcomeMetrics({ at:'2026-08-01T00:00:00.000Z', problemType:'bugfix' });
  oneRound = applyOutcomeMetricEvent(oneRound, { event:'delivery', to:'waiting_acceptance', at:'2026-08-01T00:00:01.000Z' });
  oneRound = applyOutcomeMetricEvent(oneRound, { event:'conversation-topic-advance', to:'closed', at:'2026-08-01T00:00:02.000Z' });

  let twoRounds = createOutcomeMetrics({ at:'2026-08-02T00:00:00.000Z', problemType:'feature' });
  twoRounds = applyOutcomeMetricEvent(twoRounds, { event:'delivery', to:'waiting_acceptance', at:'2026-08-02T00:00:01.000Z' });
  twoRounds = applyOutcomeMetricEvent(twoRounds, { event:'conversation-related-question', to:'waiting_acceptance', at:'2026-08-02T00:00:02.000Z' });
  twoRounds = applyOutcomeMetricEvent(twoRounds, { event:'conversation-positive-acknowledgement', to:'closed', at:'2026-08-02T00:00:03.000Z' });

  let observing = createOutcomeMetrics({ at:'2026-08-20T00:00:00.000Z', problemType:'bugfix' });
  observing = applyOutcomeMetricEvent(observing, { event:'delivery', to:'waiting_acceptance', at:'2026-08-20T00:00:01.000Z' });
  const legacy = createOutcomeMetrics({ at:'2026-07-01T00:00:00.000Z', measurementVersion:null });

  const summary = summarizeOutcomeMetrics([
    { status:'closed', createdAt:'2026-08-01T00:00:00.000Z', closedAt:'2026-08-01T00:00:02.000Z', outcomeMetrics:oneRound },
    { status:'closed', createdAt:'2026-08-02T00:00:00.000Z', closedAt:'2026-08-02T00:00:03.000Z', outcomeMetrics:twoRounds },
    { status:'waiting_acceptance', createdAt:'2026-08-20T00:00:00.000Z', updatedAt:'2026-08-20T00:00:01.000Z', outcomeMetrics:observing },
    { status:'accepted', createdAt:'2026-07-01T00:00:00.000Z', acceptedAt:'2026-07-02T00:00:00.000Z', outcomeMetrics:legacy },
  ], { now:'2026-08-21T00:00:00.000Z' });

  assert.equal(summary.view, 'completion-rounds');
  assert.deepEqual(summary.sample, {
    total:4,
    measured:3,
    legacyExcluded:1,
    eligible:3,
    excluded:0,
    pendingDelivery:0,
    comparable:3,
    completed:2,
    observing:1,
    inProgress:0,
    stateCounts:{ working:0, needs_decision:0, delivered:1, done:3 },
  });
  assert.deepEqual(summary.completionRounds.exact, [
    { round:1, count:1, rate:0.5 },
    { round:2, count:1, rate:0.5 },
  ]);
  assert.equal(summary.explicitAcceptance.role, 'secondary-optional-fact');
  assert.ok(summary.warnings.some((item) => /旧口径/u.test(item)));
  assert.ok(summary.warnings.some((item) => /观察期/u.test(item)));
});

test('无后续样本在静默窗口后计为一次完成，窗口内保持观察', () => {
  let metrics = createOutcomeMetrics({ at:'2026-08-01T00:00:00.000Z', problemType:'maintenance' });
  metrics = applyOutcomeMetricEvent(metrics, { event:'delivery', to:'waiting_acceptance', at:'2026-08-01T00:00:01.000Z' });
  const task = { status:'waiting_acceptance', createdAt:'2026-08-01T00:00:00.000Z', updatedAt:'2026-08-01T00:00:01.000Z', outcomeMetrics:metrics };
  assert.equal(summarizeOutcomeMetrics([task], { now:'2026-08-07T23:59:59.000Z' }).sample.observing, 1);
  const matured = summarizeOutcomeMetrics([task], { now:'2026-08-08T00:00:01.000Z' });
  assert.equal(matured.sample.completed, 1);
  assert.deepEqual(matured.completionRounds.exact, [{ round:1, count:1, rate:1 }]);
});

test('问题类型可筛选，未知类型保留记录但不进入可比样本', () => {
  let bugfix = createOutcomeMetrics({ at:'2026-08-01T00:00:00.000Z', problemType:'bugfix' });
  bugfix = applyOutcomeMetricEvent(bugfix, { event:'delivery', to:'waiting_acceptance', at:'2026-08-01T00:00:01.000Z' });
  let unknown = createOutcomeMetrics({ at:'2026-08-01T00:00:00.000Z', problemType:'unknown' });
  unknown = applyOutcomeMetricEvent(unknown, { event:'delivery', to:'waiting_acceptance', at:'2026-08-01T00:00:01.000Z' });
  const tasks = [bugfix, unknown].map((outcomeMetrics) => ({
    status:'waiting_acceptance', createdAt:'2026-08-01T00:00:00.000Z', updatedAt:'2026-08-01T00:00:01.000Z', outcomeMetrics,
  }));
  const all = summarizeOutcomeMetrics(tasks, { now:'2026-08-09T00:00:00.000Z' });
  assert.equal(all.sample.excluded, 1);
  assert.deepEqual(all.exclusions, [{ reason:'unknown-problem-type', count:1 }]);
  const filtered = summarizeOutcomeMetrics(tasks, { now:'2026-08-09T00:00:00.000Z', problemTypes:['bugfix'] });
  assert.equal(filtered.sample.total, 1);
  assert.equal(filtered.sample.completed, 1);
});

test('对话事实保留多个幂等 observation，用首次类型兼容单轮闭环', () => {
  let conversation = beginConversationDelivery(null, {
    deliveryId:'delivery-1', deliveredAt:'2026-08-20T00:00:01.000Z',
  });
  conversation = observeConversationFollowUp(conversation, {
    kind:'related-question', observationId:'turn-1', observedAt:'2026-08-20T00:00:02.000Z', terminal:false,
  });
  conversation = observeConversationFollowUp(conversation, {
    kind:'related-question', observationId:'turn-2', observedAt:'2026-08-20T00:00:03.000Z', terminal:false,
  });
  conversation = observeConversationFollowUp(conversation, {
    kind:'topic-advance', observationId:'turn-3', observedAt:'2026-08-20T00:00:04.000Z', terminal:true,
  });
  assert.equal(singleTurnClosure(conversation), false);
  assert.equal(conversation.counts['related-question'], 2);
  assert.equal(conversation.observations.length, 3);
  const duplicate = observeConversationFollowUp(conversation, {
    kind:'related-question', observationId:'turn-2', observedAt:'2026-08-20T00:00:05.000Z', terminal:false,
  });
  assert.equal(duplicate.counts['related-question'], 2);
});
