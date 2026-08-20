import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyOutcomeMetricEvent,
  createOutcomeMetrics,
  publicTaskState,
  summarizeOutcomeMetrics,
} from '../../40-脚本/lib/outcome-metrics.mjs';

test('内部状态只映射为四种用户状态', () => {
  assert.equal(publicTaskState('prepared').id, 'working');
  assert.equal(publicTaskState('needs_rework').id, 'working');
  assert.equal(publicTaskState('blocked').id, 'needs_decision');
  assert.equal(publicTaskState('saved').id, 'needs_decision');
  assert.equal(publicTaskState('waiting_acceptance').id, 'ready_for_acceptance');
  assert.equal(publicTaskState('accepted').id, 'done');
  assert.equal(publicTaskState('cancelled').id, 'done');
  assert.equal(publicTaskState('unknown').id, 'needs_decision');
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
    stateCounts:{ working:1, needs_decision:0, ready_for_acceptance:0, done:2 },
  });
  assert.deepEqual(summary.firstPassAcceptance, { decided:2, passed:1, rate:0.5 });
  assert.deepEqual(summary.rework, { tasks:1, count:1 });
  assert.deepEqual(summary.verification, { tasks:2, runs:2, totalMs:400, averageMs:200 });
  assert.deepEqual(summary.returnReasons, [{ category:'scope', count:1 }]);
  assert.ok(summary.warnings.some(item => /少于 10/u.test(item)));
  assert.ok(summary.warnings.some(item => /旧 Task/u.test(item)));
  assert.ok(summary.warnings.some(item => /不能单独证明/u.test(item)));
});
