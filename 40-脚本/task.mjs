#!/usr/bin/env node
import { parseArgs, listArg, requiredArg } from './lib/args.mjs';
import {
  prepareTask,
  deliverTask,
  acceptTask,
  saveTask,
  resumeTask,
  recordHandoff,
  cancelTask,
  findTask,
  listTasks,
} from './lib/task-runner.mjs';
import { createExperienceCandidate, saveExperienceCandidate } from './lib/experience-candidate.mjs';

const args = parseArgs(process.argv.slice(2));
const aliases = new Map([
  ['prepare', '准备'], ['deliver', '交付'], ['accept', '验收'], ['review', '审查'],
  ['handoff', '交接'], ['resume', '恢复'], ['show', '查看'], ['list', '列表'],
  ['save', '保存'], ['cancel', '取消'], ['experience', '整理经验'],
]);
const action = aliases.get(args._[0]) ?? args._[0] ?? '帮助';

function nextAction(status) {
  return {
    prepared: '读取 filesToRead，并在授权 Scope 内实施。',
    needs_rework: '修复验证或规格问题后重新交付。',
    waiting_acceptance: '等待用户验收。',
    saved: '需要继续时恢复 Task。',
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

  if (task.verification) {
    receipt.verification = {
      missingAcceptance: task.verification.missingAcceptance ?? [],
      missingCovers: task.verification.missingCovers ?? [],
      stopReason: task.verification.stopReason ?? null,
    };
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

  const next = nextAction(task.status);
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
       [--spec-impact none|updated|decision-required] [--spec-impact-reason <text>] [--spec-id <ID>]
  交付 --task-id <id> [--evidence-file <json>] [--review-file <json>]
       [--spec-impact ...] [--spec-impact-reason <text>] [--spec-id <ID>]
  审查 --task-id <id> --review-file <json>
  验收 --task-id <id> --decision 通过|退回
  整理经验 --task-id <accepted-id> --root-cause <text> --action <text> --boundary <text>
       [--keyword <text>] [--verification <text>]
  保存|恢复|交接|查看|列表|取消

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
    }));
  } else if (action === '交付' || action === '审查') {
    output(deliverTask({
      stateRoot: args['state-root'],
      taskId: requiredArg(args, 'task-id'),
      evidenceFile: args['evidence-file'],
      reviewFile: args['review-file'],
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
  } else if (action === '验收') {
    output(acceptTask({
      stateRoot: args['state-root'],
      taskId: requiredArg(args, 'task-id'),
      decision: requiredArg(args, 'decision'),
      note: args.note,
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
    output(listTasks({ stateRoot: args['state-root'] }));
  } else help();
} catch (error) {
  console.error(`任务失败: ${error.message}`);
  process.exitCode = 1;
}
