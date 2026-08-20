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
import { planChecks, executeCheckPlan, loadChecks, loadTaskChecks, acceptanceIdsForCheck, createCheckManifest, checksFromManifest } from './check-planner.mjs';
import { createBudget, extendBudget } from './verification-budget.mjs';
import {
  loadAlignmentFile,
  normalizeUserText,
  validateAlignmentForPreparation,
  validateAlignmentForRealignment,
  evaluateFinalAlignment,
  validateAlignmentFingerprint,
  buildAlignedGoal,
  synthesizeQuickAlignment,
  recordAlignmentEvent,
} from './alignment.mjs';
import {
  isStrictPreservation,
  preservationModeLevel,
  buildReferenceInventory,
  referenceBehaviorAcceptanceItems,
  preservationCoverageSummary,
  validateReferenceAttribution,
} from './behavior-preservation.mjs';
import { loadChangeRationale, validateChangeRationale, changeRationaleSummary } from './change-rationale.mjs';
import { buildReviewPackage, validateReviewRecord, reviewRequirementSatisfied, reviewHasBlockingFindings } from './review.mjs';
import { createTask, readTask, findTask, updateTask, listTasks } from './state-manager.mjs';
import { createHandoff, handoffIsFresh } from './handoff.mjs';
import { createSpecImpact } from './spec-impact.mjs';
import { addIntentSpecificationHints, buildSpecState, revalidateSpecState, stableSpecReviewState } from './spec-service.mjs';
import { normalizeReturnReasonCategory } from './outcome-metrics.mjs';

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
    : {
      id: item.id ?? `A${index + 1}`,
      description: String(item.description ?? item.statement ?? ''),
      requiredCovers: item.requiredCovers ?? defaultAcceptanceCovers(classification),
      requiredCoversInferred: item.requiredCovers === undefined,
      ...(item.source !== undefined ? { source: String(item.source) } : {}),
      ...(item.referenceBehaviorId !== undefined ? { referenceBehaviorId: String(item.referenceBehaviorId) } : {}),
      status: 'open',
    });
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

function withoutDerivedBlockers(blockers = []) {
  return blockers.filter((item) => !String(item).startsWith('用户已有改动被触及:')
    && item !== 'Handoff 或 ChangeSet 已变化，必须重新验证');
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
      command: check.command, args: check.args, cwd: check.cwd, sideEffect: check.sideEffect,
      testFiles: check.testFiles ?? []
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
  const providedAlignment = loadAlignmentFile(options.alignmentFile);
  if (providedAlignment && normalizeUserText(providedAlignment.originalRequest) !== normalizeUserText(intent)) {
    throw new Error('alignment-original-request-mismatch: Alignment originalRequest 必须与 --intent 当前用户请求原文一致');
  }
  const classificationText = providedAlignment
    ? [
      providedAlignment.originalRequest,
      providedAlignment.goal,
      ...providedAlignment.expectedOutcomes,
      ...providedAlignment.confirmedDecisions,
      ...providedAlignment.acceptance,
    ].join(' ')
    : intent;
  const initial = classifyTask({
    intent: classificationText,
    acceptance: providedAlignment ? providedAlignment.acceptance.join(' ') : (options.acceptance ?? []).toString(),
    tracked: options.tracked !== false,
    handoffRequired: options.handoffRequired === true
  });
  if (providedAlignment) validateAlignmentForPreparation({ alignment: providedAlignment, classification: initial });
  const strictPreservation = isStrictPreservation(providedAlignment?.preservation)
    || initial.preservationMode === 'preserve-all-observable'
    || initial.preservationMode === 'reference-equivalent';
  if (strictPreservation && !providedAlignment) {
    throw new Error('behavior-preservation-alignment-required: 行为保持型任务必须提供 --goal-card-file');
  }
  if (strictPreservation && providedAlignment && !providedAlignment.preservation) {
    throw new Error('behavior-preservation-alignment-required: 行为保持型任务的对齐文件必须包含 preservation 结构');
  }
  if (providedAlignment?.preservation) {
    const providedLevel = preservationModeLevel(providedAlignment.preservation.mode);
    const initialLevel = preservationModeLevel(initial.preservationMode);
    if (providedLevel < initialLevel) {
      throw new Error(`preservation-mode-downgrade: Alignment 声明 ${providedAlignment.preservation.mode} 低于初始识别 ${initial.preservationMode}`);
    }
  }
  const referenceItems = referenceBehaviorAcceptanceItems(providedAlignment?.preservation);
  const acceptance = providedAlignment
    ? acceptanceItems([
      ...providedAlignment.acceptance.map((description) => ({ description, source: 'requested-outcome' })),
      ...providedAlignment.protectedBehaviors.map((description) => ({ description, source: 'protected-behavior' })),
      ...referenceItems,
    ], initial)
    : acceptanceItems(options.acceptance, initial);
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
  if (providedAlignment?.preservation?.referenceRoots?.length) {
    const inventory = buildReferenceInventory({
      gitRoot,
      baselineHead: baseline.head,
      referenceRoots: providedAlignment.preservation.referenceRoots,
      behaviors: providedAlignment.preservation.behaviors,
      excludedFiles: providedAlignment.preservation.excludedFiles
    });
    if (inventory.unmapped.length) {
      throw new Error(`reference-files-unmapped: 以下 Reference 文件未归入 Behavior 或 excludedFiles: ${inventory.unmapped.join(', ')}`);
    }
    if (inventory.foreign.length) {
      throw new Error(`reference-files-foreign: 以下 sourceFiles/excludedFiles 不属于 Reference 文件清单: ${inventory.foreign.join(', ')}`);
    }
    providedAlignment.preservation = {
      ...providedAlignment.preservation,
      referenceCommit: inventory.referenceCommit,
      referenceFiles: inventory.referenceFiles
    };
  }
  const integrationRequired = integrationRequiredForBaseline(baseline, options.integrationTarget);
  if (integrationRequired && !options.integrationTarget) {
    throw new Error('linked 或 detached worktree 的写任务必须通过 --integration-target 声明目标分支');
  }
  const integration = integrationRequired
    ? { required:true, target:assertIntegrationTargetExists(gitRoot, normalizeIntegrationTarget(options.integrationTarget)) }
    : null;
  const budget = createBudget({ mode: initial.controlMode, limitMs: options.budgetMs });
  const goal = providedAlignment
    ? buildAlignedGoal(providedAlignment, acceptance, scope)
    : initial.controlMode === 'quick'
      ? buildAlignedGoal(synthesizeQuickAlignment({ intent, acceptance: options.acceptance, nonGoals: options.nonGoals }), acceptance, scope)
      : { summary: intent, nonGoals: options.nonGoals ?? [], assumptions: [], openQuestions: [] };
  return createTask({
    stateRoot: options.stateRoot,
    goal,
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
      systemEvidenceHashes: [],
      preservationCoverage: null,
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
  const deliveryStartedAt = Date.now();
  if (options.inputChange || options.inputChangeReason) {
    throw new Error('禁止手工声明验证输入变化；只有真实 ChangeSet 或正式重新对齐可以开启新的验证周期');
  }
  const current = readTask({ stateRoot: options.stateRoot, taskId: options.taskId });
  const task = current.task;
  const scope = task.authorization.scope[0];
  const before = computeChangeSet(task.baseline);
  const scopeValidation = assertChangeSetWithinScope(before, scope);
  const isolation = userChangesRemainIsolated(task.baseline, before, task.authorization.allowedExistingChanges ?? []);
  const persistentBlockers = withoutDerivedBlockers(task.blockers ?? []);
  if (!isolation.ok) {
    return updateTask({
      stateRoot: options.stateRoot,
      taskId: task.taskId,
      expectedRevision: task.stateRevision,
      transitionTo: 'blocked',
      event: 'delivery',
      metricDurationMs: Date.now() - deliveryStartedAt,
      mutate(next) {
        next.changeSet = before;
        next.verification = {
          ...next.verification,
          stopReason: 'isolation-failed',
          acceptanceGaps: (task.acceptance ?? []).map(item => ({
            acceptanceId: item.id,
            description: item.description,
            missingCovers: item.requiredCovers ?? [],
          })),
        };
        next.deliveryDecision = { decision: 'blocked', reasons: ['user-changes'] };
        next.blockers = [...new Set([...persistentBlockers, existingChangesBlocker(isolation.overwritten)])];
        return next;
      }
    });
  }
  const classification = reclassifyFromChangeSet(task.classification, before, { forcedMode: options.forceMode, forceReason: options.forceReason });
  const finalAlignment = evaluateFinalAlignment({ goal: task.goal, classification });
  const alignmentEscalation = finalAlignment.required && finalAlignment.reason === 'alignment-risk-escalation';
  const alignmentMissing = finalAlignment.required && finalAlignment.reason === 'alignment-required';
  const fingerprintCheck = validateAlignmentFingerprint({ goal: task.goal, acceptance: task.acceptance, scope });
  const acceptance = acceptanceForClassification(task.acceptance, classification);
  const inputCycle = Number(task.verification?.inputCycle ?? 0);

  const scopeDiffEvidence = scopeAndDiffEvidence(task, before, inputCycle);
  const systemCreatedHashes = new Set([scopeDiffEvidence.payloadHash]);
  const previousSystemHashes = new Set(task.verification?.systemEvidenceHashes ?? []);
  let evidence = [
    ...(task.evidence ?? []).filter((item) => item.subject?.changeFingerprint === before.fingerprint && Number(item.subject?.inputCycle ?? -1) === inputCycle),
    ...loadJsonFile(options.evidenceFile),
    scopeDiffEvidence
  ];
  const computeSystemEvidenceHashes = () => [...new Set(
    evidence
      .filter((item) => systemCreatedHashes.has(item.payloadHash) || previousSystemHashes.has(item.payloadHash))
      .map((item) => item.payloadHash)
  )];
  let systemEvidenceHashes = computeSystemEvidenceHashes();
  const reviews = [...(task.reviews ?? []), ...loadJsonFile(options.reviewFile)];
  let changeSet = before;
  let requiredCovers = determineEvidenceRequirements({ classification, changeSet, acceptance, observableBrowserBehavior: options.observableBrowserBehavior === true });
  let summary = evidenceSummary({
    acceptance,
    evidence,
    requiredCovers,
    systemEvidenceHashes,
    context: { taskId: task.taskId, changeFingerprint: changeSet.fingerprint, inputCycle, gitRoot: changeSet.gitRoot }
  });
  let checkExecution = null;
  let lastFailure = task.verification?.lastFailureFingerprint ?? null;
  let diagnosticRetryUsed = task.verification?.diagnosticRetryUsed === true;
  let checkManifest = task.verification?.checkManifest ?? null;

  if (finalAlignment.satisfied && fingerprintCheck.ok && options.autoChecks !== false && (summary.missingCovers.length > 0 || summary.missingAcceptance.length > 0)) {
    const projectChecks = loadChecks(changeSet.gitRoot, { templateRoot: task.context?.context?.template?.path ?? null });
    const taskChecks = options.taskCheckFile
      ? loadTaskChecks(options.taskCheckFile, {
        task,
        acceptance,
        gitRoot: changeSet.gitRoot,
        projectCheckNames: new Set(projectChecks.map((check) => check.name))
      })
      : [];
    const replayChecks = !options.taskCheckFile && checkManifest
      ? checksFromManifest(checkManifest, { gitRoot: changeSet.gitRoot })
      : [];
    const checks = replayChecks.length ? replayChecks : [...projectChecks, ...taskChecks];
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
    checkManifest = createCheckManifest(plan, { gitRoot: changeSet.gitRoot });
    const rerun = canRerunVerification({
      previousFailure: lastFailure === failureFingerprint,
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
      systemCreatedHashes.clear();
    } else if (options.diagnosticRetry === true && checkExecution.status === 'passed') {
      checkExecution = { ...checkExecution, ok: false, status: 'unavailable', stopReason: 'diagnostic-only', failure: '诊断性重试通过不能直接成为稳定 Evidence' };
      diagnosticRetryUsed = true;
      lastFailure = failureFingerprint;
    } else {
      const checkEvidence = checkExecution.results
        .filter((item) => item.status === 0 && !item.error)
        .map((item) => evidenceFromCheck(task, changeSet, inputCycle, item, acceptance));
      for (const item of checkEvidence) systemCreatedHashes.add(item.payloadHash);
      evidence.push(...checkEvidence);
      if (!checkExecution.ok) {
        lastFailure = checkExecution.stopReason === 'budget' ? null : failureFingerprint;
        if (options.diagnosticRetry === true) diagnosticRetryUsed = true;
      } else lastFailure = null;
    }
  }
  systemEvidenceHashes = computeSystemEvidenceHashes();

  requiredCovers = determineEvidenceRequirements({ classification, changeSet, acceptance, observableBrowserBehavior: options.observableBrowserBehavior === true });
  summary = evidenceSummary({
    acceptance,
    evidence,
    requiredCovers,
    systemEvidenceHashes,
    context: { taskId: task.taskId, changeFingerprint: changeSet.fingerprint, inputCycle, gitRoot: changeSet.gitRoot }
  });
  const rationale = loadChangeRationale(options.rationaleFile);
  const rationaleValidation = validateChangeRationale({ rationale, task, changeSet });
  const rationaleRequired =
    classification.controlMode === 'controlled'
    || classification.structureImpact === 'structural'
    || isStrictPreservation(task.goal?.preservation);
  const rationaleGate = !rationaleRequired || rationaleValidation.ok;
  const preservationCoverage = preservationCoverageSummary({
    acceptance,
    acceptanceCoverage: summary.acceptanceCoverage
  });
  const acceptanceGaps = acceptance
    .filter(item => !summary.acceptanceCoverage[item.id]?.satisfied)
    .map(item => ({
      acceptanceId: item.id,
      description: item.description,
      missingCovers: (item.requiredCovers ?? [])
        .filter(cover => !(summary.acceptanceCoverage[item.id]?.covers ?? []).includes(cover)),
    }));

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
      alignment: task.goal?.alignment
        ? {
          mode: task.goal.alignment.mode,
          revision: task.goal.alignment.revision,
          baselineFingerprint: task.goal.alignment.baselineFingerprint,
          decisionNote: task.goal.alignment.decisionNote,
          delegatedTopics: task.goal.alignment.delegatedTopics ?? [],
          protectedBehaviors: task.goal.protectedBehaviors ?? [],
          confirmedDecisions: task.goal.confirmedDecisions ?? [],
          events: task.goal.alignment.events ?? [],
        }
        : null,
      changeRationale: rationale
        ? {
          provided: true,
          ok: rationaleValidation.ok,
          invalid: rationaleValidation.invalid,
          unmappedFiles: rationaleValidation.unmappedFiles,
          items: rationale.items,
        }
        : null,
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
      blockers: persistentBlockers,
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
  if (alignmentEscalation) {
    decision = { decision: 'needs_rework', reasons: ['alignment-risk-escalation'] };
  } else if (alignmentMissing) {
    decision = { decision: 'needs_rework', reasons: ['alignment-required'] };
  } else if (!fingerprintCheck.ok) {
    decision = { decision: 'needs_rework', reasons: ['alignment-fingerprint-mismatch'] };
  } else if (!rationaleGate) {
    if (classification.controlMode === 'controlled') {
      decision = { decision: 'needs_rework', reasons: ['change-rationale-unmapped'] };
    } else if (decision.decision === 'waiting_acceptance' || decision.decision === 'ready_to_integrate') {
      decision = { decision: 'verifying', reasons: ['change-rationale-required'] };
    } else {
      decision = { ...decision, reasons: [...decision.reasons, 'change-rationale-required'] };
    }
  }
  const alignmentBlockers = [];
  if (alignmentEscalation) {
    alignmentBlockers.push('实际 ChangeSet 风险高于 direct 准备判断，必须重新对齐或获得用户明确委托');
  } else if (alignmentMissing) {
    alignmentBlockers.push('最终分类为 Controlled/Structural 但缺少 confirmed/delegated Alignment，必须先重新对齐');
  } else if (!fingerprintCheck.ok) {
    alignmentBlockers.push('Alignment 结构指纹失效，Behaviors / Reference / allowedDifferences 可能已被修改，必须重新对齐');
  } else if (!rationaleGate && classification.controlMode === 'controlled') {
    alignmentBlockers.push(`Change Rationale 未映射或无效: ${[
      ...rationaleValidation.invalid,
      ...rationaleValidation.unmappedFiles.map((file) => `未映射 ${file}`),
    ].join('; ')}`);
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
    metricDurationMs: Date.now() - deliveryStartedAt,
    mutate(next) {
      next.classification = classification;
      next.acceptance = acceptance;
      next.changeSet = changeSet;
      next.evidence = evidence;
      if (reviewRequested) {
        next.reviews = validReviews;
        next.reviewPackage = reviewPackage;
      } else {
        delete next.reviews;
        delete next.reviewPackage;
      }
      next.residualRisks = options.residualRisks ?? next.residualRisks;
      if (rationale || rationaleRequired) {
        next.changeRationale = rationale
          ? changeRationaleSummary(rationaleValidation)
          : { provided: false, ok: false, invalid: ['missing-rationale'], unmappedFiles: rationaleValidation.unmappedFiles };
      }
      if (alignmentEscalation) {
        next.goal = recordAlignmentEvent(next.goal, {
          type: 'alignment-risk-escalation',
          summary: '真实 ChangeSet 风险高于 direct 准备判断',
          impact: '需要重新对齐或获得用户明确委托',
          action: 'needs_rework',
        });
      }
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
        acceptanceGaps,
        systemEvidenceHashes,
        untrustedTechnicalEvidence: summary.untrustedTechnicalEvidence ?? [],
        preservationCoverage,
        firstFailure,
        stopReason: checkExecution?.stopReason
          ?? (alignmentEscalation ? 'alignment-risk-escalation'
            : alignmentMissing ? 'alignment-required'
            : !fingerprintCheck.ok ? 'alignment-fingerprint-mismatch'
            : !rationaleGate && classification.controlMode === 'controlled' ? 'change-rationale-unmapped'
            : !rationaleGate ? 'change-rationale-required'
            : status === 'waiting_acceptance' ? 'evidence-sufficient' : null),
        checkManifest,
        lastInputChange: null
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
      next.blockers = [...new Set([...persistentBlockers, ...alignmentBlockers])];
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
    resultCommit: task.integration.resultCommit,
    baseCommit: task.integration.baseCommit,
  });
  if (!result.ok) throw new Error(`集成门禁已失效: ${result.reason}`);
  if (result.targetCommit !== task.integration.targetCommit) {
    throw new Error(`集成目标 HEAD 已变化: 已验证 ${task.integration.targetCommit}，当前 ${result.targetCommit}；请运行“task.mjs 重验集成 --task-id ${task.taskId} --cwd <目标工作区>”`);
  }
  return result;
}

function compactIntegrationEvidence(task, targetHead, plan, execution) {
  return {
    schemaVersion:1,
    targetHead,
    planFingerprint:plan.fingerprint,
    requiredCovers:task.verification?.requiredCovers ?? [],
    checks:(execution.results ?? []).map((item) => ({
      name:item.name,
      covers:item.covers ?? [],
      status:item.status,
      durationMs:item.durationMs,
      resultFingerprint:item.resultFingerprint,
    })),
    createdAt:new Date().toISOString(),
  };
}

function integrationCheckPlan(task, gitRoot) {
  if (task.verification?.checkManifest) {
    return {
      schemaVersion: 4,
      profile: task.classification.controlMode,
      checks: checksFromManifest(task.verification.checkManifest, { gitRoot }),
      missingCovers: [],
      missingAcceptance: [],
      fingerprint: task.verification.checkManifest.planFingerprint,
    };
  }
  const checks = loadChecks(gitRoot, { templateRoot:task.context?.context?.template?.path ?? null });
  return planChecks({
    cwd:gitRoot,
    profile:task.classification.controlMode,
    requiredCovers:task.verification?.requiredCovers ?? [],
    existingCovers:['scope','diff'],
    acceptance:task.acceptance,
    acceptanceCoverage:{},
    checks,
  });
}

export function realignTask(options = {}) {
  const current = findTask({ stateRoot: options.stateRoot, taskId: options.taskId });
  const task = current.task;
  const reason = String(options.reason ?? '').trim();
  if (!reason) throw new Error('重新对齐必须说明原因');
  const nextAlignment = loadAlignmentFile(options.alignmentFile);
  if (!nextAlignment) throw new Error('重新对齐必须提供 --goal-card-file');
  if (!nextAlignment.originalRequest) {
    nextAlignment.originalRequest = task.goal?.originalRequest ?? task.goal?.summary ?? '';
  }
  validateAlignmentForRealignment({ currentTask: task, nextAlignment });
  const currentPreservation = task.goal?.preservation;
  if (currentPreservation) {
    if (!nextAlignment.preservation) {
      nextAlignment.preservation = structuredClone(currentPreservation);
    } else {
      const nextRoots = nextAlignment.preservation.referenceRoots ?? [];
      if (nextRoots.length && JSON.stringify(nextRoots) !== JSON.stringify(currentPreservation.referenceRoots ?? [])) {
        throw new Error('realignment-reference-immutable: 重新对齐不能改变 referenceRoots');
      }
      nextAlignment.preservation = {
        ...nextAlignment.preservation,
        referenceRoots: currentPreservation.referenceRoots ?? [],
        referenceCommit: currentPreservation.referenceCommit ?? null,
        referenceFiles: currentPreservation.referenceFiles ?? []
      };
    }
    const attribution = validateReferenceAttribution({
      referenceFiles: nextAlignment.preservation.referenceFiles,
      behaviors: nextAlignment.preservation.behaviors,
      excludedFiles: nextAlignment.preservation.excludedFiles
    });
    const currentLevel = preservationModeLevel(currentPreservation.mode);
    const nextLevel = preservationModeLevel(nextAlignment.preservation.mode);
    if (nextLevel < currentLevel) {
      throw new Error(`preservation-mode-downgrade: 重新对齐声明 ${nextAlignment.preservation.mode} 低于当前 ${currentPreservation.mode}`);
    }
    if (attribution.unmapped.length) {
      throw new Error(`realignment-reference-files-unmapped: ${attribution.unmapped.join(', ')}`);
    }
    if (attribution.foreign.length) {
      throw new Error(`realignment-reference-files-foreign: ${attribution.foreign.join(', ')}`);
    }
  }
  const scope = task.authorization.scope[0];
  const acceptance = acceptanceItems([
    ...nextAlignment.acceptance.map((description) => ({ description, source: 'requested-outcome' })),
    ...nextAlignment.protectedBehaviors.map((description) => ({ description, source: 'protected-behavior' })),
    ...referenceBehaviorAcceptanceItems(nextAlignment.preservation),
  ], task.classification);
  const base = buildAlignedGoal(nextAlignment, acceptance, scope);
  const nextGoal = {
    ...base,
    alignment: {
      ...base.alignment,
      revision: Number(task.goal?.alignment?.revision ?? 0) + 1,
      events: [
        ...(task.goal?.alignment?.events ?? []),
        {
          at: new Date().toISOString(),
          type: 'realignment',
          reason,
          oldBaselineFingerprint: task.goal?.alignment?.baselineFingerprint ?? null,
          newBaselineFingerprint: base.alignment.baselineFingerprint,
          action: 'realigned',
        },
      ],
    },
  };
  return updateTask({
    stateRoot: options.stateRoot,
    taskId: task.taskId,
    expectedRevision: task.stateRevision,
    transitionTo: 'implementing',
    event: 'realign',
    mutate(next) {
      next.goal = nextGoal;
      next.acceptance = acceptance;
      next.evidence = [];
      delete next.reviews;
      delete next.reviewPackage;
      next.handoff = null;
      next.changeRationale = null;
      next.changeSet = null;
      next.blockers = [];
      next.verification = {
        ...next.verification,
        inputCycle: Number(next.verification?.inputCycle ?? 0) + 1,
        requiredCovers: [],
        missingCovers: [],
        missingAcceptance: [],
        systemEvidenceHashes: [],
        untrustedTechnicalEvidence: [],
        preservationCoverage: null,
        firstFailure: null,
        lastFailureFingerprint: null,
        diagnosticRetryUsed: false,
        stopReason: null,
        checkManifest: null,
      };
      return next;
    },
  });
}

export function revalidateIntegration(options = {}) {
  const current = readTask({ stateRoot:options.stateRoot, taskId:options.taskId });
  const task = current.task;
  if (!task.integration?.required || task.integration.status !== 'integrated') throw new Error('只有已经确认集成的 Task 才能重验集成');
  if (!['waiting_acceptance','verifying'].includes(task.status)) throw new Error(`任务当前不能重验集成: ${task.status}`);
  const target = normalizeIntegrationTarget(options.target ?? task.integration.target);
  if (target !== task.integration.target) throw new Error(`集成目标不匹配: 任务要求 ${task.integration.target}`);
  const targetGitRoot = path.resolve(options.cwd ?? task.integration.targetGitRoot ?? process.cwd());
  const integrated = verifyCommitIntegrated({
    gitRoot:targetGitRoot,
    expectedCommonDir:task.integration.gitCommonDir,
    target,
    resultCommit:task.integration.resultCommit,
    baseCommit:task.integration.baseCommit,
  });
  if (!integrated.ok) throw new Error(`集成门禁已失效: ${integrated.reason}`);

  const before = captureBaseline(targetGitRoot);
  if (before.head !== integrated.targetCommit) throw new Error('目标工作区 HEAD 与集成目标分支不一致，拒绝生成重验 Evidence');
  if (before.files.length > 0) throw new Error('目标工作区存在未提交改动，拒绝生成绑定目标 HEAD 的重验 Evidence');

  const plan = integrationCheckPlan(task, targetGitRoot);
  if (plan.missingCovers.length || plan.missingAcceptance.length) {
    throw new Error(`集成重验缺少检查覆盖: ${[...plan.missingCovers, ...plan.missingAcceptance].join(', ')}`);
  }
  const execution = executeCheckPlan(plan, { cwd:targetGitRoot, budget:task.verification.budget });
  const after = captureBaseline(targetGitRoot);
  let stopReason = execution.ok
    ? null
    : execution.stopReason === 'budget'
      ? 'budget'
      : `integration-check-${execution.stopReason ?? execution.status ?? 'failed'}`;
  if (after.head !== before.head || after.fingerprint !== before.fingerprint) stopReason = 'integration-check-mutated-target';
  if (!execution.ok || stopReason) {
    return updateTask({
      stateRoot:options.stateRoot,
      taskId:task.taskId,
      expectedRevision:task.stateRevision,
      transitionTo:task.status,
      event:'integration-revalidation',
      mutate(next) {
        next.verification = {
          ...next.verification,
          budget:execution.budget,
          stopReason:stopReason ?? 'integration-check-failed',
          firstFailure:firstFailureDiagnostic(execution),
        };
        next.deliveryDecision = { decision:'verifying', reasons:[stopReason ?? 'integration-check-failed'] };
        return next;
      }
    });
  }

  const integrationEvidence = compactIntegrationEvidence(task, integrated.targetCommit, plan, execution);
  return updateTask({
    stateRoot:options.stateRoot,
    taskId:task.taskId,
    expectedRevision:task.stateRevision,
    transitionTo:'waiting_acceptance',
    event:'integration-revalidation',
    mutate(next) {
      next.integration = {
        ...next.integration,
        targetGitRoot,
        targetCommit:integrated.targetCommit,
        method:integrated.method,
        integrationEvidence,
        revalidatedAt:integrationEvidence.createdAt,
      };
      next.verification = { ...next.verification, budget:execution.budget, stopReason:'integration-evidence-sufficient', firstFailure:null };
      next.deliveryDecision = { decision:'waiting_acceptance', reasons:[] };
      if (next.classification.continuity === 'handoff-required') {
        next.handoff = createHandoff({ ...next, status:'waiting_acceptance' }, { stateRevision:task.stateRevision + 1, next:'waiting_acceptance' });
      }
      return next;
    }
  });
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
  const before = captureBaseline(targetGitRoot);
  if (before.head !== result.targetCommit) throw new Error('目标工作区 HEAD 与集成目标分支不一致，拒绝确认集成');
  if (before.files.length > 0) throw new Error('目标工作区存在未提交改动，拒绝确认集成');
  const plan = integrationCheckPlan(task, targetGitRoot);
  if (plan.missingCovers.length || plan.missingAcceptance.length) {
    throw new Error(`集成确认缺少可重放检查覆盖: ${[...plan.missingCovers, ...plan.missingAcceptance].join(', ')}`);
  }
  const execution = executeCheckPlan(plan, { cwd:targetGitRoot, budget:task.verification.budget });
  const after = captureBaseline(targetGitRoot);
  const mutated = after.head !== before.head || after.fingerprint !== before.fingerprint;
  if (!execution.ok || mutated) {
    const stopReason = mutated ? 'integration-check-mutated-target' : `integration-check-${execution.stopReason ?? execution.status ?? 'failed'}`;
    return updateTask({
      stateRoot: options.stateRoot,
      taskId: task.taskId,
      expectedRevision: task.stateRevision,
      transitionTo: 'verifying',
      event: 'integration',
      mutate(next) {
        next.integration = { ...next.integration, status:'revalidation_failed', targetGitRoot, targetCommit:result.targetCommit };
        next.verification = { ...next.verification, budget:execution.budget, stopReason, firstFailure:firstFailureDiagnostic(execution) };
        next.deliveryDecision = { decision:'verifying', reasons:[stopReason] };
        return next;
      }
    });
  }
  const integrationEvidence = compactIntegrationEvidence(task, result.targetCommit, plan, execution);
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
        integratedAt:new Date().toISOString(),
        integrationEvidence,
        revalidatedAt:integrationEvidence.createdAt,
      };
      next.deliveryDecision = { decision:'waiting_acceptance', reasons:[] };
      next.verification = { ...next.verification, budget:execution.budget, stopReason:'integration-evidence-sufficient', firstFailure:null };
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
  const finalAlignment = evaluateFinalAlignment({
    goal: task.goal,
    classification: task.classification
  });
  if (!finalAlignment.satisfied) {
    throw new Error(`验收前目标对齐门禁已失效: ${finalAlignment.reason}`);
  }
  const fingerprintCheck = validateAlignmentFingerprint({
    goal: task.goal,
    acceptance: task.acceptance,
    scope: task.authorization.scope[0]
  });
  if (!fingerprintCheck.ok) {
    throw new Error(`验收前目标结构门禁已失效: ${fingerprintCheck.reason}`);
  }
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
    systemEvidenceHashes: task.verification?.systemEvidenceHashes ?? [],
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
    blockers: withoutDerivedBlockers(task.blockers ?? []),
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
  if (task.status !== 'waiting_acceptance') throw new Error(`任务当前不能验收: ${task.status}`);
  if (decision === 'passed' && options.reasonCategory) throw new Error('退回原因分类只用于退回决定');
  if (decision === 'rejected') {
    const reasonCategory = normalizeReturnReasonCategory(options.reasonCategory);
    return updateTask({
      stateRoot: options.stateRoot,
      taskId: task.taskId,
      expectedRevision: task.stateRevision,
      transitionTo: 'needs_rework',
      event: 'user-reject',
      metricReasonCategory: reasonCategory,
      metricNote: options.note,
      mutate(next) {
        next.userAcceptance = { decision: 'rejected', note: options.note ?? null, decidedAt: new Date().toISOString() };
        return next;
      }
    });
  }
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
  if (task.status === 'saved' && task.verification?.stopReason === 'budget') {
    throw new Error('任务因验证预算耗尽而保存；必须使用“继续验证”并说明追加预算和原因');
  }
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
      next.blockers = withoutDerivedBlockers(next.blockers ?? []);
      if (!fresh) next.verification = { ...next.verification, stopReason:'handoff-stale' };
      return next;
    }
  });
}

export function continueVerification(options = {}) {
  const current = readTask({ stateRoot:options.stateRoot, taskId:options.taskId });
  const task = current.task;
  if (!['saved','waiting_acceptance','verifying'].includes(task.status) || task.verification?.stopReason !== 'budget') {
    throw new Error('只有因验证预算耗尽而暂停的 Task 才能继续验证');
  }
  const budget = extendBudget(task.verification.budget, {
    additionalMs:options.additionalBudgetMs,
    reason:options.reason,
  });
  const changeSet = computeChangeSet(task.baseline);
  return updateTask({
    stateRoot:options.stateRoot,
    taskId:task.taskId,
    expectedRevision:task.stateRevision,
    transitionTo:'verifying',
    event:'verification-continue',
    mutate(next) {
      next.changeSet = changeSet;
      next.handoff = null;
      next.blockers = withoutDerivedBlockers(next.blockers ?? []);
      next.verification = { ...next.verification, budget, stopReason:'budget-extended' };
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
