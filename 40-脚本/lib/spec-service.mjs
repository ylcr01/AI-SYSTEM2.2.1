import fs from 'node:fs';
import path from 'node:path';
import { createSpecImpact, mergeSpecImpact } from './spec-impact.mjs';
import { mapChangedFilesToSpecifications, mapIntentToSpecifications } from './spec-mapper.mjs';
import { evaluateSpecConsistency } from './spec-consistency.mjs';
import { resolveRepositoryPath } from './path-boundary.mjs';

function configured(gitRoot) {
  return fs.existsSync(path.join(gitRoot, '.ai', 'spec-map.json'));
}

export function addIntentSpecificationHints(context, gitRoot, intent) {
  if (!configured(gitRoot)) {
    context.specificationHints = { configured: false, matchedRuleIds: [], specificationFiles: [], specificationIds: [], testFiles: [] };
    return context;
  }
  const hints = mapIntentToSpecifications({ gitRoot, intent });
  context.specificationHints = hints;
  for (const relative of hints.specificationFiles ?? []) {
    const file = resolveRepositoryPath(gitRoot, relative, { label: '模块规格路径' }).target;
    if (fs.existsSync(file) && fs.statSync(file).isFile() && !context.filesToRead.includes(file)) context.filesToRead.push(file);
  }
  return context;
}

export function effectiveSpecImpact(task, options = {}) {
  const overrideIds = options.affectedSpecificationIdsProvided ? (options.affectedSpecificationIds ?? []) : undefined;
  return mergeSpecImpact(task.specImpact, {
    level: options.specImpact,
    reason: options.specImpactReason,
    affectedSpecificationIds: overrideIds
  });
}

export function buildSpecState(task, changeSet, options = {}) {
  const specImpact = effectiveSpecImpact(task, options);
  if (!configured(changeSet.gitRoot) && specImpact.level === 'none') {
    return { specImpact, specTraceability: null, specConsistency: null };
  }
  const specTraceability = mapChangedFilesToSpecifications({
    gitRoot: changeSet.gitRoot,
    changedFiles: changeSet.files
  });
  const specConsistency = evaluateSpecConsistency({
    gitRoot: changeSet.gitRoot,
    taskId: task.taskId,
    changeSet,
    specImpact,
    traceability: specTraceability
  });
  return { specImpact, specTraceability, specConsistency };
}

export function revalidateSpecState(task, changeSet) {
  const specImpact = createSpecImpact(task.specImpact ?? {});
  if (!configured(changeSet.gitRoot) && specImpact.level === 'none') {
    return { specImpact, specTraceability: null, specConsistency: null };
  }
  const specTraceability = mapChangedFilesToSpecifications({
    gitRoot: changeSet.gitRoot,
    changedFiles: changeSet.files
  });
  const specConsistency = evaluateSpecConsistency({
    gitRoot: changeSet.gitRoot,
    taskId: task.taskId,
    changeSet,
    specImpact,
    traceability: specTraceability
  });
  return { specImpact, specTraceability, specConsistency };
}

export function stableSpecReviewState(specState) {
  if (!specState.specTraceability || !specState.specConsistency) {
    return { specImpact: specState.specImpact, specTraceability: null, specConsistency: null };
  }
  return {
    specImpact: specState.specImpact,
    specTraceability: {
      configured: specState.specTraceability.configured,
      affectedSpecificationIds: specState.specTraceability.affectedSpecificationIds,
      files: (specState.specTraceability.files ?? []).map((item) => ({
        path: item.path,
        kind: item.kind,
        matchedRuleIds: item.matchedRuleIds,
        specificationIds: item.specificationIds,
        decisionMetadata: item.decisionMetadata ?? null
      })),
      testCoverage: specState.specTraceability.testCoverage
    },
    specConsistency: {
      ok: specState.specConsistency.ok,
      effectiveAffectedSpecificationIds: specState.specConsistency.effectiveAffectedSpecificationIds,
      issues: (specState.specConsistency.issues ?? []).map((item) => ({
        id: item.id,
        severity: item.severity,
        message: item.message
      })),
      blockingIssues: (specState.specConsistency.blockingIssues ?? []).map((item) => item.id)
    }
  };
}
