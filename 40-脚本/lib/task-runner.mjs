import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildContext } from './context-builder.mjs';
import {
  assertTaskWorktreeBaseline,
  captureBaseline,
  inspectWorktreeRouteState,
  computeChangeSet,
  semanticFingerprintForFiles,
  inspectPackageManifestChanges,
  normalizeScopes,
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
import { findGitRoot, normalizePath, SYSTEM_ROOT } from './registry.mjs';
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
import { createTask, readTask, findTask, updateTask, listTasks, inspectWorkspaceAvailability, withIntegrationLock } from './state-manager.mjs';
import { createHandoff, handoffIsFresh } from './handoff.mjs';
import { createSpecImpact } from './spec-impact.mjs';
import { buildSpecState, revalidateSpecState, stableSpecReviewState } from './spec-service.mjs';
import {
  beginConversationDelivery,
  FOLLOW_UP_KINDS,
  normalizeConversationOutcome,
  normalizeReturnReasonCategory,
  observeConversationFollowUp,
} from './outcome-metrics.mjs';
import {
  inspectTargetCheckout,
  prepareIntegrationCandidate,
  promoteIntegrationCandidate,
  removeIntegrationWorktree,
  cleanupTaskSource,
} from './integration-workflow.mjs';

function defaultAcceptanceCovers(classification) {
  const kinds = new Set(classification.artifactKinds ?? []);
  if (kinds.size === 1 && kinds.has('documentation')) return ['documentation'];
  if (kinds.has('operations')) return classification.controlMode === 'quick' ? ['documentation'] : ['target-environment'];
  return ['behavior'];
}

function nextConversationDelivery(previous) {
  return beginConversationDelivery(previous, {
    deliveryId: crypto.randomUUID(),
    deliveredAt: new Date().toISOString(),
  });
}

function optionalHostLabel(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function captureEvaluationContext(options = {}) {
  let systemBaseline = null;
  try { systemBaseline = captureBaseline(SYSTEM_ROOT); } catch {}
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(SYSTEM_ROOT, 'package.json'), 'utf8')).version ?? null;
  } catch {}
  return {
    schemaVersion: 1,
    system: {
      version,
      commit: systemBaseline?.head ?? null,
      dirty: systemBaseline ? (systemBaseline.files?.length ?? 0) > 0 : null,
    },
    model: optionalHostLabel(options.model),
    reasoningEffort: optionalHostLabel(options.reasoningEffort),
    executionEnvironment: optionalHostLabel(options.executionEnvironment),
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };
}

export function inferAcceptanceCovers(description, classification) {
  const text = String(description ?? '').trim();
  const documentation = /(?:文档|说明书|指南|README|AGENTS(?:\.md)?|CONTRACT\.md|规范文档|规格文档|入口规则)/iu.test(text);
  if (documentation) return ['documentation'];
  const covers = [];
  const browser = /(?:浏览器|页面|界面|\bUI\b|交互|按钮|表单|弹窗|菜单|布局|样式)/iu.test(text);
  if (browser) covers.push('behavior', 'browser');
  const migration = /(?:数据迁移|状态迁移|迁移数据|数据库迁移|持久化|回滚|rollback|备份恢复|兼容旧数据)/iu.test(text);
  if (migration) covers.push('behavior', 'data', 'rollback');
  const explicitNegativePath = /(?:未授权|无权限|拒绝|禁止|不允许|非法|无效|越界|超限|不存在|unauthori[sz]ed|forbidden|denied|reject(?:ed)?|invalid|not[ -]?found)/iu.test(text);
  const handledFailurePath = /(?:(?:异常|错误|失败).*(?:处理|提示|返回|回滚|终止|拒绝|不修改|保持)|(?:处理|提示|返回|回滚|终止|拒绝|不修改|保持).*(?:异常|错误|失败)|(?:error|failure).*(?:handle|message|return|rollback|stop|reject|preserve)|(?:handle|message|return|rollback|stop|reject|preserve).*(?:error|failure))/iu.test(text);
  if (explicitNegativePath || handledFailurePath) covers.push('behavior', 'negative-path');
  const targetEnvironment = /(?:部署|发布|目标环境|生产环境|运行环境|线上环境)/u.test(text);
  if (targetEnvironment) covers.push('target-environment');
  return covers.length ? [...new Set(covers)] : defaultAcceptanceCovers(classification);
}

function acceptanceItems(value, classification) {
  const arrayInput = Array.isArray(value);
  const values = arrayInput ? value : [value].filter(Boolean);
  const items = (arrayInput
    ? values
    : values.flatMap((item) => typeof item === 'string' ? String(item).split(/[;；\n]/u) : [item]))
    .filter(Boolean);
  const normalized = items.length ? items : ['完成用户目标并提供可信证据'];
  return normalized.map((item, index) => typeof item === 'string'
    ? { id: `A${index + 1}`, description: item.trim(), requiredCovers: inferAcceptanceCovers(item, classification), requiredCoversInferred: true, status: 'open' }
    : {
      id: item.id ?? `A${index + 1}`,
      description: String(item.description ?? item.statement ?? ''),
      requiredCovers: item.requiredCovers ?? inferAcceptanceCovers(item.description ?? item.statement, classification),
      requiredCoversInferred: item.requiredCovers === undefined,
      ...(item.source !== undefined ? { source: String(item.source) } : {}),
      ...(item.referenceBehaviorId !== undefined ? { referenceBehaviorId: String(item.referenceBehaviorId) } : {}),
      status: 'open',
    });
}

function acceptanceForClassification(acceptance, classification) {
  return (acceptance ?? []).map((item) => item.requiredCoversInferred === true
    ? { ...item, requiredCovers: inferAcceptanceCovers(item.description, classification) }
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

function withoutRecomputedDeliveryBlockers(blockers = []) {
  return withoutDerivedBlockers(blockers).filter((item) => !/^(?:实际 ChangeSet 风险高于|最终分类为 Controlled\/Structural|Alignment 结构指纹失效|Change Rationale 未映射或无效:)/u.test(String(item)));
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

function createCheckEvidence(task, changeSet, inputCycle, check, input = {}) {
  return createEvidence({
    kind: 'tool',
    taskId: task.taskId,
    changeFingerprint: changeSet.fingerprint,
    inputCycle,
    acceptanceIds: input.acceptanceIds ?? [],
    covers: input.covers ?? [],
    source: {
      type: 'command', actor: 'ai-system', session: null,
      command: check.command, args: check.args, cwd: check.cwd, sideEffect: check.sideEffect,
      runner: check.runner ?? null,
      adapterVersion: check.adapterVersion ?? null,
      resultProtocol: check.resultProtocol ?? null,
      testFiles: check.testFiles ?? [],
      cases: input.cases ?? []
    },
    result: {
      status: check.status === 0 && !check.error ? 'passed' : 'failed',
      exitCode: check.status,
      durationMs: check.durationMs,
      summary: check.error || check.stderr?.text || input.summary || `${check.name} 通过`,
      resultFingerprint: check.resultFingerprint,
      caseResults: input.caseResults ?? [],
      caseSummary: input.caseSummary ?? null
    },
    createdAt: check.finishedAt ?? new Date().toISOString()
  });
}

function evidenceFromCheck(task, changeSet, inputCycle, check, acceptance = task.acceptance) {
  if (check.resultProtocol === 'node-test-cases-v1' && (check.caseResults?.length ?? 0) > 0) {
    return check.caseResults.map((caseResult) => {
      const declared = (check.cases ?? []).find((item) => item.id === caseResult.id) ?? caseResult;
      const acceptanceIds = acceptanceIdsForCheck({
        acceptanceMode: 'explicit',
        acceptanceIds: caseResult.acceptanceIds ?? declared.acceptanceIds ?? [],
      }, acceptance);
      return createCheckEvidence(task, changeSet, inputCycle, check, {
        acceptanceIds,
        covers: caseResult.covers ?? declared.covers ?? [],
        cases: [declared],
        caseResults: [caseResult],
        caseSummary: {
          declared: 1,
          passed: caseResult.status === 'passed' ? 1 : 0,
          failed: caseResult.status === 'passed' ? 0 : 1,
          malformedEvents: 0,
        },
        summary: `${check.name}/${caseResult.id} 通过`,
      });
    });
  }
  return [createCheckEvidence(task, changeSet, inputCycle, check, {
    acceptanceIds: acceptanceIdsForCheck(check, acceptance),
    covers: check.covers ?? [],
    cases: check.cases ?? [],
    caseResults: check.caseResults ?? [],
    caseSummary: check.caseSummary ?? null,
  })];
}

function systemCheckEvidenceIdentity(evidence) {
  const source = evidence?.source;
  if (source?.type !== 'command') return null;
  return crypto.createHash('sha256').update(JSON.stringify({
    command:source.command ?? null,
    args:source.args ?? [],
    cwd:source.cwd ? path.resolve(source.cwd) : null,
    sideEffect:source.sideEffect ?? null,
    runner:source.runner ?? null,
    adapterVersion:source.adapterVersion ?? null,
    resultProtocol:source.resultProtocol ?? null,
    testFiles:source.testFiles ?? [],
    cases:source.cases ?? [],
    acceptanceIds:[...(evidence.acceptanceIds ?? [])].sort(),
    covers:[...(evidence.covers ?? [])].sort(),
  })).digest('hex');
}

function supersedePriorSystemCheckEvidence(evidence, freshEvidence, priorSystemHashes) {
  const freshIdentities = new Set(freshEvidence.map(systemCheckEvidenceIdentity).filter(Boolean));
  if (!freshIdentities.size) return evidence;
  return evidence.filter((item) => {
    if (!priorSystemHashes.has(item.payloadHash)) return true;
    const identity = systemCheckEvidenceIdentity(item);
    return !identity || !freshIdentities.has(identity);
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

export function preflightWorkspace(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) throw new Error('写任务必须位于可确认的 Git 工作树');
  const availability = inspectWorkspaceAvailability({ stateRoot:options.stateRoot, gitRoot, taskId:options.taskId });
  const workspace = inspectWorktreeRouteState(gitRoot);
  const baseline = captureBaseline(gitRoot);
  const baselineClean = baseline.files.length === 0;
  const snapshotConsistent = workspace.clean === baselineClean && workspace.branch === baseline.branch;
  const reasonCodes = [];
  if (!availability.available) reasonCodes.push('active-task');
  if (!workspace.clean || !baselineClean) reasonCodes.push('workspace-dirty');
  if (!snapshotConsistent) reasonCodes.push('workspace-changed-during-preflight');
  if (workspace.kind === 'local' && !workspace.branch) reasonCodes.push('primary-detached-head');
  const cleanAndAvailable = availability.available && workspace.clean && baselineClean && snapshotConsistent;
  const recommended = cleanAndAvailable
    ? (workspace.kind === 'worktree' ? 'current-worktree' : (workspace.branch ? 'local-direct' : 'new-worktree'))
    : 'new-worktree';
  const result = {
    ...availability,
    schemaVersion:2,
    diagnostic:availability.available ? null : '当前工作树已有活动写 Task；按 writeRouting 推荐路由处理。',
    workspace,
    directBaseline: ['local-direct', 'current-worktree'].includes(recommended) ? {
      head: baseline.head,
      branch: baseline.branch,
      detached:baseline.branch === null,
      gitRoot: baseline.gitRoot,
      gitCommonDir: baseline.gitCommonDir,
    } : null,
    writeRouting: {
      recommended,
      localDirectEligible:['local-direct', 'current-worktree'].includes(recommended),
      reasonCodes,
    },
  };
  if (options.requireAvailable === true && !result.available) throw new Error(availability.diagnostic);
  return result;
}

function verificationExecutionMetrics(execution) {
  const executed = (execution?.results ?? []).filter((item) => item.reused !== true);
  return {
    count: executed.length,
    durationMs: executed.reduce((sum, item) => sum + Math.max(0, Number(item.durationMs ?? 0) || 0), 0),
  };
}

function localDirectFailure(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, details);
  return error;
}

export function verifyLocalDirect(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) throw localDirectFailure('LOCAL_DIRECT_IDENTITY', '无法确认 Git 工作树');
  const baselineHead = String(options.baselineHead ?? '').trim();
  if (!/^[0-9a-f]{40,64}$/iu.test(baselineHead)) {
    throw localDirectFailure('LOCAL_DIRECT_BASELINE_REQUIRED', '缺少预检返回的有效 baseline HEAD');
  }
  const baselineGitRoot = String(options.baselineGitRoot ?? '').trim();
  const baselineGitCommonDir = String(options.baselineGitCommonDir ?? '').trim();
  const baselineBranch = String(options.baselineBranch ?? '').trim() || null;
  const baselineDetached = options.baselineDetached === true;
  if (!baselineGitRoot || !baselineGitCommonDir) {
    throw localDirectFailure('LOCAL_DIRECT_BASELINE_REQUIRED', '缺少预检返回的 Git Root 或 Git Common Dir');
  }
  if (Boolean(baselineBranch) === baselineDetached) {
    throw localDirectFailure('LOCAL_DIRECT_BASELINE_REQUIRED', '必须且只能提供预检返回的 baseline 分支或 detached 标记');
  }
  const current = captureBaseline(gitRoot);
  if (normalizePath(current.gitRoot) !== normalizePath(baselineGitRoot)
    || normalizePath(current.gitCommonDir) !== normalizePath(baselineGitCommonDir)) {
    throw localDirectFailure('LOCAL_DIRECT_IDENTITY_CHANGED', '当前工作树不是预检时的同一 Git 工作树，请重新路由', {
      expectedGitRoot:baselineGitRoot,
      actualGitRoot:current.gitRoot,
      expectedGitCommonDir:baselineGitCommonDir,
      actualGitCommonDir:current.gitCommonDir,
    });
  }
  const expectedBranch = baselineDetached ? null : baselineBranch;
  if (current.head !== baselineHead || current.branch !== expectedBranch) {
    throw localDirectFailure('LOCAL_DIRECT_HEAD_CHANGED', '预检后 HEAD 或分支已经变化，请重新路由', {
      expectedHead:baselineHead,
      actualHead:current.head,
      expectedBranch,
      actualBranch:current.branch,
    });
  }
  const availability = inspectWorkspaceAvailability({ stateRoot:options.stateRoot, gitRoot });
  if (!availability.available) {
    throw localDirectFailure('LOCAL_DIRECT_CONFLICT', '工作树出现活动写 Task，不能宣称轻量直达完成', {
      conflict:availability.conflict,
    });
  }
  const hasExplicitScope = options.scope != null
    && (!Array.isArray(options.scope) || options.scope.length > 0);
  const scopes = hasExplicitScope ? normalizeScopes(gitRoot, options.scope, gitRoot) : null;
  const baseline = { ...current, head:baselineHead, files:[] };
  const changeSet = computeChangeSet(baseline);
  if (scopes) {
    try { assertChangeSetWithinScope(changeSet, scopes); }
    catch (error) { throw localDirectFailure('LOCAL_DIRECT_SCOPE_VIOLATION', error.message); }
  }
  const initial = classifyTask({
    operation:'write',
    intent:String(options.intent ?? ''),
    acceptance:String(options.acceptance ?? ''),
    tracked:false,
  });
  const packageManifestChanges = inspectPackageManifestChanges(baseline, changeSet);
  const finalClassification = reclassifyFromChangeSet(initial, changeSet, { packageManifestChanges });
  const requiresFormal = finalClassification.executionRoute === 'formal-task'
    || finalClassification.continuity !== 'ephemeral';
  if (requiresFormal) {
    throw localDirectFailure('LOCAL_DIRECT_RISK_ESCALATION', '真实 ChangeSet 已升级为正式任务风险；停止直达交付并在干净隔离 Worktree 重新实施', {
      classification:finalClassification,
      changedFiles:changeSet.files.map((item) => item.path),
    });
  }
  return {
    schemaVersion:1,
    readOnly:true,
    decision:'allow',
    gitRoot,
    baselineHead,
    baselineIdentity:{
      head:baselineHead,
      gitRoot:current.gitRoot,
      gitCommonDir:current.gitCommonDir,
    },
    verifiedSemanticFingerprint:changeSet.semanticFingerprint,
    changeSet,
    classification:finalClassification,
    scope:scopes
      ? scopes.map((item) => item.path)
      : changeSet.files.map((item) => item.path),
    scopeSource:scopes ? 'explicit' : 'change-set',
  };
}

export function prepareTask(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const intent = String(options.intent ?? '').trim();
  if (!intent) throw new Error('准备任务必须提供 Intent');
  preflightWorkspace({ stateRoot:options.stateRoot, cwd, requireAvailable:true });
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
    operation: 'write',
    intent: classificationText,
    acceptance: providedAlignment ? providedAlignment.acceptance.join(' ') : (options.acceptance ?? []).toString(),
    scope: options.scope,
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
  const documentationOnly = initial.artifactKinds?.length === 1
    && initial.artifactKinds[0] === 'documentation';
  if (!providedAlignment && (initial.structureImpact === 'structural'
    || (initial.controlMode === 'controlled' && !documentationOnly))) {
    throw new Error('alignment-required-before-preparation: Controlled/Structural 任务必须在实施前提供 confirmed 或 delegated Goal Card');
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
      ...referenceItems,
    ], initial)
    : acceptanceItems(options.acceptance, initial);
  const built = buildContext({
    cwd,
    projectId: options.projectId,
    intent,
    acceptance: acceptance.map((item) => item.description).join(' '),
    classification: initial,
    operation: 'write',
    scope: options.scope,
    qualityProfiles: options.qualityProfiles ?? options.skills ?? [],
  });
  const gitRoot = built.context.gitRoot;
  if (!gitRoot) throw new Error('写任务必须位于可确认的 Git 工作树');
  const scopes = normalizeScopes(built.executionTarget.targetPath, options.scope ?? '.', gitRoot);
  const baseline = captureBaseline(gitRoot);
  // node:test uses primary temporary repositories as isolated fixtures. Real
  // task entrypoints have no Local-write bypass: every repository write starts
  // from a linked task Worktree, including detached Worktree fallbacks.
  if (!process.env.NODE_TEST_CONTEXT) assertTaskWorktreeBaseline(baseline);
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
  if (integration && baseline.branch === integration.target) {
    throw new Error(`任务 Worktree 正在直接持有集成目标 ${integration.target}；请使用 detached HEAD 或独立任务分支，避免并行任务直接推进主分支`);
  }
  const budget = createBudget({ mode: initial.controlMode, limitMs: options.budgetMs });
  const goal = providedAlignment
    ? buildAlignedGoal(providedAlignment, acceptance, scopes)
    : initial.controlMode === 'quick'
      ? buildAlignedGoal(synthesizeQuickAlignment({ intent, acceptance: options.acceptance, nonGoals: options.nonGoals }), acceptance, scopes)
      : { summary: intent, nonGoals: options.nonGoals ?? [], assumptions: [], openQuestions: [] };
  return createTask({
    stateRoot: options.stateRoot,
    goal,
    acceptance,
    authorization: {
      scope: scopes,
      allowedExistingChanges: options.allowedExistingChanges ?? [],
      externalActions: [],
      explicitReviewRequirement: options.explicitReviewRequirement ?? null
    },
    classification: initial,
    context: built,
    evaluationContext: captureEvaluationContext(options),
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
  if (options.inputChange || options.inputChangeReason) {
    throw new Error('禁止手工声明验证输入变化；只有真实 ChangeSet 或正式重新对齐可以开启新的验证周期');
  }
  const current = readTask({ stateRoot: options.stateRoot, taskId: options.taskId });
  const task = current.task;
  const scopes = task.authorization.scope;
  const before = computeChangeSet(task.baseline);
  const returnedFingerprint = task.verification?.returnedChangeFingerprint;
  const returnedSemanticFingerprint = task.verification?.returnedSemanticFingerprint
    ?? (returnedFingerprint && Array.isArray(task.changeSet?.files)
      ? semanticFingerprintForFiles(task.changeSet.files)
      : null);
  const returnedRevision = Number(task.verification?.returnedAlignmentRevision ?? -1);
  const alignmentRevision = Number(task.goal?.alignment?.revision ?? 0);
  const unchangedReturnedInput = returnedSemanticFingerprint
    ? returnedSemanticFingerprint === before.semanticFingerprint
    : returnedFingerprint && returnedFingerprint === before.fingerprint;
  if (unchangedReturnedInput && returnedRevision === alignmentRevision) {
    throw new Error('user-return-input-unchanged: 用户退回后 ChangeSet 未变化且未正式重新对齐，禁止机械重跑旧证明');
  }
  const scopeValidation = assertChangeSetWithinScope(before, scopes);
  const isolation = userChangesRemainIsolated(task.baseline, before, task.authorization.allowedExistingChanges ?? []);
  const persistentBlockers = withoutRecomputedDeliveryBlockers(task.blockers ?? []);
  if (!isolation.ok) {
    return updateTask({
      stateRoot: options.stateRoot,
      taskId: task.taskId,
      expectedRevision: task.stateRevision,
      transitionTo: 'blocked',
      event: 'delivery',
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
  const packageManifestChanges = inspectPackageManifestChanges(task.baseline, before);
  const classification = reclassifyFromChangeSet(task.classification, before, {
    forcedMode: options.forceMode,
    forceReason: options.forceReason,
    packageManifestChanges,
  });
  const finalAlignment = evaluateFinalAlignment({ goal: task.goal, classification });
  const alignmentEscalation = finalAlignment.required && finalAlignment.reason === 'alignment-risk-escalation';
  const alignmentMissing = finalAlignment.required && finalAlignment.reason === 'alignment-required';
  const fingerprintCheck = validateAlignmentFingerprint({ goal: task.goal, acceptance: task.acceptance, scope:scopes });
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
    if (plan.missingAcceptanceCovers.length) {
      checkManifest = null;
      lastFailure = null;
      checkExecution = {
        ok: false,
        status: 'unavailable',
        stopReason: 'missing-acceptance-checks',
        results: [],
        budget: task.verification.budget,
      };
    } else {
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
        const checkEvidence = checkExecution.ok
          ? checkExecution.results
            .filter((item) => item.status === 0 && !item.error)
            .flatMap((item) => evidenceFromCheck(task, changeSet, inputCycle, item, acceptance))
          : [];
        evidence = supersedePriorSystemCheckEvidence(evidence, checkEvidence, previousSystemHashes);
        for (const item of checkEvidence) systemCreatedHashes.add(item.payloadHash);
        evidence.push(...checkEvidence);
        if (!checkExecution.ok) {
          lastFailure = checkExecution.stopReason === 'budget' ? null : failureFingerprint;
          if (options.diagnosticRetry === true) diagnosticRetryUsed = true;
        } else lastFailure = null;
      }
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
  else if (checkExecution && !checkExecution.ok && checkExecution.stopReason !== 'missing-acceptance-checks') {
    decision = { decision: 'needs_rework', reasons: [checkExecution.stopReason ?? checkExecution.status] };
  }
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
  const decisionGateReason = [
    'alignment-risk-escalation',
    'alignment-required',
    'alignment-fingerprint-mismatch',
    'spec-consistency',
    'change-rationale-unmapped',
    'change-rationale-required',
  ].find((reason) => decision.reasons.includes(reason));
  const pendingRef = status === 'ready_to_integrate'
    ? createPendingIntegrationRef(changeSet.gitRoot, task.taskId, integrationCandidate.resultCommit)
    : task.integration?.pendingRef ?? null;

  const checkMetrics = verificationExecutionMetrics(checkExecution);
  return updateTask({
    stateRoot: options.stateRoot,
    taskId: task.taskId,
    expectedRevision: task.stateRevision,
    transitionTo: status,
    event: 'delivery',
    metricExecutionCount: checkMetrics.count,
    metricDurationMs: checkMetrics.durationMs,
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
        auxiliaryEvidence: summary.auxiliaryEvidence ?? [],
        browserSummary: checkExecution?.browserSummary ?? null,
        preservationCoverage,
        firstFailure,
        stopReason: checkExecution?.stopReason === 'missing-acceptance-checks' && decisionGateReason
          ? decisionGateReason
          : checkExecution?.stopReason
          ?? (alignmentEscalation ? 'alignment-risk-escalation'
            : alignmentMissing ? 'alignment-required'
            : !fingerprintCheck.ok ? 'alignment-fingerprint-mismatch'
            : !rationaleGate && classification.controlMode === 'controlled' ? 'change-rationale-unmapped'
            : !rationaleGate ? 'change-rationale-required'
            : status === 'waiting_acceptance' ? 'evidence-sufficient' : null),
        checkManifest,
        lastInputChange: null,
        returnedChangeFingerprint:null,
        returnedSemanticFingerprint:null,
        returnedAlignmentRevision:null,
      };
      next.deliveryDecision = decision;
      delete next.userAcceptance;
      if (status === 'waiting_acceptance') {
        next.conversationOutcome = nextConversationDelivery(next.conversationOutcome);
      }
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
    throw new Error(`集成目标 HEAD 已变化: 已验证 ${task.integration.targetCommit}，当前 ${result.targetCommit}；需由执行模型运行“task.mjs 重验集成 --task-id ${task.taskId} --cwd <目标工作区>”`);
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
      resultProtocol:item.resultProtocol ?? null,
      caseSummary:item.caseSummary ?? null,
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
  const scopes = task.authorization.scope;
  const acceptance = acceptanceItems([
    ...nextAlignment.acceptance.map((description) => ({ description, source: 'requested-outcome' })),
    ...referenceBehaviorAcceptanceItems(nextAlignment.preservation),
  ], task.classification);
  const base = buildAlignedGoal(nextAlignment, acceptance, scopes);
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
      next.deliveryDecision = null;
      next.residualRisks = [];
      next.specTraceability = null;
      next.specConsistency = null;
      next.blockers = [];
      next.verification = {
        ...next.verification,
        inputCycle: Number(next.verification?.inputCycle ?? 0) + 1,
        requiredCovers: [],
        missingCovers: [],
        missingAcceptance: acceptance.map((item) => item.id),
        acceptanceGaps: [],
        systemEvidenceHashes: [],
        untrustedTechnicalEvidence: [],
        auxiliaryEvidence: [],
        browserSummary: null,
        preservationCoverage: null,
        firstFailure: null,
        lastFailureFingerprint: null,
        diagnosticRetryUsed: false,
        stopReason: null,
        checkManifest: null,
        returnedChangeFingerprint: null,
        returnedSemanticFingerprint: null,
        returnedAlignmentRevision: null,
      };
      return next;
    },
  });
}

function automaticIntegrationRiskReasons(task) {
  const reasons = [];
  if (task.classification?.controlMode === 'controlled') reasons.push('controlled-change');
  if (task.classification?.structureImpact === 'structural') reasons.push('structural-change');
  if ((task.residualRisks ?? []).length) reasons.push('residual-risks');
  if (task.specImpact?.level === 'decision-required') reasons.push('spec-decision-required');
  if ((task.authorization?.externalActions ?? []).length) reasons.push('external-actions');
  return reasons;
}

function pauseIntegration(options, task, details = {}) {
  const reason = details.reason ?? 'integration-paused';
  const checkMetrics = verificationExecutionMetrics(details.execution);
  return updateTask({
    stateRoot:options.stateRoot,
    taskId:task.taskId,
    expectedRevision:task.stateRevision,
    transitionTo:'ready_to_integrate',
    event:'integration-pause',
    metricExecutionCount:checkMetrics.count,
    metricDurationMs:checkMetrics.durationMs,
    mutate(next) {
      next.integration = {
        ...next.integration,
        status:details.status ?? 'paused',
        pauseReasons:details.pauseReasons ?? [reason],
        targetGitRoot:details.targetGitRoot ?? next.integration.targetGitRoot,
        candidateBase:Object.hasOwn(details, 'candidateBase') ? details.candidateBase : next.integration.candidateBase ?? null,
        candidateCommit:Object.hasOwn(details, 'candidateCommit') ? details.candidateCommit : next.integration.candidateCommit ?? null,
        integrationWorktree:Object.hasOwn(details, 'integrationWorktree') ? details.integrationWorktree : next.integration.integrationWorktree ?? null,
        conflictFiles:details.conflictFiles ?? [],
        diagnostic:details.diagnostic ?? null,
        riskAuthorization:details.riskAuthorization ?? next.integration.riskAuthorization ?? null,
      };
      next.verification = {
        ...next.verification,
        budget:details.execution?.budget ?? next.verification.budget,
        stopReason:reason,
        browserSummary:details.execution?.browserSummary ?? null,
        firstFailure:details.diagnostic ? {
          name:'integration', command:'git', args:['cherry-pick'], exitCode:1,
          error:null, output:String(details.diagnostic).slice(-5000), truncated:String(details.diagnostic).length > 5000,
        } : null,
      };
      next.deliveryDecision = {
        decision:reason === 'integration-risk-user-decision' ? 'needs_decision' : 'verifying',
        reasons:details.pauseReasons ?? [reason],
      };
      return next;
    },
  });
}

function integrationCheckFailure(options, task, details) {
  const checkMetrics = verificationExecutionMetrics(details.execution);
  return updateTask({
    stateRoot:options.stateRoot,
    taskId:task.taskId,
    expectedRevision:task.stateRevision,
    transitionTo:'needs_rework',
    event:'integration',
    metricExecutionCount:checkMetrics.count,
    metricDurationMs:checkMetrics.durationMs,
    mutate(next) {
      next.integration = {
        ...next.integration,
        status:'revalidation_failed',
        targetGitRoot:details.targetGitRoot,
        targetCommit:details.targetCommit,
        candidateBase:null,
        candidateCommit:null,
        integrationWorktree:details.cleanup?.removed === false ? details.integrationWorktree : null,
        pauseReasons:[details.stopReason],
        cleanup:details.cleanup ? { candidateWorktree:details.cleanup } : next.integration.cleanup ?? null,
        riskAuthorization:details.riskAuthorization ?? next.integration.riskAuthorization ?? null,
      };
      next.verification = {
        ...next.verification,
        budget:details.execution?.budget ?? next.verification.budget,
        stopReason:details.stopReason,
        firstFailure:firstFailureDiagnostic(details.execution),
        browserSummary:details.execution?.browserSummary ?? null,
      };
      next.deliveryDecision = { decision:'needs_rework', reasons:[details.stopReason] };
      return next;
    },
  });
}

function refreshEvidenceFromIntegration(task, details) {
  const inputCycle = Number(task.verification?.inputCycle ?? 0);
  const priorSystemHashes = new Set(task.verification?.systemEvidenceHashes ?? []);
  const retained = (task.evidence ?? []).filter((item) => !(
    priorSystemHashes.has(item.payloadHash)
    && item.source?.type === 'command'
    && item.source?.actor === 'ai-system'
  ));
  const refreshed = (details.execution?.results ?? []).flatMap((result) => (
    evidenceFromCheck(task, task.changeSet, inputCycle, result, task.acceptance)
  ));
  const evidence = [...retained, ...refreshed];
  const systemEvidenceHashes = [...new Set([
    ...retained.filter((item) => priorSystemHashes.has(item.payloadHash)).map((item) => item.payloadHash),
    ...refreshed.map((item) => item.payloadHash),
  ])];
  const requiredCovers = determineEvidenceRequirements({
    classification:task.classification,
    changeSet:task.changeSet,
    acceptance:task.acceptance,
    observableBrowserBehavior:task.verification?.requiredCovers?.includes('browser'),
  });
  const summary = evidenceSummary({
    acceptance:task.acceptance,
    evidence,
    requiredCovers,
    systemEvidenceHashes,
    context:{
      taskId:task.taskId,
      changeFingerprint:task.changeSet.fingerprint,
      inputCycle,
      gitRoot:details.targetGitRoot,
    },
  });
  if (summary.invalid.length || summary.missingAcceptance.length || summary.missingCovers.length) {
    const reasons = [
      ...(summary.invalid.length ? ['invalid-evidence'] : []),
      ...summary.missingAcceptance.map((id) => `missing-acceptance:${id}`),
      ...summary.missingCovers.map((cover) => `missing-cover:${cover}`),
    ];
    throw new Error(`集成结果无法形成目标 Worktree Evidence: ${reasons.join(', ')}`);
  }
  return { evidence, systemEvidenceHashes, requiredCovers, summary };
}

function recordIntegrationSuccess(options, task, details) {
  const integrationEvidence = compactIntegrationEvidence(task, details.targetCommit, details.plan, details.execution);
  const refreshed = refreshEvidenceFromIntegration(task, details);
  const checkMetrics = verificationExecutionMetrics(details.execution);
  deletePendingIntegrationRef(details.targetGitRoot, task.integration.pendingRef, task.integration.resultCommit);
  return updateTask({
    stateRoot:options.stateRoot,
    taskId:task.taskId,
    expectedRevision:task.stateRevision,
    transitionTo:'waiting_acceptance',
    event:'integration',
    metricExecutionCount:checkMetrics.count,
    metricDurationMs:checkMetrics.durationMs,
    mutate(next) {
      next.integration = {
        ...next.integration,
        status:'integrated',
        targetGitRoot:details.targetGitRoot,
        targetCommit:details.targetCommit,
        method:details.method,
        integratedAt:new Date().toISOString(),
        integrationEvidence,
        revalidatedAt:integrationEvidence.createdAt,
        candidateBase:null,
        candidateCommit:null,
        integrationWorktree:null,
        conflictFiles:[],
        diagnostic:null,
        pauseReasons:[],
        cleanup:details.cleanup ?? null,
        riskAuthorization:details.riskAuthorization ?? next.integration.riskAuthorization ?? null,
      };
      next.deliveryDecision = { decision:'waiting_acceptance', reasons:[] };
      next.evidence = refreshed.evidence;
      next.verification = {
        ...next.verification,
        budget:details.execution.budget,
        requiredCovers:refreshed.requiredCovers,
        missingCovers:refreshed.summary.missingCovers,
        missingAcceptance:refreshed.summary.missingAcceptance,
        systemEvidenceHashes:refreshed.systemEvidenceHashes,
        untrustedTechnicalEvidence:refreshed.summary.untrustedTechnicalEvidence ?? [],
        auxiliaryEvidence:refreshed.summary.auxiliaryEvidence ?? [],
        stopReason:'integration-evidence-sufficient',
        firstFailure:null,
        browserSummary:details.execution?.browserSummary ?? null,
      };
      next.conversationOutcome = nextConversationDelivery(next.conversationOutcome);
      if (next.classification.continuity === 'handoff-required') {
        next.handoff = createHandoff({ ...next, status:'waiting_acceptance' }, { stateRevision:task.stateRevision + 1, next:'waiting_acceptance' });
      }
      return next;
    },
  });
}

export function integrateTask(options = {}) {
  const initial = readTask({ stateRoot:options.stateRoot, taskId:options.taskId }).task;
  if (initial.status !== 'ready_to_integrate') throw new Error(`任务当前不能集成: ${initial.status}`);
  if (!initial.integration?.resultCommit) throw new Error('任务缺少待集成结果提交');
  const target = normalizeIntegrationTarget(options.target ?? initial.integration.target);
  if (target !== initial.integration.target) throw new Error(`集成目标不匹配: 任务要求 ${initial.integration.target}`);

  return withIntegrationLock({
    stateRoot:options.stateRoot,
    gitCommonDir:initial.integration.gitCommonDir,
    target,
  }, () => {
    const current = readTask({ stateRoot:options.stateRoot, taskId:options.taskId });
    const task = current.task;
    if (task.status !== 'ready_to_integrate') throw new Error(`任务已被其他集成器推进: ${task.status}`);
    const sourceGitRoot = task.integration.sourceGitRoot;
    const alreadyIntegrated = verifyCommitIntegrated({
      gitRoot:sourceGitRoot,
      expectedCommonDir:task.integration.gitCommonDir,
      target,
      resultCommit:task.integration.resultCommit,
      baseCommit:task.integration.baseCommit,
    });
    if (alreadyIntegrated.ok) {
      const targetState = inspectTargetCheckout(sourceGitRoot, target);
      if (!targetState.ok) return pauseIntegration(options, task, {
        reason:targetState.reason,
        targetGitRoot:targetState.targetCheckout,
      });
      return confirmIntegration({ ...options, cwd:targetState.targetCheckout, target, autoCleanup:true });
    }

    const riskReasons = automaticIntegrationRiskReasons(task);
    if (riskReasons.length && options.allowRisk !== true) {
      return pauseIntegration(options, task, {
        reason:'integration-risk-user-decision',
        status:'paused_risk',
        pauseReasons:riskReasons,
      });
    }
    if (options.allowRisk === true && !String(options.riskReason ?? '').trim()) {
      throw new Error('--allow-risk-integration 必须提供 --risk-reason 记录用户授权或风险判断');
    }
    const riskAuthorization = options.allowRisk === true
      ? { reason:String(options.riskReason).trim(), authorizedAt:new Date().toISOString() }
      : null;

    const candidate = prepareIntegrationCandidate({
      stateRoot:readTask({ stateRoot:options.stateRoot, taskId:task.taskId }).stateRoot,
      taskId:task.taskId,
      sourceGitRoot,
      gitCommonDir:task.integration.gitCommonDir,
      target,
      baseCommit:task.integration.baseCommit,
      resultCommit:task.integration.resultCommit,
      existingWorktree:task.integration.integrationWorktree,
      candidateBase:task.integration.candidateBase,
    });
    if (candidate.status !== 'ready') {
      return pauseIntegration(options, task, {
        reason:candidate.reason,
        status:candidate.status === 'conflict' ? 'conflict' : candidate.status === 'needs-commit' ? 'conflict_resolution' : 'paused',
        targetGitRoot:candidate.targetCheckout,
        candidateBase:candidate.candidateBase,
        integrationWorktree:candidate.candidatePath,
        conflictFiles:candidate.conflicts,
        diagnostic:candidate.diagnostic ?? candidate.dirty,
        riskAuthorization,
      });
    }

    const before = captureBaseline(candidate.candidatePath);
    if (before.head !== candidate.candidateCommit || before.files.length > 0) {
      return pauseIntegration(options, task, {
        reason:'integration-candidate-dirty',
        status:'paused',
        targetGitRoot:candidate.targetCheckout,
        candidateBase:candidate.candidateBase,
        candidateCommit:candidate.candidateCommit,
        integrationWorktree:candidate.candidatePath,
      });
    }
    const plan = integrationCheckPlan(task, candidate.candidatePath);
    if (plan.missingCovers.length || plan.missingAcceptance.length) {
      const cleanup = removeIntegrationWorktree({ targetCheckout:candidate.targetCheckout, candidatePath:candidate.candidatePath });
      return pauseIntegration(options, task, {
        reason:'integration-check-coverage-missing',
        pauseReasons:[...plan.missingCovers, ...plan.missingAcceptance],
        targetGitRoot:candidate.targetCheckout,
        integrationWorktree:cleanup.removed ? null : candidate.candidatePath,
        diagnostic:cleanup.removed ? null : cleanup.diagnostic ?? cleanup.reason,
        riskAuthorization,
      });
    }
    const execution = executeCheckPlan(plan, { cwd:candidate.candidatePath, budget:task.verification.budget });
    const after = captureBaseline(candidate.candidatePath);
    const mutated = after.head !== before.head || after.fingerprint !== before.fingerprint;
    if (!execution.ok || mutated) {
      const stopReason = mutated ? 'integration-check-mutated-candidate' : `integration-check-${execution.stopReason ?? execution.status ?? 'failed'}`;
      const cleanup = removeIntegrationWorktree({ targetCheckout:candidate.targetCheckout, candidatePath:candidate.candidatePath });
      if (!mutated && execution.stopReason === 'budget') {
        return pauseIntegration(options, task, {
          reason:'budget',
          status:'paused',
          targetGitRoot:candidate.targetCheckout,
          integrationWorktree:cleanup.removed ? null : candidate.candidatePath,
          diagnostic:cleanup.removed ? null : cleanup.diagnostic ?? cleanup.reason,
          riskAuthorization,
          execution,
        });
      }
      return integrationCheckFailure(options, task, {
        targetGitRoot:candidate.targetCheckout,
        targetCommit:candidate.targetCommit,
        stopReason,
        execution,
        cleanup,
        integrationWorktree:candidate.candidatePath,
        riskAuthorization,
      });
    }

    const promoted = promoteIntegrationCandidate({
      sourceGitRoot,
      target,
      candidatePath:candidate.candidatePath,
      candidateBase:candidate.candidateBase,
      candidateCommit:candidate.candidateCommit,
    });
    if (!promoted.ok) {
      const cleanup = removeIntegrationWorktree({ targetCheckout:candidate.targetCheckout, candidatePath:candidate.candidatePath });
      return pauseIntegration(options, task, {
        reason:promoted.reason,
        status:'paused',
        targetGitRoot:promoted.targetCheckout ?? candidate.targetCheckout,
        integrationWorktree:cleanup.removed ? null : candidate.candidatePath,
        diagnostic:promoted.diagnostic ?? (cleanup.removed ? null : cleanup.diagnostic ?? cleanup.reason),
        riskAuthorization,
      });
    }

    const candidateCleanup = removeIntegrationWorktree({
      targetCheckout:promoted.targetCheckout,
      candidatePath:candidate.candidatePath,
    });
    const sourceCleanup = cleanupTaskSource({
      targetCheckout:promoted.targetCheckout,
      sourceGitRoot,
      resultCommit:task.integration.resultCommit,
      target,
      keepWorktree:options.keepWorktree === true,
      protectedPaths:[current.stateRoot],
    });
    return recordIntegrationSuccess(options, task, {
      targetGitRoot:promoted.targetCheckout,
      targetCommit:promoted.targetCommit,
      method:promoted.method,
      plan,
      execution,
      cleanup:{ candidateWorktree:candidateCleanup, source:sourceCleanup },
      riskAuthorization,
    });
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
  const checkMetrics = verificationExecutionMetrics(execution);
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
      transitionTo:'verifying',
      event:'integration-revalidation',
      metricExecutionCount:checkMetrics.count,
      metricDurationMs:checkMetrics.durationMs,
      mutate(next) {
        next.verification = {
          ...next.verification,
          budget:execution.budget,
          stopReason:stopReason ?? 'integration-check-failed',
          firstFailure:firstFailureDiagnostic(execution),
          browserSummary:execution.browserSummary ?? null,
        };
        next.deliveryDecision = { decision:'verifying', reasons:[stopReason ?? 'integration-check-failed'] };
        return next;
      }
    });
  }

  const integrationEvidence = compactIntegrationEvidence(task, integrated.targetCommit, plan, execution);
  const refreshed = refreshEvidenceFromIntegration(task, { targetGitRoot, execution });
  return updateTask({
    stateRoot:options.stateRoot,
    taskId:task.taskId,
    expectedRevision:task.stateRevision,
    transitionTo:'waiting_acceptance',
    event:'integration-revalidation',
    metricExecutionCount:checkMetrics.count,
    metricDurationMs:checkMetrics.durationMs,
    mutate(next) {
      next.integration = {
        ...next.integration,
        targetGitRoot,
        targetCommit:integrated.targetCommit,
        method:integrated.method,
        integrationEvidence,
        revalidatedAt:integrationEvidence.createdAt,
      };
      next.evidence = refreshed.evidence;
      next.verification = {
        ...next.verification,
        budget:execution.budget,
        requiredCovers:refreshed.requiredCovers,
        missingCovers:refreshed.summary.missingCovers,
        missingAcceptance:refreshed.summary.missingAcceptance,
        systemEvidenceHashes:refreshed.systemEvidenceHashes,
        untrustedTechnicalEvidence:refreshed.summary.untrustedTechnicalEvidence ?? [],
        auxiliaryEvidence:refreshed.summary.auxiliaryEvidence ?? [],
        stopReason:'integration-evidence-sufficient',
        firstFailure:null,
        browserSummary:execution.browserSummary ?? null,
      };
      next.deliveryDecision = { decision:'waiting_acceptance', reasons:[] };
      next.conversationOutcome = nextConversationDelivery(next.conversationOutcome);
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
    if (!mutated && execution.stopReason === 'budget') {
      return pauseIntegration(options, task, {
        reason:'budget',
        status:'paused',
        targetGitRoot,
        execution,
      });
    }
    const checkMetrics = verificationExecutionMetrics(execution);
    return updateTask({
      stateRoot: options.stateRoot,
      taskId: task.taskId,
      expectedRevision: task.stateRevision,
      transitionTo: 'verifying',
      event: 'integration',
      metricExecutionCount:checkMetrics.count,
      metricDurationMs:checkMetrics.durationMs,
      mutate(next) {
        next.integration = { ...next.integration, status:'revalidation_failed', targetGitRoot, targetCommit:result.targetCommit };
        next.verification = {
          ...next.verification,
          budget:execution.budget,
          stopReason,
          firstFailure:firstFailureDiagnostic(execution),
          browserSummary:execution.browserSummary ?? null,
        };
        next.deliveryDecision = { decision:'verifying', reasons:[stopReason] };
        return next;
      }
    });
  }
  const cleanup = options.autoCleanup === true
    ? {
        candidateWorktree:{ removed:false, reason:'not-created' },
        source:cleanupTaskSource({
          targetCheckout:targetGitRoot,
          sourceGitRoot:task.integration.sourceGitRoot,
          resultCommit:task.integration.resultCommit,
          target,
          keepWorktree:options.keepWorktree === true,
          protectedPaths:[current.stateRoot],
        }),
      }
    : null;
  return recordIntegrationSuccess(options, task, {
    targetGitRoot,
    targetCommit:result.targetCommit,
    method:result.method,
    plan,
    execution,
    cleanup,
  });
}

function revalidateForAcceptance(task) {
  const integrated = assertIntegratedTaskFresh(task);
  const changeSet = integrated ? task.changeSet : computeChangeSet(task.baseline);
  if (!integrated && changeSet.fingerprint !== task.changeSet?.fingerprint) throw new Error('交付后的目标文件已经变化，必须重新验证和交付');
  const scopeValidation = assertChangeSetWithinScope(changeSet, task.authorization.scope);
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
    scope: task.authorization.scope
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
    context: {
      taskId: task.taskId,
      changeFingerprint: changeSet.fingerprint,
      inputCycle: task.verification?.inputCycle ?? 0,
      gitRoot: integrated ? task.integration.targetGitRoot : changeSet.gitRoot,
    }
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

export function inspectAcceptanceEligibility(options = {}) {
  const repositoryScoped = Boolean(options.repositoryIdentity);
  const tasks = listTasks({
    stateRoot:options.stateRoot,
    repositoryIdentity:options.repositoryIdentity,
    limit:0,
  }).tasks.filter((task) => task.status === 'waiting_acceptance');
  const diagnostics = [];
  let eligible = 0;
  for (const task of tasks) {
    try {
      revalidateForAcceptance(task);
      eligible += 1;
    } catch (error) {
      diagnostics.push({
        taskId:task.taskId,
        code:'acceptance-ineligible',
        diagnostic:error.message,
      });
    }
  }
  return {
    schemaVersion:1,
    readOnly:true,
    scope:repositoryScoped ? 'repository' : 'all-projects',
    ok:diagnostics.length === 0,
    checked:tasks.length,
    eligible,
    ineligible:diagnostics.length,
    diagnostics,
  };
}

function recreateReturnedTaskWorkspace(task) {
  if (task.integration?.status !== 'integrated') return null;
  const sourceGitRoot = path.resolve(task.integration.sourceGitRoot ?? task.baseline?.gitRoot ?? '');
  const targetGitRoot = path.resolve(task.integration.targetGitRoot ?? '');
  if (!task.integration.sourceGitRoot || !task.integration.targetGitRoot
    || normalizePath(sourceGitRoot) === normalizePath(targetGitRoot)) {
    throw new Error('integrated-return-worktree-invalid: 无法确定独立的返工 Worktree');
  }
  const integrated = verifyCommitIntegrated({
    gitRoot:targetGitRoot,
    expectedCommonDir:task.integration.gitCommonDir,
    target:task.integration.target,
    resultCommit:task.integration.resultCommit,
    baseCommit:task.integration.baseCommit,
  });
  if (!integrated.ok || !integrated.targetCommit) {
    throw new Error(`integrated-return-target-unavailable: ${integrated.reason ?? 'unknown'}${integrated.diagnostic ? `: ${integrated.diagnostic}` : ''}`);
  }
  const targetCommit = integrated.targetCommit;
  let baseline;
  if (fs.existsSync(sourceGitRoot)) {
    baseline = captureBaseline(sourceGitRoot);
    const sourceWasRemoved = ['removed','absent'].includes(task.integration.cleanup?.source?.worktree);
    if (sourceWasRemoved) {
      throw new Error('integrated-return-worktree-occupied: 原返工路径在集成清理后被其他 Worktree 占用');
    }
    if (normalizePath(baseline.gitCommonDir) !== normalizePath(task.integration.gitCommonDir)) {
      throw new Error('integrated-return-worktree-mismatch: 原返工路径已属于其他 Git 仓库');
    }
    if (!task.baseline?.gitDir || normalizePath(baseline.gitDir) !== normalizePath(task.baseline.gitDir)) {
      throw new Error('integrated-return-worktree-identity-mismatch: 原返工路径不再是 Task 的同一 Worktree');
    }
    if (baseline.files.length) throw new Error('integrated-return-worktree-dirty: 原返工 Worktree 存在未提交改动');
    if (baseline.head !== targetCommit) {
      const checkout = spawnSync('git', [
        '-C', sourceGitRoot, 'checkout', '--detach', targetCommit,
      ], { encoding:'utf8', windowsHide:true, timeout:30000, maxBuffer:8 * 1024 * 1024 });
      if (checkout.status !== 0 || checkout.error) {
        const detail = String(checkout.stderr || checkout.error?.message || `exit ${checkout.status ?? 'unknown'}`).trim();
        throw new Error(`integrated-return-worktree-align-failed: ${detail}`);
      }
      baseline = captureBaseline(sourceGitRoot);
    }
  } else {
    fs.mkdirSync(path.dirname(sourceGitRoot), { recursive:true });
    const result = spawnSync('git', [
      '-C', targetGitRoot, 'worktree', 'add', '--detach', sourceGitRoot, targetCommit,
    ], { encoding:'utf8', windowsHide:true, timeout:30000, maxBuffer:8 * 1024 * 1024 });
    if (result.status !== 0 || result.error) {
      const detail = String(result.stderr || result.error?.message || `exit ${result.status ?? 'unknown'}`).trim();
      throw new Error(`integrated-return-worktree-create-failed: ${detail}`);
    }
    baseline = captureBaseline(sourceGitRoot);
  }
  if (normalizePath(baseline.gitCommonDir) !== normalizePath(task.integration.gitCommonDir)) {
    throw new Error('integrated-return-worktree-mismatch: 重建后的 Worktree 不属于原仓库');
  }
  if (baseline.head !== targetCommit) {
    throw new Error(`integrated-return-worktree-stale: 返工 Worktree ${baseline.head} 未对齐目标 ${targetCommit}`);
  }
  const emptyChangeSet = computeChangeSet(baseline);
  if (emptyChangeSet.files.length) throw new Error('integrated-return-worktree-dirty: 重建后的 Worktree 不是干净基线');
  return { baseline, emptyFingerprint:emptyChangeSet.fingerprint, emptySemanticFingerprint:emptyChangeSet.semanticFingerprint };
}

function applyReturnedTaskWorkspace(next, restored) {
  if (!restored) return next;
  next.baseline = restored.baseline;
  next.changeSet = null;
  next.context = {
    ...next.context,
    context:{
      ...next.context?.context,
      gitRoot:restored.baseline.gitRoot,
      head:restored.baseline.head,
      branch:restored.baseline.branch,
    },
    executionTarget:{ targetPath:restored.baseline.gitRoot },
  };
  next.integration = {
    ...next.integration,
    status:'pending_commit',
    baseCommit:restored.baseline.head,
    resultCommit:null,
    targetCommit:null,
    method:null,
    pendingRef:null,
    integratedAt:null,
    integrationEvidence:null,
    revalidatedAt:null,
    candidateBase:null,
    candidateCommit:null,
    integrationWorktree:null,
    conflictFiles:[],
    diagnostic:null,
    pauseReasons:[],
    cleanup:null,
    riskAuthorization:null,
  };
  next.verification.returnedChangeFingerprint = restored.emptyFingerprint;
  next.verification.returnedSemanticFingerprint = restored.emptySemanticFingerprint;
  return next;
}

function invalidateReturnedDeliveryProof(next, reason, restored = null) {
  const returnedChangeFingerprint = next.changeSet?.fingerprint ?? null;
  const returnedSemanticFingerprint = next.changeSet?.semanticFingerprint
    ?? (Array.isArray(next.changeSet?.files) ? semanticFingerprintForFiles(next.changeSet.files) : null);
  const returnedAlignmentRevision = Number(next.goal?.alignment?.revision ?? 0);
  next.evidence = [];
  delete next.reviews;
  delete next.reviewPackage;
  next.handoff = null;
  next.changeRationale = null;
  next.verification = {
    ...next.verification,
    inputCycle:Number(next.verification?.inputCycle ?? 0) + 1,
    requiredCovers:[],
    missingCovers:[],
    missingAcceptance:(next.acceptance ?? []).map((item) => item.id),
    acceptanceGaps:[],
    systemEvidenceHashes:[],
    untrustedTechnicalEvidence:[],
    auxiliaryEvidence:[],
    browserSummary:null,
    preservationCoverage:null,
    firstFailure:null,
    lastFailureFingerprint:null,
    diagnosticRetryUsed:false,
    checkManifest:null,
    returnedChangeFingerprint,
    returnedSemanticFingerprint,
    returnedAlignmentRevision,
    stopReason:reason,
  };
  return applyReturnedTaskWorkspace(next, restored);
}

const RETURN_WORKSPACE_REQUIRED = 'integrated-return-workspace-recovery-required';
const RETURN_WORKSPACE_FAILED = 'integrated-return-workspace-recovery-failed';
const RETURN_WORKSPACE_BLOCKER = '返工 Worktree 尚未恢复';
const RETURN_WORKSPACE_FAILURE_PREFIX = '返工 Worktree 恢复失败:';

function withoutReturnWorkspaceBlockers(blockers = []) {
  return blockers.filter((item) => item !== RETURN_WORKSPACE_BLOCKER
    && !String(item).startsWith(RETURN_WORKSPACE_FAILURE_PREFIX));
}

function markReturnWorkspaceRecoveryRequired(next) {
  next.verification = { ...next.verification, stopReason:RETURN_WORKSPACE_REQUIRED };
  next.deliveryDecision = { decision:'blocked', reasons:[RETURN_WORKSPACE_REQUIRED] };
  next.blockers = [...withoutReturnWorkspaceBlockers(next.blockers ?? []), RETURN_WORKSPACE_BLOCKER];
  next.integration = { ...next.integration, diagnostic:RETURN_WORKSPACE_BLOCKER };
  return next;
}

function recoverReturnedTaskWorkspace(options, current, event = 'workspace-recovery') {
  const task = current.task;
  const returnReason = task.userAcceptance?.decision === 'rejected'
    ? 'user-return'
    : 'conversation-defect-return';
  try {
    const sourceGitRoot = task.integration?.sourceGitRoot ?? task.baseline?.gitRoot;
    const availability = inspectWorkspaceAvailability({
      stateRoot:options.stateRoot,
      gitRoot:sourceGitRoot,
      taskId:task.taskId,
    });
    if (!availability.available) {
      throw new Error(`integrated-return-worktree-conflict: ${availability.diagnostic}`);
    }
    const restored = recreateReturnedTaskWorkspace(task);
    if (!restored) throw new Error('integrated-return-worktree-invalid: Task 不再处于已集成返工状态');
    return updateTask({
      stateRoot:options.stateRoot,
      taskId:task.taskId,
      expectedRevision:task.stateRevision,
      transitionTo:'verifying',
      event,
      mutate(next) {
        applyReturnedTaskWorkspace(next, restored);
        next.verification = { ...next.verification, stopReason:returnReason };
        next.blockers = withoutReturnWorkspaceBlockers(next.blockers ?? []);
        next.deliveryDecision = { decision:'needs_rework', reasons:[returnReason] };
        return next;
      },
    });
  } catch (error) {
    return updateTask({
      stateRoot:options.stateRoot,
      taskId:task.taskId,
      expectedRevision:task.stateRevision,
      transitionTo:'blocked',
      event,
      mutate(next) {
        const diagnostic = String(error?.message ?? error);
        next.verification = { ...next.verification, stopReason:RETURN_WORKSPACE_FAILED };
        next.deliveryDecision = { decision:'blocked', reasons:[RETURN_WORKSPACE_FAILED] };
        next.blockers = [
          ...withoutReturnWorkspaceBlockers(next.blockers ?? []),
          `${RETURN_WORKSPACE_FAILURE_PREFIX} ${diagnostic}`,
        ];
        next.integration = { ...next.integration, diagnostic };
        return next;
      },
    });
  }
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
    const integratedReturn = task.integration?.status === 'integrated';
    const recorded = updateTask({
      stateRoot: options.stateRoot,
      taskId: task.taskId,
      expectedRevision: task.stateRevision,
      transitionTo: integratedReturn ? 'blocked' : 'needs_rework',
      event: 'user-reject',
      metricReasonCategory: reasonCategory,
      metricNote: options.note,
      mutate(next) {
        next.userAcceptance = { decision: 'rejected', note: options.note ?? null, decidedAt: new Date().toISOString() };
        next.deliveryDecision = { decision:'needs_rework', reasons:['user-return'] };
        invalidateReturnedDeliveryProof(next, 'user-return');
        return integratedReturn ? markReturnWorkspaceRecoveryRequired(next) : next;
      }
    });
    return integratedReturn ? recoverReturnedTaskWorkspace(options, recorded) : recorded;
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

const CLOSING_FOLLOW_UP_EVENTS = {
  'scope-extension': 'conversation-scope-extension',
  'positive-acknowledgement': 'conversation-positive-acknowledgement',
  'topic-advance': 'conversation-topic-advance',
};

function normalizedObservationId(value) {
  const observationId = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(observationId)) {
    throw new Error('observation-id 必须是 1～200 位不透明标识，只能包含字母、数字、点、下划线、冒号或连字符');
  }
  return observationId;
}

export function recordTaskFollowUp(options = {}) {
  const current = findTask({ stateRoot: options.stateRoot, taskId: options.taskId });
  const task = current.task;
  const conversationOutcome = normalizeConversationOutcome(task.conversationOutcome);
  if (!conversationOutcome) throw new Error('任务没有可关联的交付 continuation');
  const deliveryId = String(options.deliveryId ?? '').trim();
  if (!deliveryId || deliveryId !== conversationOutcome.deliveryId) {
    throw new Error('delivery-id 与当前交付不匹配，旧交付或其他 Task 不能回写');
  }
  const kind = String(options.kind ?? '').trim();
  if (!FOLLOW_UP_KINDS.has(kind)) throw new Error(`后续类型无效: ${kind || 'unknown'}`);
  const observationId = normalizedObservationId(options.observationId);
  const existing = (conversationOutcome.observations ?? [])
    .find((item) => item?.observationId === observationId);
  if (existing) {
    if (existing.kind !== kind) throw new Error('同一 observation-id 不能记录为不同后续类型');
    return {
      ...current,
      recorded: false,
      idempotent: true,
      followUp: { kind, observationId },
    };
  }
  if (current.source === 'history' || task.status === 'closed') throw new Error('任务已经根据后续对话收口');
  if (task.status !== 'waiting_acceptance') throw new Error(`任务当前不能记录交付后续: ${task.status}`);
  const closingEvent = CLOSING_FOLLOW_UP_EVENTS[kind];
  const integratedReturn = kind === 'defect-return' && task.integration?.status === 'integrated';
  const transitionTo = kind === 'defect-return'
    ? (integratedReturn ? 'blocked' : 'needs_rework')
    : closingEvent
      ? 'closed'
      : 'waiting_acceptance';
  const event = kind === 'defect-return'
    ? 'conversation-defect-return'
    : closingEvent ?? 'conversation-related-question';
  const updated = updateTask({
    stateRoot: options.stateRoot,
    taskId: task.taskId,
    expectedRevision: task.stateRevision,
    transitionTo,
    event,
    mutate(next) {
      next.conversationOutcome = observeConversationFollowUp(next.conversationOutcome, {
        kind,
        observationId,
        observedAt: new Date().toISOString(),
        terminal: kind !== 'related-question',
      });
      if (kind === 'defect-return') {
        next.deliveryDecision = { decision: 'needs_rework', reasons: ['conversation-defect-return'] };
        invalidateReturnedDeliveryProof(next, 'conversation-defect-return');
        if (integratedReturn) markReturnWorkspaceRecoveryRequired(next);
      }
      return next;
    },
  });
  const recovered = integratedReturn ? recoverReturnedTaskWorkspace(options, updated) : updated;
  return {
    ...recovered,
    recorded: true,
    idempotent: false,
    followUp: {
      kind,
      observationId,
      ...(kind === 'scope-extension' ? { parentTaskId: task.taskId, relation: 'scope-extension' } : {}),
    },
  };
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
  if (task.status === 'blocked' && [RETURN_WORKSPACE_REQUIRED, RETURN_WORKSPACE_FAILED].includes(task.verification?.stopReason)) {
    return recoverReturnedTaskWorkspace(options, current, 'resume');
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
  const legacyIntegrationBudget = ['needs_rework','verifying'].includes(task.status)
    && task.verification?.stopReason === 'integration-check-budget';
  const integrationBudget = task.status === 'ready_to_integrate' && task.verification?.stopReason === 'budget';
  const integratedRevalidationBudget = task.status === 'verifying'
    && task.integration?.status === 'integrated'
    && task.verification?.stopReason === 'budget';
  const ordinaryBudget = ['saved','waiting_acceptance','verifying'].includes(task.status)
    && task.verification?.stopReason === 'budget';
  if (!ordinaryBudget && !integrationBudget && !legacyIntegrationBudget && !integratedRevalidationBudget) {
    throw new Error('只有因验证预算耗尽而暂停的 Task 才能继续验证');
  }
  const budget = extendBudget(task.verification.budget, {
    additionalMs:options.additionalBudgetMs,
    reason:options.reason,
  });
  const resumeIntegration = integrationBudget || legacyIntegrationBudget;
  const changeSet = (resumeIntegration || integratedRevalidationBudget) ? task.changeSet : computeChangeSet(task.baseline);
  return updateTask({
    stateRoot:options.stateRoot,
    taskId:task.taskId,
    expectedRevision:task.stateRevision,
    transitionTo:resumeIntegration ? 'ready_to_integrate' : 'verifying',
    event:'verification-continue',
    mutate(next) {
      next.changeSet = changeSet;
      next.handoff = null;
      next.blockers = withoutDerivedBlockers(next.blockers ?? []);
      next.verification = {
        ...next.verification,
        budget,
        stopReason:integratedRevalidationBudget ? 'integration-revalidation-budget-extended' : 'budget-extended',
      };
      if (resumeIntegration && next.integration) {
        next.integration = { ...next.integration, status:'ready', pauseReasons:[], diagnostic:null };
        next.deliveryDecision = { decision:'ready_to_integrate', reasons:[] };
      }
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
