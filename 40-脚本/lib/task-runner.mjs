import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildContext } from './context-builder.mjs';
import { captureBaseline, computeChangeSet, normalizeScope, assertChangeSetWithinScope, userChangesRemainIsolated } from './git-state.mjs';
import { classifyTask, reclassifyFromChangeSet, determineEvidenceRequirements, evaluateDeliveryEligibility, canRerunVerification } from './task-policy.mjs';
import { createEvidence, evidenceSummary } from './evidence.mjs';
import { planChecks, executeCheckPlan, loadChecks, acceptanceIdsForCheck } from './check-planner.mjs';
import { createBudget } from './verification-budget.mjs';
import { buildReviewPackage, validateReviewRecord, reviewRequirementSatisfied, reviewHasBlockingFindings } from './review.mjs';
import { createTask, readTask, findTask, updateTask, listTasks } from './state-manager.mjs';
import { createHandoff, handoffIsFresh } from './handoff.mjs';
import { createSpecImpact } from './spec-impact.mjs';
import { addIntentSpecificationHints, buildSpecState, revalidateSpecState, stableSpecReviewState } from './spec-service.mjs';

function defaultAcceptanceCovers(classification) {
  const kinds = new Set(classification.artifactKinds ?? []);
  if (kinds.has('documentation') || kinds.has('product') || kinds.has('requirements')) return ['documentation'];
  if (kinds.has('operations')) return classification.controlMode === 'quick' ? ['documentation'] : ['target-environment'];
  return ['behavior'];
}

function acceptanceItems(value, classification) {
  const values = Array.isArray(value) ? value : [value].filter(Boolean);
  const items = values.flatMap((item) => typeof item === 'string' ? String(item).split(/[;；\n]/u) : [item]).filter(Boolean);
  const normalized = items.length ? items : ['完成用户目标并提供可信证据'];
  return normalized.map((item, index) => typeof item === 'string'
    ? { id: `A${index + 1}`, description: item.trim(), requiredCovers: defaultAcceptanceCovers(classification), status: 'open' }
    : { id: item.id ?? `A${index + 1}`, description: String(item.description ?? item.statement ?? ''), requiredCovers: item.requiredCovers ?? defaultAcceptanceCovers(classification), status: 'open' });
}

function loadJsonFile(file) {
  if (!file) return [];
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  return Array.isArray(value) ? value : [value];
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function acceptanceFingerprint(items) {
  return hash(items.map((item) => ({ id: item.id, description: item.description, requiredCovers: item.requiredCovers ?? [] })));
}

function stableFailureFingerprint(changeFingerprint, planFingerprint, inputCycle) {
  return hash({ changeFingerprint, planFingerprint, inputCycle });
}

function scopeAndDiffEvidence(task, changeSet, inputCycle) {
  return createEvidence({
    kind: 'tool',
    taskId: task.taskId,
    changeFingerprint: changeSet.fingerprint,
    inputCycle,
    acceptanceIds: [],
    covers: ['scope', 'diff'],
    source: { type: 'artifact', actor: 'ai-system', session: null },
    result: { status: 'passed', summary: `${changeSet.files.length} 个任务改动文件位于授权 Scope` },
    createdAt: changeSet.computedAt
  });
}

function evidenceFromCheck(task, changeSet, inputCycle, check) {
  return createEvidence({
    kind: 'tool',
    taskId: task.taskId,
    changeFingerprint: changeSet.fingerprint,
    inputCycle,
    acceptanceIds: acceptanceIdsForCheck(check, task.acceptance),
    covers: check.covers ?? [],
    source: {
      type: 'command', actor: 'ai-system', session: null,
      command: check.command, args: check.args, cwd: check.cwd, sideEffect: check.sideEffect
    },
    result: {
      status: check.status === 0 && !check.error ? 'passed' : 'failed',
      exitCode: check.status,
      durationMs: check.durationMs,
      summary: check.error ?? check.stderr?.text ?? `${check.name} 通过`,
      resultFingerprint: check.resultFingerprint
    },
    cache: { cacheable: check.cacheable === true, cacheKey: check.cacheKey ?? null, reused: check.reused === true },
    createdAt: check.finishedAt ?? new Date().toISOString()
  });
}

function qualityReviewRefs(task) {
  return {
    qualityContracts: (task.context?.quality?.contracts ?? []).map((item) => ({ id: item.id, version: item.version, source: item.source, path: item.path })),
    canonicalExemplars: (task.context?.quality?.exemplars ?? []).map((item) => ({ id: item.id, source: item.source, contract: item.contract, files: item.files }))
  };
}

function reviewContext(task, changeSet, pack) {
  return {
    taskId: task.taskId,
    changeFingerprint: changeSet.fingerprint,
    packageFingerprint: pack.packageFingerprint,
    packageCreatedAt: pack.createdAt
  };
}

export function prepareTask(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const intent = String(options.intent ?? '').trim();
  if (!intent) throw new Error('准备任务必须提供 Intent');
  const initial = classifyTask({
    intent,
    acceptance: (options.acceptance ?? []).toString(),
    tracked: options.tracked !== false,
    handoffRequired: options.handoffRequired === true
  });
  const acceptance = acceptanceItems(options.acceptance, initial);
  const built = buildContext({
    cwd,
    projectId: options.projectId,
    intent,
    acceptance: acceptance.map((item) => item.description).join(' '),
    classification: initial,
    skills: options.skills ?? []
  });
  const gitRoot = built.context.gitRoot;
  if (!gitRoot) throw new Error('写任务必须位于可确认的 Git 工作树');
  addIntentSpecificationHints(built, gitRoot, intent);
  const scope = normalizeScope(built.executionTarget.targetPath, options.scope ?? '.', gitRoot);
  const baseline = captureBaseline(gitRoot);
  const budget = createBudget({ mode: initial.controlMode, limitMs: options.budgetMs });
  return createTask({
    stateRoot: options.stateRoot,
    goal: { summary: intent, nonGoals: options.nonGoals ?? [], assumptions: [], openQuestions: [] },
    acceptance,
    authorization: {
      scope: [scope],
      allowedExistingChanges: options.allowedExistingChanges ?? [],
      externalActions: [],
      explicitReviewRequirement: options.explicitReviewRequirement ?? null
    },
    classification: initial,
    context: built,
    baseline,
    verification: {
      budget,
      inputCycle: 0,
      lastFailureFingerprint: null,
      diagnosticRetryUsed: false,
      requiredCovers: [],
      missingCovers: [],
      stopReason: null
    },
    specImpact: createSpecImpact({
      level: options.specImpact,
      declared: options.specImpact !== undefined,
      reason: options.specImpactReason ?? null,
      affectedSpecificationIds: options.affectedSpecificationIds ?? []
    })
  });
}

export function deliverTask(options = {}) {
  const current = readTask({ stateRoot: options.stateRoot, taskId: options.taskId });
  const task = current.task;
  const scope = task.authorization.scope[0];
  const before = computeChangeSet(task.baseline);
  const scopeValidation = assertChangeSetWithinScope(before, scope);
  const isolation = userChangesRemainIsolated(task.baseline, before, task.authorization.allowedExistingChanges ?? []);
  const classification = reclassifyFromChangeSet(task.classification, before, { forcedMode: options.forceMode, forceReason: options.forceReason });
  let inputCycle = Number(task.verification?.inputCycle ?? 0);
  const inputChanged = Boolean(options.inputChange);
  if (inputChanged) {
    if (!options.inputChangeReason) throw new Error('声明验证输入变化时必须说明原因');
    inputCycle += 1;
  }

  let evidence = [
    ...(task.evidence ?? []).filter((item) => item.subject?.changeFingerprint === before.fingerprint && Number(item.subject?.inputCycle ?? -1) === inputCycle),
    ...loadJsonFile(options.evidenceFile),
    scopeAndDiffEvidence(task, before, inputCycle)
  ];
  const reviews = [...(task.reviews ?? []), ...loadJsonFile(options.reviewFile)];
  let changeSet = before;
  let requiredCovers = determineEvidenceRequirements({ classification, changeSet, acceptance: task.acceptance, observableBrowserBehavior: options.observableBrowserBehavior === true });
  let summary = evidenceSummary({
    acceptance: task.acceptance,
    evidence,
    requiredCovers,
    context: { taskId: task.taskId, changeFingerprint: changeSet.fingerprint, inputCycle, gitRoot: changeSet.gitRoot }
  });
  let checkExecution = null;
  let lastFailure = inputChanged ? null : task.verification?.lastFailureFingerprint ?? null;
  let diagnosticRetryUsed = inputChanged ? false : task.verification?.diagnosticRetryUsed === true;

  if (options.autoChecks !== false && (summary.missingCovers.length > 0 || summary.missingAcceptance.length > 0)) {
    const checks = loadChecks(changeSet.gitRoot, { templateRoot: task.context?.context?.template?.path ?? null });
    const plan = planChecks({
      cwd: changeSet.gitRoot,
      profile: classification.controlMode,
      requiredCovers: summary.missingCovers,
      existingCovers: summary.covers,
      acceptance: task.acceptance,
      acceptanceCoverage: summary.acceptanceCoverage,
      checks
    });
    const failureFingerprint = stableFailureFingerprint(changeSet.fingerprint, plan.fingerprint, inputCycle);
    const rerun = canRerunVerification({
      previousFailure: lastFailure === failureFingerprint,
      inputChanged,
      diagnosticRetry: options.diagnosticRetry === true,
      diagnosticRetryUsed
    });
    if (!rerun.allowed) {
      throw new Error(rerun.reason === 'diagnostic-retry-already-used'
        ? '相同输入已经使用过一次诊断性重试'
        : '验证输入没有变化，禁止机械重复失败检查');
    }
    checkExecution = executeCheckPlan(plan, {
      cwd: changeSet.gitRoot,
      stateRoot: current.stateRoot,
      cacheFile: current.cacheFile,
      budget: task.verification.budget,
      taskId: task.taskId,
      acceptanceFingerprint: acceptanceFingerprint(task.acceptance),
      changeFingerprint: changeSet.fingerprint,
      inputCycle,
      environmentIdentity: options.environmentIdentity ?? null
    });
    const after = computeChangeSet(task.baseline);
    if (after.fingerprint !== before.fingerprint) {
      changeSet = after;
      checkExecution = { ...checkExecution, ok: false, status: 'unavailable', stopReason: 'check-mutated-input', failure: '自动检查改变了任务输入，原 Evidence 已失效' };
      evidence = [];
    } else if (options.diagnosticRetry === true && checkExecution.status === 'passed') {
      checkExecution = { ...checkExecution, ok: false, status: 'unavailable', stopReason: 'diagnostic-only', failure: '诊断性重试通过不能直接成为稳定 Evidence' };
      diagnosticRetryUsed = true;
      lastFailure = failureFingerprint;
    } else {
      evidence.push(...checkExecution.results.filter((item) => item.status === 0 && !item.error).map((item) => evidenceFromCheck(task, changeSet, inputCycle, item)));
      if (!checkExecution.ok) {
        lastFailure = failureFingerprint;
        if (options.diagnosticRetry === true) diagnosticRetryUsed = true;
      } else lastFailure = null;
    }
  }

  requiredCovers = determineEvidenceRequirements({ classification, changeSet, acceptance: task.acceptance, observableBrowserBehavior: options.observableBrowserBehavior === true });
  summary = evidenceSummary({
    acceptance: task.acceptance,
    evidence,
    requiredCovers,
    context: { taskId: task.taskId, changeFingerprint: changeSet.fingerprint, inputCycle, gitRoot: changeSet.gitRoot }
  });

  const specState = buildSpecState(task, changeSet, options);
  const stableSpecState = stableSpecReviewState(specState);
  const refs = qualityReviewRefs(task);
  const reviewInput = {
    taskId: task.taskId,
    changeFingerprint: changeSet.fingerprint,
    goal: task.goal,
    acceptance: task.acceptance,
    ...refs,
    evidenceSummary: {
      coveredAcceptance: summary.coveredAcceptance,
      covers: summary.covers,
      missingAcceptance: summary.missingAcceptance,
      missingCovers: summary.missingCovers
    },
    specImpact: stableSpecState.specImpact,
    specTraceability: stableSpecState.specTraceability,
    specConsistency: stableSpecState.specConsistency,
    residualRisks: options.residualRisks ?? []
  };
  const candidatePackage = buildReviewPackage({ ...reviewInput, createdAt: task.reviewPackage?.createdAt });
  const reviewPackage = task.reviewPackage?.basisFingerprint === candidatePackage.basisFingerprint ? task.reviewPackage : buildReviewPackage(reviewInput);
  const validReviews = reviews.filter((record) => validateReviewRecord(record, reviewContext(task, changeSet, reviewPackage)).valid);
  const reviewSatisfied = reviewRequirementSatisfied(task.authorization.explicitReviewRequirement, validReviews, reviewContext(task, changeSet, reviewPackage));
  const blockingReview = reviewHasBlockingFindings(validReviews);

  let decision;
  if (checkExecution?.stopReason === 'budget') decision = { decision: 'saved', reasons: ['budget'] };
  else if (checkExecution?.stopReason === 'check-mutated-input') decision = { decision: 'verifying', reasons: ['check-mutated-input'] };
  else if (checkExecution && !checkExecution.ok) decision = { decision: 'needs_rework', reasons: [checkExecution.stopReason ?? checkExecution.status] };
  else if (!specState.specConsistency.ok) decision = { decision: 'needs_rework', reasons: ['spec-consistency', ...specState.specConsistency.blockingIssues.map((item) => item.id)] };
  else {
    decision = evaluateDeliveryEligibility({
      identityValid: Boolean(task.context?.context?.gitRoot),
      scopeValid: scopeValidation.ok,
      userChangesIsolated: isolation.ok,
      blockers: task.blockers,
      invalidEvidence: summary.invalid,
      missingAcceptance: summary.missingAcceptance,
      missingCovers: summary.missingCovers,
      explicitReviewRequirement: task.authorization.explicitReviewRequirement,
      reviewSatisfied,
      reviewHasBlockingFindings: blockingReview,
      handoffRequired: false,
      handoffReady: true
    });
  }
  const status = decision.decision;

  return updateTask({
    stateRoot: options.stateRoot,
    taskId: task.taskId,
    expectedRevision: task.stateRevision,
    transitionTo: status,
    event: 'delivery',
    mutate(next) {
      next.classification = classification;
      next.changeSet = changeSet;
      next.evidence = evidence;
      next.reviews = validReviews;
      next.reviewPackage = reviewPackage;
      next.residualRisks = options.residualRisks ?? next.residualRisks;
      next.specImpact = specState.specImpact;
      next.specTraceability = specState.specTraceability;
      next.specConsistency = specState.specConsistency;
      next.verification = {
        ...next.verification,
        budget: checkExecution?.budget ?? next.verification.budget,
        inputCycle,
        lastFailureFingerprint: lastFailure,
        diagnosticRetryUsed,
        requiredCovers,
        missingCovers: summary.missingCovers,
        missingAcceptance: summary.missingAcceptance,
        stopReason: checkExecution?.stopReason ?? (status === 'waiting_acceptance' ? 'evidence-sufficient' : null),
        lastInputChange: inputChanged ? { type: options.inputChange, reason: options.inputChangeReason } : null
      };
      next.deliveryDecision = decision;
      next.blockers = isolation.ok ? next.blockers : [...new Set([...(next.blockers ?? []), `用户已有改动被触及: ${isolation.overwritten.join(', ')}`])];
      if (next.classification.continuity === 'handoff-required' || status === 'saved') {
        next.handoff = createHandoff({ ...next, status }, { stateRevision: task.stateRevision + 1, next: status });
      }
      return next;
    }
  });
}

function revalidateForAcceptance(task) {
  const changeSet = computeChangeSet(task.baseline);
  if (changeSet.fingerprint !== task.changeSet?.fingerprint) throw new Error('交付后的目标文件已经变化，必须重新验证和交付');
  const scopeValidation = assertChangeSetWithinScope(changeSet, task.authorization.scope[0]);
  const isolation = userChangesRemainIsolated(task.baseline, changeSet, task.authorization.allowedExistingChanges ?? []);
  const requiredCovers = determineEvidenceRequirements({
    classification: task.classification,
    changeSet,
    acceptance: task.acceptance,
    observableBrowserBehavior: task.verification?.requiredCovers?.includes('browser')
  });
  const summary = evidenceSummary({
    acceptance: task.acceptance,
    evidence: task.evidence,
    requiredCovers,
    context: { taskId: task.taskId, changeFingerprint: changeSet.fingerprint, inputCycle: task.verification?.inputCycle ?? 0, gitRoot: changeSet.gitRoot }
  });
  const specState = revalidateSpecState(task, changeSet);
  const traceability = specState.specTraceability;
  const specConsistency = specState.specConsistency;
  if (!specConsistency.ok) throw new Error(`验收前规格一致性门禁已失效: ${specConsistency.blockingIssues.map((item) => item.id).join(', ')}`);
  const pack = task.reviewPackage;
  const validReviews = (task.reviews ?? []).filter((record) => pack && validateReviewRecord(record, reviewContext(task, changeSet, pack)).valid);
  const reviewSatisfied = reviewRequirementSatisfied(task.authorization.explicitReviewRequirement, validReviews, pack ? reviewContext(task, changeSet, pack) : {});
  const decision = evaluateDeliveryEligibility({
    identityValid: Boolean(task.context?.context?.gitRoot),
    scopeValid: scopeValidation.ok,
    userChangesIsolated: isolation.ok,
    blockers: task.blockers,
    invalidEvidence: summary.invalid,
    missingAcceptance: summary.missingAcceptance,
    missingCovers: summary.missingCovers,
    explicitReviewRequirement: task.authorization.explicitReviewRequirement,
    reviewSatisfied,
    reviewHasBlockingFindings: reviewHasBlockingFindings(validReviews),
    handoffRequired: task.classification.continuity === 'handoff-required',
    handoffReady: task.classification.continuity !== 'handoff-required' || handoffIsFresh(task.handoff, task)
  });
  if (decision.decision !== 'waiting_acceptance') throw new Error(`验收前可信门禁已失效: ${decision.reasons.join(', ')}`);
  return { changeSet, summary, validReviews, traceability, specConsistency };
}

export function acceptTask(options = {}) {
  const current = readTask({ stateRoot: options.stateRoot, taskId: options.taskId });
  const task = current.task;
  const decision = options.decision === '通过' ? 'passed' : options.decision === '退回' ? 'rejected' : options.decision;
  if (!['passed','rejected'].includes(decision)) throw new Error('验收决定只能是通过或退回');
  if (decision === 'rejected') {
    return updateTask({
      stateRoot: options.stateRoot,
      taskId: task.taskId,
      expectedRevision: task.stateRevision,
      transitionTo: 'needs_rework',
      event: 'user-reject',
      mutate(next) {
        next.userAcceptance = { decision: 'rejected', note: options.note ?? null, decidedAt: new Date().toISOString() };
        return next;
      }
    });
  }
  if (task.status !== 'waiting_acceptance') throw new Error(`任务当前不能验收通过: ${task.status}`);
  const validation = revalidateForAcceptance(task);
  return updateTask({
    stateRoot: options.stateRoot,
    taskId: task.taskId,
    expectedRevision: task.stateRevision,
    transitionTo: 'accepted',
    event: 'user-accept',
    mutate(next) {
      next.specTraceability = validation.traceability;
      next.specConsistency = validation.specConsistency;
      next.userAcceptance = { decision: 'passed', note: options.note ?? null, decidedAt: new Date().toISOString() };
      return next;
    }
  });
}

export function saveTask(options = {}) {
  const current = readTask({ stateRoot: options.stateRoot, taskId: options.taskId });
  return updateTask({
    stateRoot: options.stateRoot,
    taskId: current.task.taskId,
    expectedRevision: current.task.stateRevision,
    transitionTo: 'saved',
    event: 'save',
    mutate(next) {
      next.handoff = createHandoff({ ...next, status: 'saved' }, { stateRevision: current.task.stateRevision + 1, next: 'saved' });
      return next;
    }
  });
}

export function resumeTask(options = {}) {
  const current = readTask({ stateRoot: options.stateRoot, taskId: options.taskId });
  const task = current.task;
  if (!['saved','blocked','needs_rework'].includes(task.status)) throw new Error(`任务当前不能恢复: ${task.status}`);
  const changeSet = computeChangeSet(task.baseline);
  const fresh = handoffIsFresh(task.handoff, task) && task.handoff.changeFingerprint === (changeSet.fingerprint ?? null);
  return updateTask({
    stateRoot: options.stateRoot,
    taskId: task.taskId,
    expectedRevision: task.stateRevision,
    transitionTo: fresh ? 'implementing' : 'verifying',
    event: 'resume',
    mutate(next) {
      next.changeSet = changeSet;
      next.handoff = null;
      if (!fresh) next.blockers = [...new Set([...(next.blockers ?? []), 'Handoff 或 ChangeSet 已变化，必须重新验证'])];
      return next;
    }
  });
}

export function recordHandoff(options = {}) {
  const current = readTask({ stateRoot: options.stateRoot, taskId: options.taskId });
  return updateTask({
    stateRoot: options.stateRoot,
    taskId: current.task.taskId,
    expectedRevision: current.task.stateRevision,
    transitionTo: current.task.status,
    event: 'handoff',
    mutate(next) {
      next.handoff = createHandoff(next, { stateRevision: current.task.stateRevision + 1, next: options.next ?? next.status });
      return next;
    }
  });
}

export function cancelTask(options = {}) {
  const current = readTask({ stateRoot: options.stateRoot, taskId: options.taskId });
  return updateTask({
    stateRoot: options.stateRoot,
    taskId: current.task.taskId,
    expectedRevision: current.task.stateRevision,
    transitionTo: 'cancelled',
    event: 'user-cancel',
    mutate(next) {
      next.cancelReason = options.note ?? '用户取消';
      return next;
    }
  });
}

export { readTask, findTask, listTasks };
