#!/usr/bin/env node
import fs from 'node:fs';
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
import { findGitRoot, normalizePath } from './lib/registry.mjs';
import { diagnoseState, readHistory } from './lib/state-manager.mjs';
import { publicTaskState, summarizeOutcomeMetrics } from './lib/outcome-metrics.mjs';

const SYSTEM_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const args = parseArgs(process.argv.slice(2));
const aliases = new Map([
  ['prepare', '准备'], ['deliver', '交付'], ['accept', '验收'], ['review', '审查'],
  ['realign', '重新对齐'],
  ['handoff', '交接'], ['resume', '恢复'], ['show', '查看'], ['list', '列表'],
  ['save', '保存'], ['cancel', '取消'], ['experience', '整理经验'], ['integrate', '集成'],
  ['continue-verification', '继续验证'],
  ['revalidate-integration', '重验集成'],
  ['diagnose-state', '诊断状态'],
  ['metrics', '评估摘要'], ['outcome-metrics', '评估摘要'],
]);
const action = aliases.get(args._[0]) ?? args._[0] ?? '帮助';

function nextAction(status) {
  return {
    prepared: '已完成准备，接下来读取相关文件并在授权范围内实现。',
    implementing: '正在实现目标结果。',
    reviewing: '正在检查实现质量。',
    needs_rework: '当前结果仍需修正；修正后重新验证。',
    ready_to_integrate: '代码已准备好集成；完成目标分支集成和重验后再交给你验收。',
    waiting_acceptance: '结果已具备验收条件，请检查并决定通过或退回。',
    verifying: '仍有结果缺少验证，补齐后继续。',
    saved: '任务已暂停，需要你决定是否继续。',
    blocked: '任务被阻止，需要先处理上面的阻塞原因。',
  }[status];
}

function evidenceLabel(cover) {
  return {
    behavior: '行为验证',
    documentation: '文档检查',
    'negative-path': '失败路径验证',
    'target-environment': '目标环境验证',
    browser: '浏览器验证',
    build: '构建验证',
    integration: '集成验证',
  }[cover] ?? String(cover);
}

function compactOutcomes(task) {
  const acceptance = task.acceptance ?? [];
  if (!acceptance.length) return [];
  const hasDelivery = Boolean(task.deliveryDecision || task.changeSet);
  const missingAcceptance = task.verification?.missingAcceptance;
  const verificationResolved = Array.isArray(missingAcceptance);
  const missing = new Set(missingAcceptance ?? []);
  return acceptance.map(item => ({
    id: item.id,
    description: item.description,
    source: item.source ?? null,
    status:
      !hasDelivery
        ? 'pending'
        : !verificationResolved
          ? 'unverified'
          : missing.has(item.id)
            ? 'unverified'
            : 'verified',
  }));
}

function compactTask(task, result) {
  const publicState = publicTaskState(task.status);
  const receipt = {
    schemaVersion: 2,
    view: 'outcome',
    taskId: task.taskId,
    state: publicState.id,
    stateLabel: publicState.label,
  };

  if (task.goal?.summary) receipt.goal = task.goal.summary;
  if (task.goal?.expectedOutcomes) receipt.expectedOutcomes = task.goal.expectedOutcomes;
  if (task.goal?.protectedBehaviors) receipt.protectedBehaviors = task.goal.protectedBehaviors;

  if (action === '准备' || action === '查看') {
    receipt.acceptance = (task.acceptance ?? []).map(({ id, description }) => ({
      id,
      description,
    }));
    receipt.scope = (task.authorization?.scope ?? []).map(item => item.path);
    receipt.filesToRead = task.context?.filesToRead ?? [];
  }
  receipt.outcomes = compactOutcomes(task);
  const verifiedCount = receipt.outcomes.filter(item => item.status === 'verified').length;
  receipt.result = {
    verifiedOutcomes: verifiedCount,
    totalOutcomes: receipt.outcomes.length,
    allOutcomesVerified: receipt.outcomes.length > 0 && verifiedCount === receipt.outcomes.length,
  };

  if (task.changeSet) {
    receipt.changes = (task.changeSet.files ?? []).map(({ path, status }) => ({ path, status }));
  }

  if (task.integration) {
    receipt.integration = {
      target: task.integration.target,
      ready: ['ready', 'integrated'].includes(task.integration.status),
      integrated: task.integration.status === 'integrated',
    };
  }

  if (task.verification) {
    if ((task.verification.acceptanceGaps?.length ?? 0) > 0) {
      receipt.gaps = task.verification.acceptanceGaps.map(gap => ({
        outcomeId: gap.acceptanceId,
        description: gap.description,
        missingEvidence: (gap.missingCovers ?? []).map(evidenceLabel),
      }));
    }
    if (task.verification.firstFailure) {
      receipt.issue = {
        kind: 'check-failed',
        check: task.verification.firstFailure.name,
        exitCode: task.verification.firstFailure.exitCode,
        output: task.verification.firstFailure.output,
        truncated: task.verification.firstFailure.truncated,
      };
    }
    if ((task.verification.untrustedTechnicalEvidence ?? []).length > 0) {
      receipt.warnings = [
        ...(receipt.warnings ?? []),
        `${task.verification.untrustedTechnicalEvidence.length} 条外部技术结果未被作为验收证明`,
      ];
    }
  }

  if (task.specImpact && task.specImpact.level !== 'none') {
    receipt.specification = {
      impact: task.specImpact.level,
      reason: task.specImpact.reason,
      affectedSpecificationIds: task.specImpact.affectedSpecificationIds ?? [],
    };
  }

  if ((task.blockers?.length ?? 0) > 0) receipt.blockers = task.blockers;
  if ((task.residualRisks?.length ?? 0) > 0) receipt.residualRisks = task.residualRisks;

  const stopReason = String(task.verification?.stopReason ?? '');
  const missingAcceptance = task.verification?.missingAcceptance ?? [];
  const acceptanceGaps = task.verification?.acceptanceGaps ?? [];
  const gapText = acceptanceGaps.length
    ? `验收项 ${acceptanceGaps.map(gap => {
      const coverNote = (gap.missingCovers ?? []).length
        ? `还缺少${(gap.missingCovers ?? []).map(evidenceLabel).join('、')}`
        : '尚未被可信证明';
      return `${gap.acceptanceId}（${gap.description}）${coverNote}`;
    }).join('；')}；优先运行现有针对性测试，没有则补一个最小定点测试。`
    : missingAcceptance.length
      ? `验收项 ${missingAcceptance.map(id => {
        const item = task.acceptance?.find(entry => entry.id === id);
        return item ? `${id}（${item.description}）` : id;
      }).join('、')} 尚未被可信证明；优先运行现有针对性测试，没有则补一个最小定点测试。`
    : null;
  const next = stopReason === 'alignment-required' || stopReason === 'alignment-risk-escalation'
    ? '需要重新对齐目标或授权边界；确认后宿主会自动更新内部结构并继续。'
    : stopReason === 'budget'
      ? '验证预算已用完，需要你明确决定是否追加有限预算。'
      : stopReason.startsWith('integration-')
        ? '目标分支集成或重验尚未完成；处理首个问题后再继续。'
        : gapText ?? nextAction(task.status);
  if (next) receipt.next = next;

  return receipt;
}

function compactTaskList(result) {
  const counts = { working: 0, needs_decision: 0, ready_for_acceptance: 0, done: 0 };
  for (const task of result.tasks ?? []) {
    const state = publicTaskState(task.status).id;
    counts[state] += 1;
  }
  return {
    schemaVersion: 2,
    view: 'outcome-list',
    counts,
    tasks: (result.tasks ?? []).map(task => ({
      taskId: task.taskId,
      state: publicTaskState(task.status).id,
      stateLabel: publicTaskState(task.status).label,
      goal: task.goal?.summary,
      updatedAt: task.updatedAt,
      blockerCount: task.blockers?.length ?? 0,
    })),
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
  if (args.full !== true) {
    console.log(`AI 研发操作系统 V${SYSTEM_VERSION}：
  准备 --cwd <path> --intent <text> [--acceptance <text>] [--scope <relative>]
       [--allow-existing-change <relative>（用户明确授权继续修改已有变更，可重复）]
  交付 --task-id <id>
  验收 --task-id <id> --decision 通过|退回 [--note <原因>]
  继续验证 --task-id <id> --additional-budget-ms <毫秒> --reason <原因>
  保存|恢复|交接|查看|取消 --task-id <id>
  列表 [--cwd <path>] [--limit <数量，0=全部>] [--all-projects]
  评估摘要 [--cwd <path>] [--from <日期>] [--to <日期>] [--all-projects]
  诊断状态 [--state-root <path>]（只读，不修复、不迁移）

默认只返回四种用户状态和结果信息。Alignment、Rationale、Task Check 等机器交换产物由宿主自动处理；运行“帮助 --full”查看宿主协议，运行具体命令时追加 --full 查看完整 Task。`);
    return;
  }
  console.log(`AI 研发操作系统 V${SYSTEM_VERSION} 宿主协议：
  准备 --cwd <path> --intent <text> [--acceptance <text>] [--scope <relative>]
       [--alignment-file <json>（目标对齐文件，含 goal/expectedOutcomes/protectedBehaviors/acceptance/alignment.mode）]
       [--goal-card-file <json>（--alignment-file 的语义别名，二选一）]
       [--workstation <业务领域工作站 id>]
       [--allow-existing-change <relative>（用户明确授权继续修改已有变更，可重复）]
       [--integration-target <目标分支>（linked/detached worktree 必填）]
       [--spec-impact none|updated|decision-required] [--spec-impact-reason <text>] [--spec-id <ID>]
  交付 --task-id <id> [--evidence-file <json>] [--review-file <json>]
       [--rationale-file <json>（ChangeSet → Goal/Acceptance 映射，Controlled/Structural 或严格行为保持任务必填，其他可选）]
       [--task-check-file <json>（仅声明受控 runner/testFiles/config，并显式绑定具体 Acceptance）]
       [--spec-impact ...] [--spec-impact-reason <text>] [--spec-id <ID>]
  重新对齐 --task-id <id> --alignment-file <json>|--goal-card-file <json> --reason <text>
       （仅 confirmed/delegated；不改变 Scope、外部授权与集成目标，清空旧验证产物）
  审查 --task-id <id> --review-file <json>
  集成 --task-id <id> [--cwd <目标仓库>] [--target <目标分支>]
  重验集成 --task-id <id> [--cwd <目标仓库>] [--target <目标分支>]
  继续验证 --task-id <id> --additional-budget-ms <毫秒> --reason <原因>
  验收 --task-id <id> --decision 通过|退回 [--note <原因>]
       [--reason-category goal-mismatch|scope|verification-gap|code-quality|regression|unnecessary-change|other]
  整理经验 --task-id <accepted-id> --root-cause <text> --action <text> --boundary <text>
       [--keyword <text>] [--verification <text>]
  保存 --task-id <id>（暂停并释放工作树写占用）
  恢复 --task-id <id>（重新竞争原工作树写权限）
  交接|查看|取消
  列表 [--cwd <path>] [--limit <数量，0=全部>] [--all-projects]
  评估摘要 [--cwd <path>] [--from <日期>] [--to <日期>] [--all-projects]
  诊断状态 [--state-root <path>]（只读，不修复、不迁移）

输出默认是轻量回执；诊断或审计时追加 --full 查看完整 Context 或 Task。

普通问答不建 Task；只读分析走 build-context；仓库写任务必须先准备、后交付，最终验收只能由用户执行。`);
}

try {
  if (action === '准备') {
    if (args['alignment-file'] && args['goal-card-file']) {
      throw new Error('--alignment-file 与 --goal-card-file 只能提供一个');
    }
    output(prepareTask({
      stateRoot: args['state-root'],
      cwd: args.cwd ?? process.cwd(),
      intent: requiredArg(args, 'intent'),
      acceptance: listArg(args.acceptance),
      alignmentFile: args['alignment-file'] ?? args['goal-card-file'],
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
      taskCheckFile: args['task-check-file'],
      reviewFile: args['review-file'],
      rationaleFile: args['rationale-file'],
      autoChecks: action === '审查' ? false : args['no-auto-checks'] !== true,
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
    if (args['alignment-file'] && args['goal-card-file']) {
      throw new Error('--alignment-file 与 --goal-card-file 只能提供一个');
    }
    output(realignTask({
      stateRoot: args['state-root'],
      taskId: requiredArg(args, 'task-id'),
      alignmentFile: args['alignment-file'] ?? args['goal-card-file'] ?? requiredArg(args, 'alignment-file'),
      reason: args.reason,
    }));
  } else if (action === '验收') {
    output(acceptTask({
      stateRoot: args['state-root'],
      taskId: requiredArg(args, 'task-id'),
      decision: requiredArg(args, 'decision'),
      note: args.note,
      reasonCategory: args['reason-category'],
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
  } else if (action === '诊断状态') {
    output(diagnoseState({ stateRoot: args['state-root'] }));
  } else if (action === '评估摘要') {
    const allProjects = args['all-projects'] === true;
    const gitRoot = allProjects ? null : findGitRoot(args.cwd ?? process.cwd());
    if (!allProjects && !gitRoot) {
      throw new Error('评估摘要默认按当前 Git 项目过滤；请在 Git 工作树中运行，或显式使用 --all-projects');
    }
    const active = listTasks({ stateRoot: args['state-root'], gitRoot, limit: 0 }).tasks;
    const history = readHistory({ stateRoot: args['state-root'] })
      .filter(task => !gitRoot || normalizePath(task.baseline?.gitRoot) === normalizePath(gitRoot));
    output(summarizeOutcomeMetrics([...active, ...history], { from: args.from, to: args.to }));
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
