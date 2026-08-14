import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildContext } from './context-builder.mjs';
import {
  captureBaseline,
  computeChangeSet,
  normalizeScope,
  assertChangeSetWithinScope,
  userChangesRemainIsolated,
  normalizeIntegrationTarget,
  integrationRequiredForBaseline,
  assertIntegrationTargetExists,
  verifyIntegrationCandidate,
  createPendingIntegrationRef,
  verifyCommitIntegrated,
  deletePendingIntegrationRef
} from './git-state.mjs';
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
    ? { id: `A${index + 1}`, description: item.trim(), requiredCovers: defaultAcceptanceCovers(classification), requiredCoversInferred: true, status: 'open' }
    : { id: item.id ?? `A${index + 1}`, description: String(item.description ?? item.statement ?? ''), requiredCovers: item.requiredCovers ?? defaultAcceptanceCovers(classification), requiredCoversInferred: item.requiredCovers === undefined, status: 'open' });
}

function acceptanceForClassification(acceptance, classification) {
  const inferred = defaultAcceptanceCovers(classification);
  return (acceptance ?? []).map((item) => item.requiredCoversInferred === true
    ? { ...item, requiredCovers: inferred }
    : item);
}

function loadJsonFile(file) {
  if (!file) return [];
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  return Array.isArray(value) ? value : [value];
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function stableFailureFingerprint(changeFingerprint, planFingerprint, inputCycle) {
  return hash({ changeFingerprint, planFingerprint, inputCycle });
}

function firstFailureDiagnostic(execution, limit = 5000) {
  const failure = execution?.results?.find((item) => item.status !== 0 || item.error);
  if (!failure) return null;
  const parts = [];
  if (failure.stderr?.text) parts.push(`stderr:\n${failure.stderr.text}`);
  if (failure.stdout?.text) parts.push(`stdout:\n${failure.stdout.text}`);
  const completeOutput = parts.join('\n\n');
  return {
    name: failure.name,
    command: failure.command,
    args: failure.args ?? [],
    exitCode: failure.status ?? null,
    error: failure.error ?? null,
    output: completeOutput.slice(-limit),
    truncated: completeOutput.length > limit || failure.stderr?.truncated === true || failure.stdout?.truncated === true
  };
}

function existingChangesBlocker(paths) {
  const joined = paths.join(', ');
  return `用户已有改动被触及: ${joined}；若用户明确授权继续修改，请取消本任务后重新准备并传入 --allow-existing-change "${joined}"`;
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

function evidenceFromCheck(task, changeSet, inputCycle, check, acceptance = task.acceptance) {
  return createEvidence({
    kind: 'tool',
    taskId: task.taskId,
    changeFingerprint: changeSet.fingerprint,
    inputCycle,
    acceptanceIds: acceptanceIdsForCheck(check, acceptance),
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
    skills: options.skills ?? [],
    workstation: options.workstation ?? null,
  });
  const gitRoot = built.context.gitRoot;
  if (!gitRoot) throw new Error('写任务必须位于可确认的 Git 工作树');
  addIntentSpecificationHints(built, gitRoot, intent);
  const scope = normalizeScope(built.executionTarget.targetPath, options.scope ?? '.', gitRoot);
  const baseline = captureBaseline(gitRoot);
  const integrationRequired = integrationRequiredForBaseline(baseline, options.integrationTarget);
  if (integrationRequired && !options.integrationTarget) {
    throw new Error('linked 或 detached worktree 的写任务必须通过 --integration-target 声明目标分支');
  }
  const integration = integrationRequired
    ? { required:true, target:assertIntegrationTargetExists(gitRoot, normalizeIntegrationTarget(options.integrationTarget)) }
    : null;
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
    integration,
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
  if (!isolation.ok) {
    return updateTask({
      stateRoot: options.stateRoot,
      taskId: task.taskId,
      expectedRevision: task.stateRevision,
      transitionTo: 'blocked',
      event: 'delivery',
      mutate(next) {
        next.changeSet = before;
        next.verification = { ...next.verification, stopReason: 'isolation-failed' };
        next.deliveryDecision = { decision: 'blocked', reasons: ['user-changes'] };
        next.blockers = [...new Set([...(next.blockers ?? []), existingChangesBlocker(isolation.overwritten)])];
        return next;
      }
    });
  }
  const classification = reclassifyFromChangeSet(task.classification, before, { forcedMode: options.forceMode, forceReason: options.forceReason });
  const acceptance = acceptanceForClassification(task.acceptance, classification);
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
  let requiredCovers = determineEvidenceRequirements({ classification, changeSet, acceptance, observableBrowserBehavior: options.observableBrowserBehavior === true });
  let summary = evidenceSummary({
    acceptance,
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
      acceptance,
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
      budget: task.verification.budget,
      inputCycle
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
      evidence.push(...checkExecution.results.filter((item) => item.status === 0 && !item.error).map((item) => evidenceFromCheck(task, changeSet, inputCycle, item, acceptance)));
      if (!checkExecution.ok) {
        lastFailure = failureFingerprint;
        if (options.diagnosticRetry === true) diagnosticRetryUsed = true;
      } else lastFailure = null;
    }
  }

  requiredCovers = determineEvidenceRequirements({ classification, changeSet, acceptance, observableBrowserBehavior: options.observableBrowserBehavior === true });
  summary = evidenceSummary({
    acceptance,
    evidence,
    requiredCovers,
    context: { taskId: task.taskId, changeFingerprint: changeSet.fingerprint, inputCycle, gitRoot: changeSet.gitRoot }
  });

  const specState = buildSpecState(task, changeSet, options);
  const stableSpecState = stableSpecReviewState(specState);
  const reviewRequested = Boolean(task.authorization.explicitReviewRequirement || reviews.length || task.reviewPackage);
  let reviewPackage = null;
  if (reviewRequested) {
    const refs = qualityReviewRefs(task);
    const reviewInput = {
      taskId: task.taskId,
      changeFingerprint: changeSet.fingerprint,
      goal: task.goal,
      acceptance,
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
    reviewPackage = task.reviewPackage?.basisFingerprint === candidatePackage.basisFingerprint
      ? task.reviewPackage
      : buildReviewPackage(reviewInput);
  }
  const validReviews = reviewPackage
    ? reviews.filter((record) => validateReviewRecord(record, reviewContext(task, changeSet, reviewPackage)).valid)
    : [];
  const reviewSatisfied = reviewRequirementSatisfied(
    task.authorization.explicitReviewRequirement,
    validReviews,
    reviewPackage ? reviewContext(task, changeSet, reviewPackage) : {}
  );
  const blockingReview = reviewHasBlockingFindings(validReviews);
  const integrationCandidate = verifyIntegrationCandidate(task, changeSet);

  let decision;
  if (checkExecution?.stopReason === 'budget') decision = { decision: 'saved', reasons: ['budget'] };
  else if (checkExecution?.stopReason === 'check-mutated-input') decision = { decision: 'verifying', reasons: ['check-mutated-input'] };
  else if (checkExecution && !checkExecution.ok) decision = { decision: 'needs_rework', reasons: [checkExecution.stopReason ?? checkExecution.status] };
  else if (specState.specConsistency && !specState.specConsistency.ok) decision = { decision: 'needs_rework', reasons: ['spec-consistency', ...specState.specConsistency.blockingIssues.map((item) => item.id)] };
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
      handoffReady: true,
      integrationRequired: task.integration?.required === true,
      integrationReady: integrationCandidate.ok,
      integrationReasons: integrationCandidate.reasons
    });
  }
  const status = decision.decision;
  const firstFailure = firstFailureDiagnostic(checkExecution);
  const pendingRef = status === 'ready_to_integrate'
    ? createPendingIntegrationRef(changeSet.gitRoot, task.taskId, integrationCandidate.resultCommit)
    : task.integration?.pendingRef ?? null;

  return updateTask({
    stateRoot: options.stateRoot,
    taskId: task.taskId,
    expectedRevision: task.stateRevision,
    transitionTo: status,
    event: 'delivery',
    mutate(next) {
      next.classification = classification;
      next.acceptance = acceptance;
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
        firstFailure,
        stopReason: checkExecution?.stopReason ?? (status === 'waiting_acceptance' ? 'evidence-sufficient' : null),
        lastInputChange: inputChanged ? { type: options.inputChange, reason: options.inputChangeReason } : null
      };
      next.deliveryDecision = decision;
      if (next.integration?.required) {
        next.integration = {
          ...next.integration,
          status: status === 'ready_to_integrate' ? 'ready' : next.integration.status,
          resultCommit: integrationCandidate.ok ? integrationCandidate.resultCommit : null,
          pendingRef
        };
      }
      next.blockers = isolation.ok ? next.blockers : [...new Set([...(next.blockers ?? []), existingChangesBlocker(isolation.overwritten)])];
      if (next.classification.continuity === 'handoff-required' || status === 'saved') {
        next.handoff = createHandoff({ ...next, status }, { stateRevision: task.stateRevision + 1, next: status });
      }
      return next;
    }
  });
}

function assertIntegratedTaskFresh(task) {
  if (!task.integration?.required || task.integration.status !== 'integrated') return null;
  const result = verifyCommitIntegrated({
    gitRoot: task.integration.targetGitRoot,
    expectedCommonDir: task.integration.gitCommonDir,
    target: task.integration.target,
    resultCommit: task.integration.targetCommit
  });
  if (!result.ok) throw new Error(`集成门禁已失效: ${result.reason}`);
  return result;
}

export function confirmIntegration(options = {}) {
  const current = readTask({ stateRoot: options.stateRoot, taskId: options.taskId });
  const task = current.task;
  if (task.status !== 'ready_to_integrate') throw new Error(`任务当前不能确认集成: ${task.status}`);
  if (!task.integration?.resultCommit) throw new Error('任务缺少待集成结果提交');
  const target = normalizeIntegrationTarget(options.target ?? task.integration.target);
  if (target !== task.integration.target) throw new Error(`集成目标不匹配: 任务要求 ${task.integration.target}`);
  const targetGitRoot = path.resolve(options.cwd ?? process.cwd());
  const result = verifyCommitIntegrated({
    gitRoot: targetGitRoot,
    expectedCommonDir: task.integration.gitCommonDir,
    target,
    resultCommit: task.integration.resultCommit,
    baseCommit: task.integration.baseCommit
  });
  if (!result.ok) {
    const hint = result.reason === 'result-not-reachable'
      ? `；请先将 ${task.integration.resultCommit} cherry-pick 或 merge 到 ${target}`
      : '';
    throw new Error(`尚未确认集成: ${result.reason}${hint}`);
  }
  deletePendingIntegrationRef(targetGitRoot, task.integration.pendingRef, task.integration.resultCommit);
  return updateTask({
    stateRoot: options.stateRoot,
    taskId: task.taskId,
    expectedRevision: task.stateRevision,
    transitionTo: 'waiting_acceptance',
    event: 'integration',
    mutate(next) {
      next.integration = {
        ...next.integration,
        status:'integrated',
        targetGitRoot,
        targetCommit:result.targetCommit,
        method:result.method,
        integratedAt:new Date().toISOString()
      };
      next.deliveryDecision = { decision:'waiting_acceptance', reasons:[] };
      next.verification = { ...next.verification, stopReason:'evidence-sufficient' };
      if (next.classification.continuity === 'handoff-required') {
        next.handoff = createHandoff({ ...next, status:'waiting_acceptance' }, { stateRevision:task.stateRevision + 1, next:'waiting_acceptance' });
      }
      return next;
    }
  });
}

function revalidateForAcceptance(task) {
  const integrated = assertIntegratedTaskFresh(task);
  const changeSet = integrated ? task.changeSet : computeChangeSet(task.baseline);
  if (!integrated && changeSet.fingerprint !== task.changeSet?.fingerprint) throw new Error('交付后的目标文件已经变化，必须重新验证和交付');
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
  const specState = integrated
    ? { specTraceability:task.specTraceability, specConsistency:task.specConsistency }
    : revalidateSpecState(task, changeSet);
  const traceability = specState.specTraceability;
  const specConsistency = specState.specConsistency;
  if (specConsistency && !specConsistency.ok) throw new Error(`验收前规格一致性门禁已失效: ${specConsistency.blockingIssues.map((item) => item.id).join(', ')}`);
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
