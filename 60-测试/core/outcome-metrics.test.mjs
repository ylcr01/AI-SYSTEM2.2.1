// BR-AIRD-METRICS-001 BR-AIRD-METRICS-IDENTITY-001
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPLETION_MEASUREMENT_VERSION,
  applyOutcomeMetricEvent,
  beginConversationDelivery,
  createOutcomeMetrics,
  normalizeOutcomeMetrics,
  observeConversationFollowUp,
  publicTaskState,
  publicTaskStateForTask,
  singleTurnClosure,
  summarizeOutcomeMetrics,
} from '../../40-脚本/lib/outcome-metrics.mjs';

test('Schema 1/2 兼容按字段语义归一化，旧验证统计不叠加到真实执行', () => {
  const legacy = normalizeOutcomeMetrics({
    schemaVersion:1,
    trackingStartedAt:'2026-08-20T00:00:00.000Z',
    preparedAt:'2026-08-20T00:00:00.000Z',
    verificationRunCount:3,
    verificationDurationMs:900,
  }, { createdAt:'2026-08-20T00:00:00.000Z' });
  assert.equal(legacy.schemaVersion, 3);
  assert.equal(legacy.measurementVersion, null);
  assert.equal(legacy.eligible, false);
  assert.equal(legacy.exclusionReason, 'legacy-before-completion-rounds');
  assert.deepEqual(legacy.legacyVerification, { runs:3, durationMs:900, incomplete:true });
  assert.equal(legacy.verificationExecutionCount, 0);
  assert.equal(legacy.verificationExecutionDurationMs, 0);
  assert.equal('verificationRunCount' in legacy, false);
  assert.equal('verificationDurationMs' in legacy, false);

  const completionSchema2 = normalizeOutcomeMetrics({
    schemaVersion:2,
    measurementVersion:COMPLETION_MEASUREMENT_VERSION,
    problemType:'bugfix',
    eligible:true,
    trackingStartedAt:'2026-08-20T00:00:00.000Z',
    verificationRunCount:2,
    verificationDurationMs:400,
  });
  assert.equal(completionSchema2.schemaVersion, 3);
  assert.equal(completionSchema2.measurementVersion, COMPLETION_MEASUREMENT_VERSION);
  assert.equal(completionSchema2.eligible, true);
  assert.deepEqual(completionSchema2.legacyVerification, { runs:2, durationMs:400, incomplete:true });
  assert.equal(completionSchema2.verificationExecutionCount, 0);

  const truthSchema2 = normalizeOutcomeMetrics({
    schemaVersion:2,
    trackingStartedAt:'2026-08-20T00:00:00.000Z',
    verificationExecutionCount:4,
    verificationExecutionDurationMs:800,
  });
  assert.equal(truthSchema2.schemaVersion, 3);
  assert.equal(truthSchema2.measurementVersion, null);
  assert.equal(truthSchema2.eligible, false);
  assert.equal(truthSchema2.verificationExecutionCount, 4);
  assert.equal(truthSchema2.verificationExecutionDurationMs, 800);
  assert.equal(truthSchema2.legacyVerification, null);
});

test('新写指标使用 Schema 3，未来或损坏的 Schema 失败关闭', () => {
  const created = createOutcomeMetrics({
    at:'2026-08-20T00:00:00.000Z',
    problemType:'feature',
  });
  assert.equal(created.schemaVersion, 3);
  assert.equal(normalizeOutcomeMetrics(created).schemaVersion, 3);
  for (const schemaVersion of [4, '3', 'invalid']) {
    assert.throws(
      () => normalizeOutcomeMetrics({ schemaVersion, trackingStartedAt:null }),
      /Schema 不受支持/u,
    );
  }
});

test('旧 Task 后续事件不会补写 trackingStartedAt 或进入验收未知分母', () => {
  const legacy = normalizeOutcomeMetrics(null, { createdAt:'2026-08-20T00:00:00.000Z' });
  const decided = applyOutcomeMetricEvent(legacy, {
    event:'user-accept',
    to:'accepted',
    at:'2026-08-21T00:00:00.000Z',
  });
  assert.equal(decided.trackingStartedAt, null);
  const summary = summarizeOutcomeMetrics([{
    status:'accepted',
    createdAt:'2026-08-20T00:00:00.000Z',
    acceptedAt:'2026-08-21T00:00:00.000Z',
    outcomeMetrics:decided,
  }]);
  assert.deepEqual(
    {
      measured:summary.sample.measured,
      tracked:summary.sample.tracked,
      delivered:summary.sample.delivered,
      legacyWithoutMetrics:summary.sample.legacyWithoutMetrics,
    },
    { measured:0, tracked:0, delivered:0, legacyWithoutMetrics:1 },
  );
  assert.deepEqual(
    summary.firstPassAcceptance,
    { decided:0, unknown:0, passed:0, rate:null, coverage:null },
  );
});

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
  for (const stopReason of [
    'alignment-required',
    'alignment-risk-escalation',
    'budget',
    'integration-risk-user-decision',
  ]) {
    assert.equal(publicTaskStateForTask({
      status:'needs_rework',
      verification:{ stopReason },
    }).id, 'needs_decision');
  }
  assert.equal(
    publicTaskStateForTask({ status:'needs_rework', verification:{ stopReason:'failed' } }).id,
    'working',
  );
});

test('完成轮次与交付尝试、真实验证执行及显式返工分别计数', () => {
  let metrics = createOutcomeMetrics({
    at:'2026-08-20T00:00:00.000Z',
    problemType:'bugfix',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-20T00:00:01.000Z',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'verification-execution',
    at:'2026-08-20T00:00:01.000Z',
    executionCount:1,
    durationMs:120,
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'conversation-related-question',
    to:'waiting_acceptance',
    at:'2026-08-20T00:00:02.000Z',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'conversation-defect-return',
    to:'needs_rework',
    at:'2026-08-20T00:00:03.000Z',
    note:'回归场景仍失败',
  });
  assert.equal(metrics.reworkCount, 0);
  assert.equal(metrics.firstPassAccepted, null);
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-20T00:00:04.000Z',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'verification-execution',
    at:'2026-08-20T00:00:04.000Z',
    executionCount:1,
    durationMs:80,
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'user-reject',
    to:'needs_rework',
    at:'2026-08-20T00:00:05.000Z',
    reasonCategory:'scope',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-20T00:00:06.000Z',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'conversation-topic-advance',
    to:'closed',
    at:'2026-08-20T00:00:07.000Z',
  });

  assert.equal(metrics.firstDeliveryAt, '2026-08-20T00:00:01.000Z');
  assert.equal(metrics.firstQualifiedDeliveryAt, '2026-08-20T00:00:01.000Z');
  assert.equal(metrics.readyForAcceptanceAt, '2026-08-20T00:00:01.000Z');
  assert.equal(metrics.deliveryAttemptCount, 3);
  assert.equal(metrics.verificationExecutionCount, 2);
  assert.equal(metrics.verificationExecutionDurationMs, 200);
  assert.equal(metrics.relatedFollowUpCount, 3);
  assert.equal(metrics.reworkCount, 1);
  assert.equal(metrics.firstPassAccepted, false);
  assert.equal(metrics.completedAt, '2026-08-20T00:00:07.000Z');
  assert.equal(metrics.completionBasis, 'topic-advance');
  assert.deepEqual(metrics.returnReasons.map((item) => item.category), ['defect-return', 'scope']);
});

test('waiting 到 waiting 的纯 handoff 不重启静默观察窗口', () => {
  let metrics = createOutcomeMetrics({
    at:'2026-08-01T00:00:00.000Z',
    problemType:'feature',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-01T00:00:01.000Z',
  });
  const handedOff = applyOutcomeMetricEvent(metrics, {
    event:'handoff',
    from:'waiting_acceptance',
    to:'waiting_acceptance',
    at:'2026-08-07T23:00:00.000Z',
  });
  assert.equal(handedOff.readyForAcceptanceAt, metrics.readyForAcceptanceAt);
  assert.equal(handedOff.lastOutcomeActivityAt, metrics.lastOutcomeActivityAt);
  assert.equal(handedOff.completedAt, metrics.completedAt);
  assert.equal(handedOff.completionBasis, metrics.completionBasis);

  const summary = summarizeOutcomeMetrics([{
    status:'waiting_acceptance',
    createdAt:'2026-08-01T00:00:00.000Z',
    updatedAt:'2026-08-07T23:00:00.000Z',
    outcomeMetrics:handedOff,
  }], { now:'2026-08-08T00:00:01.000Z' });
  assert.equal(summary.sample.completed, 1);
  assert.equal(summary.sample.observing, 0);
  assert.deepEqual(summary.completionRounds.exact, [{ round:1, count:1, rate:1 }]);
});

test('摘要以完成轮次为主，同时保留技术与公开状态样本真值', () => {
  let oneRound = createOutcomeMetrics({
    at:'2026-08-01T00:00:00.000Z',
    problemType:'bugfix',
  });
  oneRound = applyOutcomeMetricEvent(oneRound, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-01T00:00:01.000Z',
  });
  oneRound = applyOutcomeMetricEvent(oneRound, {
    event:'conversation-topic-advance',
    to:'closed',
    at:'2026-08-01T00:00:02.000Z',
  });

  let twoRounds = createOutcomeMetrics({
    at:'2026-08-02T00:00:00.000Z',
    problemType:'feature',
  });
  twoRounds = applyOutcomeMetricEvent(twoRounds, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-02T00:00:01.000Z',
  });
  twoRounds = applyOutcomeMetricEvent(twoRounds, {
    event:'conversation-related-question',
    to:'waiting_acceptance',
    at:'2026-08-02T00:00:02.000Z',
  });
  twoRounds = applyOutcomeMetricEvent(twoRounds, {
    event:'user-accept',
    to:'accepted',
    at:'2026-08-02T00:00:03.000Z',
  });

  let observing = createOutcomeMetrics({
    at:'2026-08-20T00:00:00.000Z',
    problemType:'refactor',
  });
  observing = applyOutcomeMetricEvent(observing, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-20T00:00:01.000Z',
  });

  const summary = summarizeOutcomeMetrics([
    {
      status:'closed',
      createdAt:'2026-08-01T00:00:00.000Z',
      closedAt:'2026-08-01T00:00:02.000Z',
      outcomeMetrics:oneRound,
    },
    {
      status:'accepted',
      createdAt:'2026-08-02T00:00:00.000Z',
      acceptedAt:'2026-08-02T00:00:03.000Z',
      outcomeMetrics:twoRounds,
    },
    {
      status:'waiting_acceptance',
      createdAt:'2026-08-20T00:00:00.000Z',
      updatedAt:'2026-08-20T00:00:01.000Z',
      outcomeMetrics:observing,
    },
    {
      status:'accepted',
      createdAt:'2026-07-01T00:00:00.000Z',
      acceptedAt:'2026-08-03T00:00:00.000Z',
      outcomeMetrics:{ schemaVersion:1, trackingStartedAt:null },
    },
  ], { now:'2026-08-21T00:00:00.000Z' });

  assert.equal(summary.schemaVersion, 3);
  assert.equal(summary.view, 'completion-rounds');
  assert.deepEqual(
    {
      total:summary.sample.total,
      measured:summary.sample.measured,
      legacyExcluded:summary.sample.legacyExcluded,
      eligible:summary.sample.eligible,
      comparable:summary.sample.comparable,
      completed:summary.sample.completed,
      observing:summary.sample.observing,
      inProgress:summary.sample.inProgress,
      tracked:summary.sample.tracked,
      delivered:summary.sample.delivered,
      legacyWithoutMetrics:summary.sample.legacyWithoutMetrics,
    },
    {
      total:4,
      measured:3,
      legacyExcluded:1,
      eligible:3,
      comparable:3,
      completed:2,
      observing:1,
      inProgress:0,
      tracked:3,
      delivered:3,
      legacyWithoutMetrics:1,
    },
  );
  assert.deepEqual(summary.sample.stateCounts, {
    working:0,
    needs_decision:0,
    delivered:1,
    done:3,
  });
  assert.deepEqual(summary.completionRounds.exact, [
    { round:1, count:1, rate:0.5 },
    { round:2, count:1, rate:0.5 },
  ]);
  assert.equal(summary.explicitAcceptance.role, 'secondary-optional-fact');
  assert.ok(summary.warnings.some((item) => /静默观察期/u.test(item)));
  assert.ok(summary.warnings.some((item) => /旧 Task/u.test(item)));
});

test('验收、验证执行、返工和阶段耗时只使用相应真实分母', () => {
  let failed = createOutcomeMetrics({
    at:'2026-08-20T00:00:00.000Z',
    problemType:'bugfix',
  });
  failed = applyOutcomeMetricEvent(failed, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-20T00:00:01.000Z',
  });
  failed = applyOutcomeMetricEvent(failed, {
    event:'verification-execution',
    at:'2026-08-20T00:00:01.000Z',
    executionCount:1,
    durationMs:100,
  });
  failed = applyOutcomeMetricEvent(failed, {
    event:'user-reject',
    to:'needs_rework',
    at:'2026-08-20T00:00:02.000Z',
    reasonCategory:'scope',
  });

  let passed = createOutcomeMetrics({
    at:'2026-08-20T00:00:00.000Z',
    problemType:'feature',
  });
  passed = applyOutcomeMetricEvent(passed, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-20T00:00:01.000Z',
  });
  passed = applyOutcomeMetricEvent(passed, {
    event:'verification-execution',
    at:'2026-08-20T00:00:01.000Z',
    executionCount:1,
    durationMs:300,
  });
  passed = applyOutcomeMetricEvent(passed, {
    event:'user-accept',
    to:'accepted',
    at:'2026-08-20T00:00:02.000Z',
  });

  const summary = summarizeOutcomeMetrics([
    {
      status:'needs_rework',
      createdAt:'2026-08-20T00:00:00.000Z',
      updatedAt:'2026-08-20T00:00:02.000Z',
      outcomeMetrics:failed,
    },
    {
      status:'accepted',
      createdAt:'2026-08-20T00:00:00.000Z',
      acceptedAt:'2026-08-20T00:00:02.000Z',
      outcomeMetrics:passed,
    },
    {
      status:'accepted',
      createdAt:'2026-08-19T00:00:00.000Z',
      acceptedAt:'2026-08-20T00:00:03.000Z',
      outcomeMetrics:{
        schemaVersion:1,
        trackingStartedAt:'2026-08-19T00:00:00.000Z',
        verificationRunCount:5,
        verificationDurationMs:500,
      },
    },
  ], { now:'2026-08-21T00:00:00.000Z' });

  assert.deepEqual(
    summary.firstPassAcceptance,
    { decided:2, unknown:0, passed:1, rate:0.5, coverage:1 },
  );
  assert.deepEqual(summary.explicitAcceptance, {
    decided:2,
    unknown:0,
    passed:1,
    rate:0.5,
    coverage:1,
    role:'secondary-optional-fact',
  });
  assert.deepEqual(summary.rework, {
    tasks:1,
    count:1,
    countingScope:'same-task-explicit-user-reject',
    unlinkedRepairTasksIncluded:false,
  });
  assert.deepEqual(summary.verification, {
    tasks:2,
    runs:2,
    totalMs:400,
    averageMs:200,
    legacyIncompleteTasks:1,
  });
  assert.deepEqual(summary.cycleTime, {
    preparationToDelivery:{ tasks:2, totalMs:2000, averageMs:1000 },
    deliveryToFirstDecision:{ tasks:2, totalMs:2000, averageMs:1000 },
    preparationToFirstDecision:{ tasks:2, totalMs:4000, averageMs:2000 },
  });
  assert.deepEqual(summary.returnReasons, [{ category:'scope', count:1 }]);
  assert.ok(summary.warnings.some((item) => /仅保留为 legacy/u.test(item)));
  assert.ok(summary.warnings.some((item) => /未关联的新修复 Task/u.test(item)));
});

test('按问题类型筛选时旧口径退出完成轮次分母', () => {
  let bugfix = createOutcomeMetrics({
    at:'2026-08-01T00:00:00.000Z',
    problemType:'bugfix',
  });
  bugfix = applyOutcomeMetricEvent(bugfix, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-01T00:00:01.000Z',
  });
  bugfix = applyOutcomeMetricEvent(bugfix, {
    event:'conversation-topic-advance',
    to:'closed',
    at:'2026-08-01T00:00:02.000Z',
  });
  const summary = summarizeOutcomeMetrics([
    {
      status:'closed',
      createdAt:'2026-08-01T00:00:00.000Z',
      closedAt:'2026-08-01T00:00:02.000Z',
      outcomeMetrics:bugfix,
    },
    {
      status:'accepted',
      createdAt:'2026-07-01T00:00:00.000Z',
      acceptedAt:'2026-08-02T00:00:00.000Z',
      classification:{ problemType:'bugfix' },
      outcomeMetrics:{ schemaVersion:1, trackingStartedAt:null },
    },
    {
      status:'closed',
      createdAt:'2026-08-01T00:00:00.000Z',
      closedAt:'2026-08-01T00:00:02.000Z',
      outcomeMetrics:createOutcomeMetrics({
        at:'2026-08-01T00:00:00.000Z',
        problemType:'unknown',
      }),
    },
  ], {
    problemTypes:['bugfix'],
    now:'2026-08-10T00:00:00.000Z',
  });
  assert.equal(summary.sample.total, 2);
  assert.equal(summary.sample.measured, 1);
  assert.equal(summary.sample.legacyExcluded, 1);
  assert.equal(summary.sample.completed, 1);
  assert.deepEqual(summary.completionRounds.exact, [{ round:1, count:1, rate:1 }]);
  assert.deepEqual(summary.byProblemType.map((item) => item.problemType), ['bugfix']);
});

test('交付尝试摘要区分重复交付与首次交付后的重新对齐', () => {
  let metrics = createOutcomeMetrics({
    at:'2026-08-20T00:00:00.000Z',
    problemType:'maintenance',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-20T00:00:02.000Z',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'delivery',
    to:'waiting_acceptance',
    at:'2026-08-20T00:00:05.000Z',
  });
  const summary = summarizeOutcomeMetrics([{
    status:'waiting_acceptance',
    createdAt:'2026-08-20T00:00:00.000Z',
    updatedAt:'2026-08-20T00:00:05.000Z',
    outcomeMetrics:metrics,
    goal:{ alignment:{ events:[
      { type:'realignment', at:'2026-08-20T00:00:01.000Z' },
      { type:'alignment-risk-escalation', at:'2026-08-20T00:00:03.000Z' },
      { type:'realignment', at:'2026-08-20T00:00:04.000Z' },
    ] } },
  }], { now:'2026-08-20T00:00:06.000Z' });
  assert.deepEqual(summary.technicalDeliveryAttempts, {
    tasks:1,
    attempts:2,
    multiAttemptTasks:1,
    additionalAttempts:1,
    postFirstDeliveryRealignments:1,
  });
  assert.equal(summary.rework.count, 0);
});

test('对话观察按 observationId 幂等，并保留首次后续事实', () => {
  let conversation = beginConversationDelivery(null, {
    deliveryId:'delivery-1',
    deliveredAt:'2026-08-20T00:00:01.000Z',
  });
  assert.equal(singleTurnClosure(conversation), null);
  conversation = observeConversationFollowUp(conversation, {
    kind:'related-question',
    observationId:'turn-1',
    observedAt:'2026-08-20T00:00:02.000Z',
    terminal:false,
  });
  const duplicate = observeConversationFollowUp(conversation, {
    kind:'related-question',
    observationId:'turn-1',
    observedAt:'2026-08-20T00:00:02.000Z',
    terminal:false,
  });
  assert.deepEqual(duplicate, conversation);
  assert.throws(() => observeConversationFollowUp(conversation, {
    kind:'topic-advance',
    observationId:'turn-1',
    observedAt:'2026-08-20T00:00:03.000Z',
  }), /不能记录为不同/u);
  conversation = observeConversationFollowUp(conversation, {
    kind:'topic-advance',
    observationId:'turn-2',
    observedAt:'2026-08-20T00:00:03.000Z',
    terminal:true,
  });
  assert.equal(singleTurnClosure(conversation), false);
  assert.equal(conversation.counts['related-question'], 1);
  assert.equal(conversation.counts['topic-advance'], 1);
  assert.equal(conversation.observations.length, 2);
  assert.equal('firstPassResolved' in conversation, false);

  const nextDelivery = beginConversationDelivery(conversation, {
    deliveryId:'delivery-2',
    deliveredAt:'2026-08-20T00:00:04.000Z',
  });
  assert.equal(nextDelivery.firstDeliveryFollowUpKind, 'related-question');
  assert.equal(nextDelivery.firstFollowUp, null);
  assert.equal(nextDelivery.observations.length, 2);
});

test('尚未正式交付的 tracked Task 不污染 outcome unknown', () => {
  const metrics = createOutcomeMetrics({
    at:'2026-08-20T00:00:00.000Z',
    problemType:'documentation',
  });
  const summary = summarizeOutcomeMetrics([{
    status:'verifying',
    createdAt:'2026-08-20T00:00:00.000Z',
    updatedAt:'2026-08-20T00:00:01.000Z',
    outcomeMetrics:metrics,
  }]);
  assert.equal(summary.sample.tracked, 1);
  assert.equal(summary.sample.delivered, 0);
  assert.deepEqual(
    summary.firstPassAcceptance,
    { decided:0, unknown:0, passed:0, rate:null, coverage:null },
  );
});
