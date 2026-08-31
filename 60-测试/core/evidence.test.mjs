import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createEvidence, validateEvidence, evidenceSummary, payloadHash } from '../../40-脚本/lib/evidence.mjs';
import { tempDir } from '../helpers.mjs';

const VALIDATE_EVIDENCE = fileURLToPath(new URL('../../40-脚本/validate-evidence.mjs', import.meta.url));

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

test('Acceptance 绑定的 node-test Evidence 必须使用 v2 且逐 case 记录', () => {
  const legacy = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['behavior'],
    source: {
      type: 'command', command: 'node', args: ['--test', '--test-name-pattern', '不存在', 'test.js'],
      testFiles: ['test.js'],
    },
    result: { status: 'passed', exitCode: 0 },
  });
  assert.match(validateEvidence(legacy, context()).errors.join(' '), /用例级结果协议/u);

  const declared = {
    id: 'case-a1', acceptanceIds: ['A1'], covers: ['behavior'],
    testFile: 'test.js', testName: '目标用例', expectedMatches: 1,
  };
  const valid = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['behavior'],
    source: {
      type: 'command', command: 'node', args: ['--test'], runner: 'node-test',
      adapterVersion: 2, resultProtocol: 'node-test-cases-v1', testFiles: ['test.js'], cases: [declared],
    },
    result: {
      status: 'passed', exitCode: 0,
      caseResults: [{ ...declared, status: 'passed', matchedCount: 1, passedCount: 1 }],
    },
  });
  assert.equal(validateEvidence(valid, context()).valid, true);

  const aggregate = structuredClone(valid);
  aggregate.source.cases.push({ ...declared, id: 'case-a2' });
  aggregate.result.caseResults.push({ ...declared, id: 'case-a2', status: 'passed' });
  aggregate.payloadHash = payloadHash(aggregate);
  assert.match(validateEvidence(aggregate, context()).errors.join(' '), /逐 case 独立记录/u);
});

test('Scope 和 Diff 不能证明 Acceptance', () => {
  const evidence = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['scope', 'diff'], source: { type: 'artifact' }, result: { status: 'passed' }
  });
  const summary = evidenceSummary({ acceptance: context().acceptance, evidence: [evidence], requiredCovers: ['scope', 'diff'], context: context() });
  assert.deepEqual(summary.missingAcceptance, ['A1', 'A2']);
});

test('Acceptance 必须由 required covers 证明，文档直接证明同时绑定 Artifact 与系统来源', (t) => {
  const root = tempDir(t);
  fs.writeFileSync(path.join(root, 'README.md'), '# verified\n');
  const behavior = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A1'], covers: ['behavior'], source: { type: 'command' }, result: { status: 'passed', exitCode: 0 }
  });
  const documentation = createEvidence({
    gitRoot: root,
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A2'], covers: ['documentation'],
    source: { type: 'artifact', artifact: 'README.md' }, result: { status: 'passed' }
  });
  const summary = evidenceSummary({
    acceptance: context().acceptance,
    evidence: [behavior, documentation],
    requiredCovers: ['behavior', 'documentation'],
    systemEvidenceHashes: [behavior.payloadHash, documentation.payloadHash],
    context: context({ gitRoot: root })
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
  assert.deepEqual(summary.auxiliaryEvidence, [{
    id: behavior.id,
    covers: ['behavior'],
    reasons: ['missing-system-provenance'],
  }]);
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

test('Imported 非技术 Evidence 只作辅证，不能证明 documentation', () => {
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
  assert.deepEqual(summary.missingAcceptance, ['A1', 'A2']);
  assert.deepEqual(summary.missingCovers, ['documentation']);
  assert.deepEqual(summary.untrustedTechnicalEvidence, []);
  assert.deepEqual(summary.auxiliaryEvidence, [{
    id: documentation.id,
    covers: ['documentation'],
    reasons: ['missing-system-provenance', 'missing-artifact-identity'],
  }]);
});

test('documentation/contract/visual 即使有系统来源，缺少 Artifact identity 仍不能直接证明', () => {
  const acceptance = [
    { id: 'D', requiredCovers: ['documentation'] },
    { id: 'C', requiredCovers: ['contract'] },
    { id: 'V', requiredCovers: ['visual'] },
  ];
  const evidence = acceptance.map((item) => createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: [item.id], covers: item.requiredCovers,
    source: { type: 'command' }, result: { status: 'passed', exitCode: 0 },
  }));
  const summary = evidenceSummary({
    acceptance,
    evidence,
    requiredCovers: ['documentation', 'contract', 'visual'],
    systemEvidenceHashes: evidence.map((item) => item.payloadHash),
    context: context({ acceptance }),
  });
  assert.deepEqual(summary.missingAcceptance, ['D', 'C', 'V']);
  assert.deepEqual(summary.missingCovers, ['documentation', 'contract', 'visual']);
  assert.ok(summary.auxiliaryEvidence.every((item) => item.reasons.includes('missing-artifact-identity')));
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

test('node-test case Artifact identity 会按当前文件内容复验', (t) => {
  const root = tempDir(t);
  fs.writeFileSync(path.join(root, 'proof.md'), '# proof\n');
  const declared = {
    id: 'doc-proof', acceptanceIds: ['A2'], covers: ['documentation'],
    testFile: 'test.js', testName: '文档证明', expectedMatches: 1, artifact: 'proof.md',
  };
  const evidence = createEvidence({
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A2'], covers: ['documentation'],
    source: {
      type: 'command', command: 'node', args: ['--test'], runner: 'node-test',
      adapterVersion: 2, resultProtocol: 'node-test-cases-v1', testFiles: ['test.js'], cases: [declared],
    },
    result: {
      status: 'passed', exitCode: 0,
      caseResults: [{ ...declared, status: 'passed', artifactSha256: '0'.repeat(64) }],
    },
  });
  assert.match(validateEvidence(evidence, context({ gitRoot: root })).errors.join(' '), /内容已变化/u);
});

test('validate-evidence 显式区分 schema-only 与 proof', (t) => {
  const root = tempDir(t);
  fs.writeFileSync(path.join(root, 'README.md'), '# verified\n');
  const acceptance = [{ id: 'A2', requiredCovers: ['documentation'] }];
  const evidence = createEvidence({
    gitRoot: root,
    taskId: 'task-x', changeFingerprint: 'c1', inputCycle: 0,
    acceptanceIds: ['A2'], covers: ['documentation'],
    source: { type: 'artifact', artifact: 'README.md' }, result: { status: 'passed' },
  });
  const evidenceFile = path.join(root, 'evidence.json');
  const acceptanceFile = path.join(root, 'acceptance.json');
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence));
  fs.writeFileSync(acceptanceFile, JSON.stringify(acceptance));
  const baseArgs = [
    '--file', evidenceFile,
    '--acceptance-file', acceptanceFile,
    '--task-id', 'task-x',
    '--change-fingerprint', 'c1',
    '--git-root', root,
  ];

  const schemaOnly = spawnSync(process.execPath, [VALIDATE_EVIDENCE, '--schema-only', ...baseArgs], { encoding: 'utf8' });
  assert.equal(schemaOnly.status, 0, schemaOnly.stderr);
  assert.equal(JSON.parse(schemaOnly.stdout).proofSatisfied, null);

  const importedProof = spawnSync(process.execPath, [VALIDATE_EVIDENCE, '--proof', ...baseArgs], { encoding: 'utf8' });
  assert.equal(importedProof.status, 1, importedProof.stdout);
  assert.equal(JSON.parse(importedProof.stdout).proofSatisfied, false);

  const directProof = spawnSync(process.execPath, [
    VALIDATE_EVIDENCE, '--mode', 'proof', '--system-evidence-hash', evidence.payloadHash, ...baseArgs,
  ], { encoding: 'utf8' });
  assert.equal(directProof.status, 0, directProof.stderr);
  assert.equal(JSON.parse(directProof.stdout).proofSatisfied, true);

  const ambiguous = spawnSync(process.execPath, [VALIDATE_EVIDENCE, ...baseArgs], { encoding: 'utf8' });
  assert.equal(ambiguous.status, 1);
  assert.match(ambiguous.stderr, /必须显式选择/u);
});
