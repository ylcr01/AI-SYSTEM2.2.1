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
    assert.equal(publicTaskStateForTask({
      status: 'needs_rework',
      verification: { stopReason },
    }).id, 'needs_decision');
  }
  assert.equal(publicTaskStateForTask({ status:'needs_rework', verification:{ stopReason:'failed' } }).id, 'working');
});

test('交付和用户验收事件形成最小结果指标', () => {
  let metrics = createOutcomeMetrics({ at:'2026-08-20T00:00:00.000Z', initialUserDecisionCount:1 });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'delivery', to:'waiting_acceptance', at:'2026-08-20T00:00:01.000Z', durationMs:120,
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'user-reject', to:'needs_rework', at:'2026-08-20T00:00:02.000Z',
    reasonCategory:'code-quality', note:'命名不符合项目习惯',
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'delivery', to:'waiting_acceptance', at:'2026-08-20T00:00:03.000Z', durationMs:80,
  });
  metrics = applyOutcomeMetricEvent(metrics, {
    event:'user-accept', to:'accepted', at:'2026-08-20T00:00:04.000Z',
  });

  assert.equal(metrics.firstDeliveryAt, '2026-08-20T00:00:01.000Z');
  assert.equal(metrics.readyForAcceptanceAt, '2026-08-20T00:00:01.000Z');
  assert.equal(metrics.deliveryAttemptCount, 2);
  assert.equal(metrics.verificationRunCount, 2);
  assert.equal(metrics.verificationDurationMs, 200);
  assert.equal(metrics.userDecisionCount, 3);
  assert.equal(metrics.reworkCount, 1);
  assert.equal(metrics.firstPassAccepted, false);
  assert.deepEqual(metrics.returnReasons, [{
    at:'2026-08-20T00:00:02.000Z', category:'code-quality', note:'命名不符合项目习惯',
  }]);
});

test('只读摘要区分有效样本和旧 Task，不把小样本写成稳定结论', () => {
  const failedFirstPass = applyOutcomeMetricEvent(
    applyOutcomeMetricEvent(createOutcomeMetrics({ at:'2026-08-20T00:00:00.000Z' }), {
      event:'delivery', to:'waiting_acceptance', at:'2026-08-20T00:00:01.000Z', durationMs:100,
    }),
    { event:'user-reject', to:'needs_rework', at:'2026-08-20T00:00:02.000Z', reasonCategory:'scope' },
  );
  const passedFirstPass = applyOutcomeMetricEvent(
    applyOutcomeMetricEvent(createOutcomeMetrics({ at:'2026-08-20T00:00:00.000Z' }), {
      event:'delivery', to:'waiting_acceptance', at:'2026-08-20T00:00:01.000Z', durationMs:300,
    }),
    { event:'user-accept', to:'accepted', at:'2026-08-20T00:00:02.000Z' },
  );
  const summary = summarizeOutcomeMetrics([
    { status:'needs_rework', createdAt:'2026-08-20T00:00:00.000Z', updatedAt:'2026-08-20T00:00:02.000Z', outcomeMetrics:failedFirstPass },
    { status:'accepted', createdAt:'2026-08-20T00:00:00.000Z', acceptedAt:'2026-08-20T00:00:02.000Z', outcomeMetrics:passedFirstPass },
    { status:'accepted', createdAt:'2026-08-19T00:00:00.000Z', acceptedAt:'2026-08-20T00:00:03.000Z', outcomeMetrics:{ trackingStartedAt:null } },
  ]);

  assert.deepEqual(summary.sample, {
    total:3,
    tracked:2,
    legacyWithoutMetrics:1,
    stateCounts:{ working:1, needs_decision:0, delivered:0, done:2 },
  });
  assert.deepEqual(summary.firstPassAcceptance, { decided:2, unknown:0, passed:1, rate:0.5, coverage:1 });
  assert.deepEqual(summary.explicitAcceptance, summary.firstPassAcceptance);
  assert.deepEqual(summary.rework, { tasks:1, count:1, countingScope:'same-task-explicit-user-reject', unlinkedRepairTasksIncluded:false });
  assert.deepEqual(summary.verification, { tasks:2, runs:2, totalMs:400, averageMs:200 });
  assert.deepEqual(summary.returnReasons, [{ category:'scope', count:1 }]);
  assert.ok(summary.warnings.some(item => /少于 10/u.test(item)));
  assert.ok(summary.warnings.some(item => /旧 Task/u.test(item)));
  assert.ok(summary.warnings.some(item => /未关联的新修复 Task/u.test(item)));
  assert.ok(summary.warnings.some(item => /不能单独证明/u.test(item)));
});

test('首轮验收指标显式报告未知样本和结论覆盖率', () => {
  const unknown = applyOutcomeMetricEvent(createOutcomeMetrics({ at:'2026-08-20T00:00:00.000Z' }), {
    event:'delivery', to:'waiting_acceptance', at:'2026-08-20T00:00:01.000Z', durationMs:100,
  });
  const summary = summarizeOutcomeMetrics([{
    status:'waiting_acceptance', createdAt:'2026-08-20T00:00:00.000Z', updatedAt:'2026-08-20T00:00:01.000Z', outcomeMetrics:unknown,
  }]);
  assert.deepEqual(summary.firstPassAcceptance, { decided:0, unknown:1, passed:0, rate:null, coverage:0 });
  assert.ok(summary.warnings.some(item => /没有明确用户验收/u.test(item)));
});

test('对话后续只记录原始事实并由首次类型派生单轮闭环', () => {
  let conversation = beginConversationDelivery(null, {
    deliveryId:'delivery-1', deliveredAt:'2026-08-20T00:00:01.000Z',
  });
  assert.equal(singleTurnClosure(conversation), null);
  conversation = observeConversationFollowUp(conversation, {
    kind:'related-question', observationId:'turn-1', observedAt:'2026-08-20T00:00:02.000Z', terminal:false,
  });
  conversation = observeConversationFollowUp(conversation, {
    kind:'topic-advance', observationId:'turn-2', observedAt:'2026-08-20T00:00:03.000Z', terminal:true,
  });
  assert.equal(singleTurnClosure(conversation), false);
  assert.equal(conversation.counts['related-question'], 1);
  assert.equal(conversation.counts['topic-advance'], 1);
  assert.equal('firstPassResolved' in conversation, false);

  const nextDelivery = beginConversationDelivery(conversation, {
    deliveryId:'delivery-2', deliveredAt:'2026-08-20T00:00:04.000Z',
  });
  assert.equal(nextDelivery.firstDeliveryFollowUpKind, 'related-question');
  assert.equal(nextDelivery.firstFollowUp, null);
  assert.equal(nextDelivery.counts['topic-advance'], 1);
});

test('对话摘要区分隐式收口与显式验收且旧 Task 保持未知', () => {
  const implicitConversation = observeConversationFollowUp(beginConversationDelivery(null, {
    deliveryId:'delivery-implicit', deliveredAt:'2026-08-20T00:00:01.000Z',
  }), {
    kind:'topic-advance', observationId:'turn-new-topic', observedAt:'2026-08-20T00:00:02.000Z', terminal:true,
  });
  const relatedConversation = observeConversationFollowUp(beginConversationDelivery(null, {
    deliveryId:'delivery-related', deliveredAt:'2026-08-20T00:00:01.000Z',
  }), {
    kind:'related-question', observationId:'turn-question', observedAt:'2026-08-20T00:00:02.000Z', terminal:false,
  });
  const metrics = createOutcomeMetrics({ at:'2026-08-20T00:00:00.000Z' });
  const summary = summarizeOutcomeMetrics([
    { status:'closed', createdAt:'2026-08-20T00:00:00.000Z', closedAt:'2026-08-20T00:00:02.000Z', outcomeMetrics:metrics, conversationOutcome:implicitConversation },
    { status:'waiting_acceptance', createdAt:'2026-08-20T00:00:00.000Z', updatedAt:'2026-08-20T00:00:02.000Z', outcomeMetrics:metrics, conversationOutcome:relatedConversation },
    { status:'waiting_acceptance', createdAt:'2026-08-19T00:00:00.000Z', updatedAt:'2026-08-20T00:00:02.000Z', outcomeMetrics:metrics, conversationOutcome:null },
  ]);
  assert.deepEqual(summary.conversationClosure.singleTurn, { decided:2, unknown:0, passed:1, rate:0.5, coverage:1 });
  assert.equal(summary.conversationClosure.implicitClosures, 1);
  assert.equal(summary.conversationClosure.followUps['related-question'], 1);
  assert.equal(summary.conversationClosure.followUps['topic-advance'], 1);
  assert.equal(summary.firstPassAcceptance.decided, 0);
  assert.equal(summary.firstPassAcceptance.unknown, 3);
});
