import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathWithinAnyRoot } from './path-boundary.mjs';

const ALLOWED_KINDS = new Set(['tool', 'self', 'user']);
const ALLOWED_SOURCE_TYPES = new Set(['command', 'artifact', 'file', 'human']);
const ALLOWED_COVERS = new Set([
  'scope', 'diff', 'static', 'typecheck', 'lint', 'unit', 'behavior', 'integration',
  'package', 'browser', 'negative-path', 'data', 'rollback', 'architecture',
  'documentation', 'contract', 'visual', 'business-confirmation', 'user-confirmation',
  'risk-acceptance', 'target-environment'
]);
const HUMAN_FORBIDDEN = new Set([
  'scope', 'diff', 'static', 'typecheck', 'lint', 'unit', 'integration', 'package',
  'data', 'rollback', 'architecture', 'browser', 'negative-path', 'target-environment'
]);
const NON_PROOF = new Set(['scope', 'diff', 'static', 'typecheck', 'lint']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function payloadHash(value) {
  const copy = structuredClone(value);
  delete copy.payloadHash;
  return crypto.createHash('sha256').update(JSON.stringify(canonical(copy))).digest('hex');
}

export function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function withArtifactIdentity(source, gitRoot) {
  const normalized = { ...(source ?? { type: 'command' }) };
  if (!normalized.artifact || normalized.artifactSha256 || !gitRoot) return normalized;
  const artifact = path.resolve(gitRoot, normalized.artifact);
  if (fs.existsSync(artifact) && fs.statSync(artifact).isFile() && pathWithinAnyRoot(artifact, [gitRoot])) {
    normalized.artifactSha256 = fileSha256(artifact);
  }
  return normalized;
}

export function createEvidence(input = {}) {
  const evidence = {
    schemaVersion: 4,
    id: input.id ?? `evidence-${crypto.randomUUID()}`,
    kind: input.kind ?? 'tool',
    subject: {
      taskId: input.taskId,
      changeFingerprint: input.changeFingerprint,
      inputCycle: Number(input.inputCycle ?? 0)
    },
    acceptanceIds: [...new Set(input.acceptanceIds ?? [])],
    covers: [...new Set(input.covers ?? [])],
    source: withArtifactIdentity(input.source, input.gitRoot),
    result: input.result ?? { status: 'passed' },
    cache: input.cache ?? null,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  evidence.payloadHash = payloadHash(evidence);
  return evidence;
}

function validateArtifact(evidence, context, errors) {
  const relative = evidence?.source?.artifact;
  if (!relative) return;
  const gitRoot = context.gitRoot ? path.resolve(context.gitRoot) : null;
  if (!gitRoot) {
    errors.push('Evidence Artifact 校验缺少 Git Root');
    return;
  }
  const artifact = path.resolve(gitRoot, relative);
  const allowedRoots = [gitRoot, ...(context.allowedArtifactRoots ?? []).map((item) => path.resolve(item))];
  if (!pathWithinAnyRoot(artifact, allowedRoots)) {
    errors.push(`Evidence Artifact 越出允许目录: ${relative}`);
    return;
  }
  if (!fs.existsSync(artifact) || !fs.statSync(artifact).isFile()) {
    errors.push(`Evidence Artifact 不存在或不是文件: ${relative}`);
    return;
  }
  if (!/^[a-f0-9]{64}$/u.test(evidence.source.artifactSha256 ?? '')) {
    errors.push('Evidence Artifact 缺少有效 SHA-256');
    return;
  }
  if (fileSha256(artifact) !== evidence.source.artifactSha256) {
    errors.push(`Evidence Artifact 内容已变化: ${relative}`);
  }
}

export function validateEvidence(evidence, context = {}) {
  const errors = [];
  if (evidence?.schemaVersion !== 4) errors.push('Evidence Schema 必须是 4');
  if (!evidence?.id || !evidence?.kind) errors.push('Evidence 缺少 ID 或 Kind');
  if (!ALLOWED_KINDS.has(evidence?.kind)) errors.push(`未知 Evidence Kind: ${evidence?.kind}`);
  if (!ALLOWED_SOURCE_TYPES.has(evidence?.source?.type)) errors.push(`未知 Evidence Source Type: ${evidence?.source?.type}`);
  if (evidence?.payloadHash !== payloadHash(evidence)) errors.push('Evidence Payload Hash 无效');
  if (evidence?.subject?.taskId !== context.taskId) errors.push('Evidence 不属于当前 Task');
  if (evidence?.subject?.changeFingerprint !== context.changeFingerprint) errors.push('Evidence 不属于当前 ChangeSet');
  if (Number(evidence?.subject?.inputCycle ?? -1) !== Number(context.inputCycle ?? 0)) errors.push('Evidence 输入周期无效');

  const acceptanceIds = new Set((context.acceptance ?? []).map((item) => item.id));
  if (!Array.isArray(evidence?.acceptanceIds)) errors.push('acceptanceIds 必须是数组');
  for (const id of evidence?.acceptanceIds ?? []) {
    if (!acceptanceIds.has(id)) errors.push(`Acceptance 不存在: ${id}`);
  }

  if (!Array.isArray(evidence?.covers) || !evidence.covers.length) errors.push('Evidence 未声明 Covers');
  for (const cover of evidence?.covers ?? []) {
    if (!ALLOWED_COVERS.has(cover)) errors.push(`未知 Evidence Cover: ${cover}`);
  }

  if (['self', 'user'].includes(evidence?.kind)) {
    for (const cover of evidence.covers ?? []) {
      if (HUMAN_FORBIDDEN.has(cover)) errors.push(`人工 Evidence 不能声明 ${cover}`);
    }
  }

  if (evidence?.source?.type === 'command') {
    if (evidence.result?.status === 'passed' && evidence.result?.exitCode !== 0) {
      errors.push('命令通过状态与退出码不一致');
    }
    if (evidence.source?.sideEffect === 'external') errors.push('普通 Evidence 不得来自未授权外部动作');
  }

  validateArtifact(evidence, context, errors);
  if (!['passed', 'failed', 'accepted'].includes(evidence?.result?.status)) errors.push('Evidence result.status 无效');
  return { valid: errors.length === 0, errors };
}

export function validateEvidenceSet(evidenceList = [], context = {}) {
  const valid = [];
  const invalid = [];
  for (const evidence of evidenceList) {
    const result = validateEvidence(evidence, context);
    (result.valid ? valid : invalid).push(result.valid ? evidence : { evidence, errors: result.errors });
  }
  return { valid, invalid };
}

export function evidenceSummary(input = {}) {
  const checked = validateEvidenceSet(input.evidence ?? [], {
    ...(input.context ?? {}),
    acceptance: input.acceptance ?? []
  });
  const passed = checked.valid.filter((item) => ['passed', 'accepted'].includes(item.result?.status));
  const covers = [...new Set(passed.flatMap((item) => item.covers ?? []))];
  const acceptanceCoverage = {};
  for (const acceptance of input.acceptance ?? []) {
    const bound = passed.filter((evidence) => evidence.acceptanceIds?.includes(acceptance.id));
    const boundCovers = new Set(bound.flatMap((evidence) => evidence.covers ?? []));
    const required = acceptance.requiredCovers ?? [];
    const satisfied = required.length
      ? required.every((cover) => boundCovers.has(cover))
      : bound.some((evidence) => (evidence.covers ?? []).some((cover) => !NON_PROOF.has(cover)));
    acceptanceCoverage[acceptance.id] = { satisfied, covers: [...boundCovers] };
  }
  return {
    ...checked,
    covers,
    acceptanceCoverage,
    coveredAcceptance: Object.entries(acceptanceCoverage).filter(([, value]) => value.satisfied).map(([id]) => id),
    missingAcceptance: Object.entries(acceptanceCoverage).filter(([, value]) => !value.satisfied).map(([id]) => id),
    missingCovers: (input.requiredCovers ?? []).filter((cover) => !covers.includes(cover))
  };
}

export const evidenceKinds = ALLOWED_KINDS;
export const evidenceSourceTypes = ALLOWED_SOURCE_TYPES;
