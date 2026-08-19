#!/usr/bin/env node
import { parseArgs, listArg, requiredArg } from './lib/args.mjs';
import {
  prepareTask,
  deliverTask,
  realignTask,
  acceptTask,
  saveTask,
  resumeTask,
  continueVerification,
  recordHandoff,
  confirmIntegration,
  revalidateIntegration,
  cancelTask,
  findTask,
  listTasks,
} from './lib/task-runner.mjs';
import { createExperienceCandidate, saveExperienceCandidate } from './lib/experience-candidate.mjs';
import { findGitRoot } from './lib/registry.mjs';

const args = parseArgs(process.argv.slice(2));
const aliases = new Map([
  ['prepare', '准备'], ['deliver', '交付'], ['accept', '验收'], ['review', '审查'],
  ['realign', '重新对齐'],
  ['handoff', '交接'], ['resume', '恢复'], ['show', '查看'], ['list', '列表'],
  ['save', '保存'], ['cancel', '取消'], ['experience', '整理经验'], ['integrate', '集成'],
  ['continue-verification', '继续验证'],
  ['revalidate-integration', '重验集成'],
]);
const action = aliases.get(args._[0]) ?? args._[0] ?? '帮助';

function nextAction(status) {
  return {
    prepared: '读取 filesToRead，并在授权 Scope 内实施。',
    needs_rework: '修复验证或规格问题后重新交付；若暂不继续，运行“保存”显式释放当前工作树。',
    ready_to_integrate: '由中央工作区将 resultCommit 集成到目标分支，然后运行“集成”。',
    waiting_acceptance: '等待用户验收。',
    verifying: '运行“交付”继续验证。',
    saved: '需要继续时恢复 Task；恢复会重新竞争原工作树写权限。',
  }[status];
}

function compactTask(task, result) {
  const receipt = {
    schemaVersion: 1,
    view: 'summary',
    taskSchemaVersion: task.schemaVersion,
    taskId: task.taskId,
    status: task.status,
    stateRevision: task.stateRevision,
  };

  if (task.goal?.summary) receipt.goal = task.goal.summary;
  if (task.goal?.expectedOutcomes) receipt.expectedOutcomes = task.goal.expectedOutcomes;
  if (task.goal?.protectedBehaviors) receipt.protectedBehaviors = task.goal.protectedBehaviors;
  if (task.goal?.alignment) {
    receipt.alignment = {
      mode: task.goal.alignment.mode,
      revision: task.goal.alignment.revision,
      baselineFingerprint: task.goal.alignment.baselineFingerprint,
      reasonCodes: task.goal.alignment.reasonCodes ?? [],
      decisionNote: task.goal.alignment.decisionNote ?? null,
      delegatedTopics: task.goal.alignment.delegatedTopics ?? [],
    };
  }

  if (action === '准备' || action === '查看') {
    receipt.acceptance = (task.acceptance ?? []).map(({ id, description, requiredCovers }) => ({
      id,
      description,
      requiredCovers,
    }));
    receipt.scope = task.authorization?.scope ?? [];
    receipt.filesToRead = task.context?.filesToRead ?? [];
  }

  if (task.changeSet) {
    receipt.changeSet = {
      fingerprint: task.changeSet.fingerprint,
      files: (task.changeSet.files ?? []).map(({ path, status }) => ({ path, status })),
    };
  }
  if (task.changeRationale) {
    receipt.changeRationale = {
      provided: task.changeRationale.provided,
      ok: task.changeRationale.ok,
      invalid: task.changeRationale.invalid ?? [],
      unmappedFiles: task.changeRationale.unmappedFiles ?? [],
    };
  }

  if (task.integration) {
    receipt.integration = {
      status: task.integration.status,
      target: task.integration.target,
      baseCommit: task.integration.baseCommit,
      resultCommit: task.integration.resultCommit,
      pendingRef: task.integration.pendingRef,
      targetCommit: task.integration.targetCommit,
      revalidatedAt: task.integration.revalidatedAt ?? null,
    };
  }

  if (task.verification) {
    receipt.verification = {
      missingAcceptance: task.verification.missingAcceptance ?? [],
      missingCovers: task.verification.missingCovers ?? [],
      stopReason: task.verification.stopReason ?? null,
    };
    if (task.verification.budget) {
      receipt.verification.budget = {
        limitMs:task.verification.budget.limitMs,
        spentMs:task.verification.budget.spentMs,
        extensionCount:task.verification.budget.extensions?.length ?? 0,
      };
    }
    if (task.verification.firstFailure) receipt.verification.firstFailure = task.verification.firstFailure;
    if ((task.verification.untrustedTechnicalEvidence ?? []).length > 0) {
      receipt.verification.untrustedTechnicalEvidence = task.verification.untrustedTechnicalEvidence;
    }
  }

  if (task.specImpact) {
    receipt.specImpact = {
      level: task.specImpact.level,
      declared: task.specImpact.declared,
      reason: task.specImpact.reason,
      affectedSpecificationIds: task.specImpact.affectedSpecificationIds ?? [],
    };
  }

  if ((task.blockers?.length ?? 0) > 0) receipt.blockers = task.blockers;
  if ((task.residualRisks?.length ?? 0) > 0) receipt.residualRisks = task.residualRisks;
  if (task.deliveryDecision) receipt.deliveryDecision = task.deliveryDecision;
  if (result?.filePath) receipt.recordPath = result.filePath;
  if (result?.source) receipt.recordSource = result.source;

  const stopReason = String(task.verification?.stopReason ?? '');
  const next = stopReason === 'alignment-required' || stopReason === 'alignment-risk-escalation'
    ? `运行“重新对齐 --task-id ${task.taskId} --alignment-file <json> --reason <原因>”，使用 confirmed/delegated Alignment 完成对齐后重新交付。`
    : stopReason === 'budget'
      ? '由用户运行“继续验证 --additional-budget-ms <毫秒> --reason <原因>”有界追加预算。'
      : stopReason.startsWith('integration-')
        ? '修复目标分支或检查问题后，再次运行“重验集成”。'
        : nextAction(task.status);
  if (next) receipt.next = next;

  return receipt;
}

function compactTaskList(result) {
  const counts = {};
  for (const task of result.tasks ?? []) counts[task.status] = (counts[task.status] ?? 0) + 1;
  return {
    schemaVersion: 1,
    view: 'summary',
    counts,
    tasks: (result.tasks ?? []).map(task => ({
      taskId: task.taskId,
      status: task.status,
      goal: task.goal?.summary,
      updatedAt: task.updatedAt,
      blockerCount: task.blockers?.length ?? 0,
    })),
    stateRoot: result.stateRoot,
  };
}

function output(result) {
  let value;
  if (args.full === true) value = result?.task ?? result;
  else if (result?.task) value = compactTask(result.task, result);
  else if (Array.isArray(result?.tasks)) value = compactTaskList(result);
  else value = result;
  console.log(JSON.stringify(value, null, 2));
}

function help() {
  console.log(`AI 研发操作系统 V2.2.1：
  准备 --cwd <path> --intent <text> [--acceptance <text>] [--scope <relative>]
       [--alignment-file <json>（目标对齐文件，含 goal/expectedOutcomes/protectedBehaviors/acceptance/alignment.mode）]
       [--workstation <业务领域工作站 id>]
       [--allow-existing-change <relative>（用户明确授权继续修改已有变更，可重复）]
       [--integration-target <目标分支>（linked/detached worktree 必填）]
       [--spec-impact none|updated|decision-required] [--spec-impact-reason <text>] [--spec-id <ID>]
  交付 --task-id <id> [--evidence-file <json>] [--review-file <json>]
       [--rationale-file <json>（ChangeSet → Goal/Acceptance 映射，Standard/Controlled 对齐任务必填）]
       [--spec-impact ...] [--spec-impact-reason <text>] [--spec-id <ID>]
  重新对齐 --task-id <id> --alignment-file <json> --reason <text>
       （仅 confirmed/delegated；不改变 Scope、外部授权与集成目标，清空旧验证产物）
  审查 --task-id <id> --review-file <json>
  集成 --task-id <id> [--cwd <目标仓库>] [--target <目标分支>]
  重验集成 --task-id <id> [--cwd <目标仓库>] [--target <目标分支>]
  继续验证 --task-id <id> --additional-budget-ms <毫秒> --reason <原因>
  验收 --task-id <id> --decision 通过|退回
  整理经验 --task-id <accepted-id> --root-cause <text> --action <text> --boundary <text>
       [--keyword <text>] [--verification <text>]
  保存 --task-id <id>（暂停并释放工作树写占用）
  恢复 --task-id <id>（重新竞争原工作树写权限）
  交接|查看|取消
  列表 [--cwd <path>] [--limit <数量，0=全部>] [--all-projects]

输出默认是轻量回执；诊断或审计时追加 --full 查看完整 Context 或 Task。

普通问答不建 Task；只读分析走 build-context；仓库写任务必须先准备、后交付，最终验收只能由用户执行。`);
}

try {
  if (action === '准备') {
    output(prepareTask({
      stateRoot: args['state-root'],
      cwd: args.cwd ?? process.cwd(),
      intent: requiredArg(args, 'intent'),
      acceptance: listArg(args.acceptance),
      alignmentFile: args['alignment-file'],
      scope: args.scope ?? '.',
      projectId: args.project,
      skills: listArg(args.skill),
      tracked: args.ephemeral !== true,
      handoffRequired: args.handoff === true,
      specImpact: args['spec-impact'],
      specImpactReason: args['spec-impact-reason'],
      affectedSpecificationIds: listArg(args['spec-id']),
      budgetMs: args['budget-ms'] ? Number(args['budget-ms']) : undefined,
      nonGoals: listArg(args['non-goal']),
      allowedExistingChanges: listArg(args['allow-existing-change']),
      explicitReviewRequirement: args['require-review'] ? {
        kind: String(args['require-review']),
        minimumDecision: args['review-minimum'] ?? 'passed',
        reviewer: args.reviewer ?? null,
        description: args['review-description'] ?? '用户或项目明确要求 Review',
      } : null,
      integrationTarget: args['integration-target'],
      workstation: args.workstation,
    }));
  } else if (action === '交付' || action === '审查') {
    output(deliverTask({
      stateRoot: args['state-root'],
      taskId: requiredArg(args, 'task-id'),
      evidenceFile: args['evidence-file'],
      reviewFile: args['review-file'],
      rationaleFile: args['rationale-file'],
      autoChecks: action === '审查' ? false : args['no-auto-checks'] !== true,
      inputChange: args['input-change'],
      inputChangeReason: args['input-change-reason'],
      diagnosticRetry: args['diagnostic-retry'] === true,
      observableBrowserBehavior: args['observable-browser-behavior'] === true,
      residualRisks: listArg(args.risk),
      forceMode: args['force-mode'],
      forceReason: args['force-reason'],
      specImpact: args['spec-impact'],
      specImpactReason: args['spec-impact-reason'],
      affectedSpecificationIds: listArg(args['spec-id']),
      affectedSpecificationIdsProvided: args['spec-id'] !== undefined,
    }));
  } else if (action === '重新对齐') {
    output(realignTask({
      stateRoot: args['state-root'],
      taskId: requiredArg(args, 'task-id'),
      alignmentFile: requiredArg(args, 'alignment-file'),
      reason: args.reason,
    }));
  } else if (action === '验收') {
    output(acceptTask({
      stateRoot: args['state-root'],
      taskId: requiredArg(args, 'task-id'),
      decision: requiredArg(args, 'decision'),
      note: args.note,
    }));
  } else if (action === '集成') {
    output(confirmIntegration({
      stateRoot: args['state-root'],
      taskId: requiredArg(args, 'task-id'),
      cwd: args.cwd ?? process.cwd(),
      target: args.target,
    }));
  } else if (action === '重验集成') {
    output(revalidateIntegration({
      stateRoot:args['state-root'],
      taskId:requiredArg(args, 'task-id'),
      cwd:args.cwd ?? process.cwd(),
      target:args.target,
    }));
  } else if (action === '继续验证') {
    output(continueVerification({
      stateRoot:args['state-root'],
      taskId:requiredArg(args, 'task-id'),
      additionalBudgetMs:Number(requiredArg(args, 'additional-budget-ms')),
      reason:requiredArg(args, 'reason'),
    }));
  } else if (action === '保存') {
    output(saveTask({ stateRoot: args['state-root'], taskId: requiredArg(args, 'task-id') }));
  } else if (action === '恢复') {
    output(resumeTask({ stateRoot: args['state-root'], taskId: requiredArg(args, 'task-id') }));
  } else if (action === '交接') {
    output(recordHandoff({ stateRoot: args['state-root'], taskId: requiredArg(args, 'task-id'), next: args.next }));
  } else if (action === '取消') {
    output(cancelTask({ stateRoot: args['state-root'], taskId: requiredArg(args, 'task-id'), note: args.note }));
  } else if (action === '整理经验') {
    const record = findTask({ stateRoot: args['state-root'], taskId: requiredArg(args, 'task-id') });
    const projectRoot = args.cwd ?? record.task.baseline?.gitRoot;
    if (!projectRoot) throw new Error('无法确定项目根目录，请提供 --cwd');
    const candidate = createExperienceCandidate(record.task, {
      trigger: args.trigger,
      rootCause: args['root-cause'],
      action: args.action,
      boundary: args.boundary,
      verification: listArg(args.verification),
      keywords: listArg(args.keyword),
    });
    output(saveExperienceCandidate(projectRoot, candidate));
  } else if (action === '查看') {
    output(findTask({ stateRoot: args['state-root'], taskId: requiredArg(args, 'task-id') }));
  } else if (action === '列表') {
    const allProjects = args['all-projects'] === true;
    const gitRoot = allProjects ? null : findGitRoot(args.cwd ?? process.cwd());
    if (!allProjects && !gitRoot) {
      throw new Error('Task 列表默认按当前 Git 项目过滤；请在 Git 工作树中运行，或显式使用 --all-projects');
    }
    const limit = args.limit === undefined ? 10 : Number(args.limit);
    if (!Number.isInteger(limit) || limit < 0) throw new Error('--limit 必须是大于等于 0 的整数');
    output(listTasks({
      stateRoot: args['state-root'],
      gitRoot,
      limit,
    }));
  } else help();
} catch (error) {
  console.error(`任务失败: ${error.message}`);
  process.exitCode = 1;
}
