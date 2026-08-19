import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createEvidence, validateEvidence, evidenceSummary, payloadHash } from '../../40-脚本/lib/evidence.mjs';
import { tempDir } from '../helpers.mjs';

function context(extra = {}) {
  return {
    taskId: 'task-x',
    changeFingerprint: 'c1',
    inputCycle: 0,
    acceptance: [
      { id: 'A1', requiredCovers: ['behavior'] },
      { id: 'A2', requiredCovers: ['documentation'] }
    ],
    ...extra
  };
}

test('Evidence 绑定 Task、ChangeSet、周期和 Payload Hash', () => {
  const evidence = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['behavior'], source: { type: 'command' },
    result: { status: 'passed', exitCode: 0 }
  });
  assert.equal(validateEvidence(evidence, context()).valid, true);
  evidence.result.summary = 'tamper';
  assert.equal(validateEvidence(evidence, context()).valid, false);
});

test('Scope 和 Diff 不能证明 Acceptance', () => {
  const evidence = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['scope', 'diff'], source: { type: 'artifact' }, result: { status: 'passed' }
  });
  const summary = evidenceSummary({ acceptance: context().acceptance, evidence: [evidence], requiredCovers: ['scope', 'diff'], context: context() });
  assert.deepEqual(summary.missingAcceptance, ['A1', 'A2']);
});

test('Acceptance 必须由 required covers 证明', () => {
  const behavior = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['behavior'], source: { type: 'command' }, result: { status: 'passed', exitCode: 0 }
  });
  const documentation = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A2'], covers: ['documentation'], source: { type: 'file' }, result: { status: 'passed' }
  });
  const summary = evidenceSummary({
    acceptance: context().acceptance,
    evidence: [behavior, documentation],
    requiredCovers: ['behavior', 'documentation'],
    systemEvidenceHashes: [behavior.payloadHash],
    context: context()
  });
  assert.deepEqual(summary.missingAcceptance, []);
  assert.deepEqual(summary.missingCovers, []);
});

test('Imported 技术 Evidence 即使结构合法也不能满足技术 Cover', () => {
  const behavior = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['behavior'], source: { type: 'command' }, result: { status: 'passed', exitCode: 0 }
  });
  const summary = evidenceSummary({
    acceptance: context().acceptance,
    evidence: [behavior],
    requiredCovers: ['behavior'],
    systemEvidenceHashes: [],
    context: context()
  });
  assert.equal(summary.invalid.length, 0);
  assert.deepEqual(summary.missingAcceptance, ['A1', 'A2']);
  assert.deepEqual(summary.missingCovers, ['behavior']);
  assert.deepEqual(summary.untrustedTechnicalEvidence, [{ id: behavior.id, covers: ['behavior'] }]);
});

test('相同 Evidence 的 payloadHash 属于 systemEvidenceHashes 时可信', () => {
  const behavior = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['behavior'], source: { type: 'command' }, result: { status: 'passed', exitCode: 0 }
  });
  const summary = evidenceSummary({
    acceptance: context().acceptance,
    evidence: [behavior],
    requiredCovers: ['behavior'],
    systemEvidenceHashes: [behavior.payloadHash],
    context: context()
  });
  assert.deepEqual(summary.missingAcceptance, ['A2']);
  assert.deepEqual(summary.missingCovers, []);
  assert.deepEqual(summary.untrustedTechnicalEvidence, []);
});

test('Imported 非技术 Evidence 仍可证明 documentation', () => {
  const documentation = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A2'], covers: ['documentation'], source: { type: 'file' }, result: { status: 'passed' }
  });
  const summary = evidenceSummary({
    acceptance: context().acceptance,
    evidence: [documentation],
    requiredCovers: ['documentation'],
    systemEvidenceHashes: [],
    context: context()
  });
  assert.deepEqual(summary.missingAcceptance, ['A1']);
  assert.deepEqual(summary.missingCovers, []);
  assert.deepEqual(summary.untrustedTechnicalEvidence, []);
});

test('篡改 payloadHash 继续被结构校验拒绝', () => {
  const evidence = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['behavior'], source: { type: 'command' }, result: { status: 'passed', exitCode: 0 }
  });
  evidence.payloadHash = payloadHash(evidence).replace(/^./u, (char) => char === 'a' ? 'b' : 'a');
  const result = validateEvidence(evidence, context());
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Payload Hash 无效/u);
});

test('人工 Evidence 不能冒充技术检查', () => {
  const evidence = createEvidence({
    kind: 'self', taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['typecheck'], source: { type: 'human' }, result: { status: 'passed' }
  });
  assert.match(validateEvidence(evidence, context()).errors.join(' '), /不能声明 typecheck/u);
});

test('未知 Evidence Kind 和 Source Type 被拒绝', () => {
  const evidence = createEvidence({
    kind: 'alien', taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['unit'], source: { type: 'alien' }, result: { status: 'passed' }
  });
  const result = validateEvidence(evidence, context());
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /未知 Evidence Kind/u);
  assert.match(result.errors.join(' '), /未知 Evidence Source Type/u);
});

test('Artifact 必须位于允许根目录且内容哈希保持一致', (t) => {
  const root = tempDir(t);
  const artifact = path.join(root, 'result.txt');
  fs.writeFileSync(artifact, 'verified\n');
  const evidence = createEvidence({
    gitRoot: root,
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['behavior'],
    source: { type: 'artifact', artifact: 'result.txt' }, result: { status: 'passed' }
  });
  assert.equal(validateEvidence(evidence, context({ gitRoot: root })).valid, true);
  fs.writeFileSync(artifact, 'changed\n');
  assert.match(validateEvidence(evidence, context({ gitRoot: root })).errors.join(' '), /内容已变化/u);
});

test('Artifact 越出仓库即使 Payload Hash 正确也被拒绝', (t) => {
  const root = tempDir(t);
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
  fs.writeFileSync(outside, 'outside\n');
  t.after(() => fs.rmSync(outside, { force: true }));
  const evidence = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['behavior'],
    source: { type: 'artifact', artifact: `../${path.basename(outside)}`, artifactSha256: '0'.repeat(64) },
    result: { status: 'passed' }
  });
  evidence.payloadHash = payloadHash(evidence);
  assert.match(validateEvidence(evidence, context({ gitRoot: root })).errors.join(' '), /越出允许目录/u);
});
