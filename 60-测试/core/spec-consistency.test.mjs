import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSpecConsistency } from '../../40-脚本/lib/spec-consistency.mjs';

function trace(files) {
  return {
    gitRoot: process.cwd(),
    files,
    affectedSpecificationIds: [...new Set(files.flatMap((item) => item.specificationIds ?? []))],
    specificationFiles: files.flatMap((item) => item.specificationFiles ?? []),
    decisionFiles: files.flatMap((item) => item.decisionFiles ?? []),
    testFiles: files.flatMap((item) => item.testFiles ?? []),
    testCoverage: {},
    unmappedCodeFiles: []
  };
}

test('specImpact=updated 但没有规格变化时形成阻断问题', () => {
  const result = evaluateSpecConsistency({
    specImpact: { level: 'updated', declared: true, reason: '规则变化', affectedSpecificationIds: ['BR-ORD-001'] },
    traceability: trace([{ path: 'src/order.ts', kind: 'code', specificationIds: ['BR-ORD-001'] }]),
    policy: { mode: 'balanced', configured: false, policyPath: null, blockingRules: ['SPEC_UPDATE_MISSING'], requireExplicitImpactForMappedCode: false, requireTestsForAffectedIds: false }
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockingIssues.some((item) => item.id === 'SPEC_UPDATE_MISSING'));
});

test('specImpact=none 与规格文件变化矛盾', () => {
  const result = evaluateSpecConsistency({
    specImpact: { level: 'none', declared: true },
    traceability: trace([{ path: 'docs/modules/order.md', kind: 'specification', specificationIds: ['BR-ORD-001'] }]),
    policy: { mode: 'balanced', configured: false, policyPath: null, blockingRules: ['SPEC_IMPACT_NONE_WITH_SPEC_CHANGE'], requireExplicitImpactForMappedCode: false, requireTestsForAffectedIds: false }
  });
  assert.equal(result.ok, false);
});

test('映射代码未显式声明 specImpact 默认只告警，保持轻量', () => {
  const result = evaluateSpecConsistency({
    specImpact: { level: 'none', declared: false },
    traceability: trace([{ path: 'src/order.ts', kind: 'code', specificationIds: ['BR-ORD-001'] }]),
    policy: { mode: 'balanced', configured: false, policyPath: null, blockingRules: [], requireExplicitImpactForMappedCode: false, requireTestsForAffectedIds: false }
  });
  assert.equal(result.ok, true);
  assert.ok(result.issues.some((item) => item.id === 'SPEC_IMPACT_UNDECLARED'));
});

test('decision-required 校验 Decision 的 status、affects 和 sourceTaskId', () => {
  const result = evaluateSpecConsistency({
    taskId: 'task-current',
    specImpact: { level: 'decision-required', declared: true, reason: '架构变化', affectedSpecificationIds: ['BR-ORD-001'] },
    traceability: trace([{
      path: 'docs/modules/order/decisions/DEC-001.md', kind: 'decision', specificationIds: ['BR-ORD-001'],
      decisionMetadata: { present: true, metadata: { id: 'DEC-001', status: 'accepted', affects: [], sourceTaskId: 'task-other' } }
    }]),
    policy: { mode: 'balanced', configured: false, policyPath: null, blockingRules: ['DECISION_METADATA_INVALID'], requireExplicitImpactForMappedCode: false, requireTestsForAffectedIds: false }
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockingIssues.some((item) => item.id === 'DECISION_METADATA_INVALID'));
});

test('完整 Decision 元数据通过门禁', () => {
  const result = evaluateSpecConsistency({
    taskId: 'task-current',
    specImpact: { level: 'decision-required', declared: true, reason: '架构变化', affectedSpecificationIds: ['BR-ORD-001'] },
    traceability: trace([{
      path: 'docs/modules/order/decisions/DEC-001.md', kind: 'decision', specificationIds: ['BR-ORD-001'],
      decisionMetadata: { present: true, metadata: { id: 'DEC-001', status: 'proposed', affects: ['order-cancellation'], sourceTaskId: 'task-current' } }
    }]),
    policy: { mode: 'balanced', configured: false, policyPath: null, blockingRules: ['DECISION_METADATA_INVALID'], requireExplicitImpactForMappedCode: false, requireTestsForAffectedIds: false }
  });
  assert.equal(result.ok, true);
});
