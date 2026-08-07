import fs from 'node:fs';
import path from 'node:path';
import { createSpecImpact } from './spec-impact.mjs';
import { normalizeRepositoryRelative, resolveRepositoryPath } from './path-boundary.mjs';

const DEFAULT_POLICY = Object.freeze({
  schemaVersion: 1,
  mode: 'balanced',
  blockingRules: [
    'SPEC_IMPACT_NONE_WITH_SPEC_CHANGE',
    'SPEC_UPDATE_MISSING',
    'DECISION_MISSING',
    'DECISION_METADATA_INVALID'
  ],
  requireExplicitImpactForMappedCode: false,
  requireTestsForAffectedIds: false
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadSpecPolicy(gitRoot, options = {}) {
  const root = path.resolve(gitRoot);
  const relative = normalizeRepositoryRelative(options.policyPath ?? '.ai/spec-policy.json', 'spec-policy 路径');
  const policyPath = resolveRepositoryPath(root, relative, { label: 'spec-policy 路径' }).target;
  if (!fs.existsSync(policyPath)) return { ...DEFAULT_POLICY, policyPath, configured: false };
  const raw = readJson(policyPath);
  if (raw.schemaVersion !== 1) throw new Error(`不支持的 spec-policy schemaVersion: ${raw.schemaVersion}`);
  const mode = raw.mode ?? DEFAULT_POLICY.mode;
  if (!['advisory', 'balanced', 'strict'].includes(mode)) throw new Error(`无效 spec-policy mode: ${mode}`);
  return {
    ...DEFAULT_POLICY,
    ...raw,
    mode,
    blockingRules: [...new Set(raw.blockingRules ?? DEFAULT_POLICY.blockingRules)],
    policyPath,
    configured: true
  };
}

function issue(id, severity, message, details = {}) {
  return { id, severity, message, ...details };
}

function changedKinds(traceability = {}) {
  const files = traceability.files ?? [];
  return {
    code: files.filter((item) => item.kind === 'code'),
    specifications: files.filter((item) => item.kind === 'specification'),
    decisions: files.filter((item) => item.kind === 'decision'),
    tests: files.filter((item) => item.kind === 'test'),
    documentation: files.filter((item) => item.kind === 'documentation')
  };
}

function isBlocking(issueItem, policy) {
  if (issueItem.severity === 'error') return policy.mode !== 'advisory' && policy.blockingRules.includes(issueItem.id);
  if (policy.mode === 'strict' && issueItem.severity === 'warning') {
    if (issueItem.id === 'SPEC_IMPACT_UNDECLARED' && policy.requireExplicitImpactForMappedCode) return true;
    if (issueItem.id === 'SPEC_TEST_COVERAGE_MISSING' && policy.requireTestsForAffectedIds) return true;
  }
  return false;
}

function decisionMetadataErrors(item, taskId) {
  const record = item.decisionMetadata;
  if (!record?.present || !record.metadata) return ['缺少 YAML Front Matter'];
  const metadata = record.metadata;
  const errors = [];
  if (!/^DEC-[A-Z0-9][A-Z0-9-]*$/u.test(metadata.id ?? '')) errors.push('id 必须使用 DEC-* 稳定格式');
  if (!['proposed', 'accepted', 'superseded'].includes(metadata.status)) errors.push('status 必须是 proposed、accepted 或 superseded');
  if (!Array.isArray(metadata.affects) || metadata.affects.length === 0) errors.push('affects 不能为空');
  if (!metadata.sourceTaskId) errors.push('sourceTaskId 不能为空');
  else if (taskId && metadata.sourceTaskId !== taskId) errors.push(`sourceTaskId 必须等于当前 Task ${taskId}`);
  if (metadata.status === 'superseded' && !metadata.supersededBy) errors.push('superseded Decision 必须声明 supersededBy');
  return errors;
}

function validateChangedDecisions(decisions, taskId) {
  const records = decisions.map((item) => ({
    file: item.path,
    metadata: item.decisionMetadata?.metadata ?? null,
    errors: decisionMetadataErrors(item, taskId)
  }));
  const ids = records.map((item) => item.metadata?.id).filter(Boolean);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) {
    for (const record of records.filter((item) => duplicates.includes(item.metadata?.id))) record.errors.push('同一 ChangeSet 中 Decision ID 重复');
  }
  return {
    records,
    valid: records.length > 0 && records.every((item) => item.errors.length === 0),
    hasCurrentDecision: records.some((item) => ['proposed', 'accepted'].includes(item.metadata?.status))
  };
}

export function evaluateSpecConsistency(input = {}) {
  const gitRoot = path.resolve(input.gitRoot ?? input.changeSet?.gitRoot ?? input.traceability?.gitRoot ?? process.cwd());
  const policy = input.policy ?? loadSpecPolicy(gitRoot, input);
  const specImpact = createSpecImpact(input.specImpact ?? {});
  const traceability = input.traceability ?? { files: [], affectedSpecificationIds: [], unmappedCodeFiles: [], testCoverage: {} };
  const kinds = changedKinds(traceability);
  const issues = [];
  const declaredIds = new Set(specImpact.affectedSpecificationIds ?? []);
  const mappedIds = new Set(traceability.affectedSpecificationIds ?? []);
  const effectiveIds = [...new Set([...declaredIds, ...mappedIds])].sort();

  const mappedCode = kinds.code.filter((item) => item.specificationIds?.length > 0);
  if (mappedCode.length && !specImpact.declared) {
    issues.push(issue(
      'SPEC_IMPACT_UNDECLARED',
      policy.requireExplicitImpactForMappedCode ? 'error' : 'warning',
      '代码变化已关联业务规格，但本次任务没有显式声明 specImpact',
      { files: mappedCode.map((item) => item.path), specificationIds: effectiveIds }
    ));
  }

  if (specImpact.level === 'none' && (kinds.specifications.length || kinds.decisions.length)) {
    issues.push(issue(
      'SPEC_IMPACT_NONE_WITH_SPEC_CHANGE',
      'error',
      'specImpact=none 与实际规格或 Decision 文件变化矛盾',
      { files: [...kinds.specifications, ...kinds.decisions].map((item) => item.path) }
    ));
  }

  if (specImpact.level === 'updated' && kinds.specifications.length === 0) {
    issues.push(issue(
      'SPEC_UPDATE_MISSING',
      'error',
      'specImpact=updated，但 ChangeSet 中没有模块规格文件变化',
      { expectedSpecificationFiles: traceability.specificationFiles ?? [] }
    ));
  }

  if (specImpact.level === 'decision-required' && kinds.decisions.length === 0) {
    issues.push(issue(
      'DECISION_MISSING',
      'error',
      'specImpact=decision-required，但 ChangeSet 中没有 Decision 文件变化',
      { expectedDecisionFiles: traceability.decisionFiles ?? [] }
    ));
  }

  if (kinds.decisions.length > 0) {
    const validation = validateChangedDecisions(kinds.decisions, input.taskId);
    if (!validation.valid || (specImpact.level === 'decision-required' && !validation.hasCurrentDecision)) {
      issues.push(issue(
        'DECISION_METADATA_INVALID',
        'error',
        'Decision 元数据不完整或与当前 Task 不一致',
        { decisions: validation.records, currentDecisionMissing: specImpact.level === 'decision-required' && !validation.hasCurrentDecision }
      ));
    }
  }

  if (specImpact.level !== 'none' && !specImpact.reason) issues.push(issue('SPEC_IMPACT_REASON_MISSING', 'warning', '业务规格影响未说明原因'));
  if (specImpact.level !== 'none' && effectiveIds.length === 0) issues.push(issue('SPEC_IDS_MISSING', 'warning', '业务规格发生变化，但没有声明或映射到 BR/TR/SC/EX ID'));

  const unknownDeclared = [...declaredIds].filter((id) => mappedIds.size > 0 && !mappedIds.has(id));
  if (unknownDeclared.length) {
    issues.push(issue(
      'DECLARED_SPEC_IDS_UNMAPPED',
      'warning',
      '部分手工声明的规格 ID 未被当前文件映射支持',
      { specificationIds: unknownDeclared }
    ));
  }

  if ((traceability.unmappedCodeFiles ?? []).length) {
    issues.push(issue(
      'BUSINESS_CODE_UNMAPPED',
      'warning',
      '存在未映射到规格的代码文件；这不是自动判定错误，但会降低追踪完整性',
      { files: traceability.unmappedCodeFiles }
    ));
  }

  const missingCoverage = effectiveIds.filter((id) => !(traceability.testCoverage?.[id] ?? []).length);
  if (missingCoverage.length && specImpact.level !== 'none') {
    issues.push(issue(
      'SPEC_TEST_COVERAGE_MISSING',
      policy.requireTestsForAffectedIds ? 'error' : 'warning',
      '受影响规格 ID 没有在配置的测试文件中形成可追踪引用',
      { specificationIds: missingCoverage }
    ));
  }

  if (kinds.specifications.length && kinds.tests.length === 0) {
    issues.push(issue(
      'SPEC_CHANGED_WITHOUT_TEST_CHANGE',
      'warning',
      '规格已变化但本次 ChangeSet 没有测试文件变化；已有测试可能足够，需要人工确认',
      { specificationFiles: kinds.specifications.map((item) => item.path) }
    ));
  }

  const blockingIssues = issues.filter((item) => isBlocking(item, policy));
  return {
    schemaVersion: 2,
    checkedAt: new Date().toISOString(),
    gitRoot,
    policy: {
      mode: policy.mode,
      configured: policy.configured,
      policyPath: policy.policyPath,
      blockingRules: policy.blockingRules,
      requireExplicitImpactForMappedCode: policy.requireExplicitImpactForMappedCode,
      requireTestsForAffectedIds: policy.requireTestsForAffectedIds
    },
    specImpact,
    effectiveAffectedSpecificationIds: effectiveIds,
    changed: {
      code: kinds.code.map((item) => item.path),
      specifications: kinds.specifications.map((item) => item.path),
      decisions: kinds.decisions.map((item) => item.path),
      tests: kinds.tests.map((item) => item.path)
    },
    issues,
    blockingIssues,
    ok: blockingIssues.length === 0
  };
}
