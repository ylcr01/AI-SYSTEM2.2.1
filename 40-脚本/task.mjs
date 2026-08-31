#!/usr/bin/env node
import fs from 'node:fs';
import { parseArgs, listArg, requiredArg } from './lib/args.mjs';
import {
  preflightWorkspace,
  verifyLocalDirect,
  prepareTask,
  deliverTask,
  realignTask,
  recordTaskFollowUp,
  acceptTask,
  saveTask,
  resumeTask,
  continueVerification,
  recordHandoff,
  integrateTask,
  confirmIntegration,
  revalidateIntegration,
  cancelTask,
  findTask,
  listTasks,
  inspectAcceptanceEligibility,
  captureEvaluationContext,
} from './lib/task-runner.mjs';
import { createExperienceCandidate, saveExperienceCandidate } from './lib/experience-candidate.mjs';
import { findGitRoot } from './lib/registry.mjs';
import { captureRepositoryIdentity } from './lib/git-state.mjs';
import { diagnoseState, migrateState, readHistory, taskMatchesRepository } from './lib/state-manager.mjs';
import { publicTaskStateForTask, summarizeOutcomeMetrics } from './lib/outcome-metrics.mjs';
import { diagnoseLightOutcomeLedger, recordLightDelivery, recordLightFollowUp, readLightOutcomeTasks } from './lib/outcome-ledger.mjs';

const SYSTEM_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const args = parseArgs(process.argv.slice(2));
const aliases = new Map([
  ['preflight', '预检'],
  ['verify-local-direct', '复核直达'],
  ['prepare', '准备'], ['deliver', '交付'], ['accept', '验收'], ['review', '审查'],
  ['realign', '重新对齐'],
  ['follow-up', '后续'],
  ['record-light-delivery', '记录轻量交付'],
  ['handoff', '交接'], ['resume', '恢复'], ['show', '查看'], ['list', '列表'],
  ['save', '保存'], ['cancel', '取消'], ['experience', '整理经验'], ['integrate', '集成'],
  ['continue-verification', '继续验证'],
  ['revalidate-integration', '重验集成'],
  ['diagnose-state', '诊断状态'],
  ['migrate-state', '迁移状态'],
  ['metrics', '评估摘要'], ['outcome-metrics', '评估摘要'],
]);
const action = aliases.get(args._[0]) ?? args._[0] ?? '帮助';

function nextAction(status) {
  return {
    prepared: '已完成准备，接下来读取相关文件并在授权范围内实现。',
    implementing: '正在实现目标结果。',
    reviewing: '正在检查实现质量。',
    needs_rework: '当前结果仍需修正；修正后重新验证。',
    ready_to_integrate: '代码已准备好集成；低风险任务应由单一集成器直接集成和重验，无需等待用户再次确认。',
    waiting_acceptance: '本轮已交付；无需形式确认，后续相关消息会更新完成轮次或自然收口。',
    closed: '上一任务已根据后续对话自然收口。',
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
  const hasDelivery = Boolean(task.changeSet);
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

const RECEIPT_LIMITS = Object.freeze({
  changes: 20,
  defaultItems: 10,
});

function bounded(items, limit, map = item => item) {
  const source = Array.isArray(items) ? items : [];
  const projected = source.slice(0, limit).map(map);
  return {
    items: projected,
    summary: { total: source.length, shown: projected.length, truncated: source.length > projected.length },
  };
}

function assignBounded(receipt, key, items, limit = RECEIPT_LIMITS.defaultItems, map) {
  const projection = bounded(items, limit, map);
  receipt[key] = projection.items;
  receipt.projection ??= {};
  receipt.projection[key] = projection.summary;
  return projection.items;
}

function compactStandalone(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const compact = { ...value };
  for (const [key, limit] of Object.entries({ diagnostics:10, planned:10, applied:10, blockers:10 })) {
    if (!Array.isArray(value[key])) continue;
    const projection = bounded(value[key], limit);
    compact[key] = projection.items;
    compact.projection ??= {};
    compact.projection[key] = projection.summary;
  }
  for (const key of ['storageIntegrity', 'lightOutcomeLedger', 'acceptanceEligibility']) {
    if (value[key] && typeof value[key] === 'object') compact[key] = compactStandalone(value[key]);
  }
  return compact;
}

function compactTask(task, result = null) {
  const publicState = publicTaskStateForTask(task);
  const receipt = {
    schemaVersion: 2,
    view: 'outcome',
    taskId: task.taskId,
    state: publicState.id,
    stateLabel: publicState.label,
  };

  if (task.goal?.summary) receipt.goal = task.goal.summary;
  if (task.classification?.problemType) receipt.problemType = task.classification.problemType;
  if (task.outcomeMetrics?.measurementVersion === 'completion-rounds-v1') {
    receipt.completion = {
      currentRound: task.outcomeMetrics.firstQualifiedDeliveryAt
        ? 1 + Number(task.outcomeMetrics.relatedFollowUpCount ?? 0)
        : null,
      status: ['accepted', 'closed'].includes(task.status)
        ? 'completed'
        : task.status === 'waiting_acceptance'
          ? 'observing'
          : 'working',
    };
  }
  if (task.goal?.expectedOutcomes) assignBounded(receipt, 'expectedOutcomes', task.goal.expectedOutcomes);
  if (task.goal?.protectedBehaviors) assignBounded(receipt, 'protectedBehaviors', task.goal.protectedBehaviors);
  if (task.status === 'waiting_acceptance' && task.conversationOutcome?.deliveryId) {
    receipt.continuation = {
      taskId: task.taskId,
      deliveryId: task.conversationOutcome.deliveryId,
    };
  }
  if (result?.followUp) {
    receipt.followUp = {
      ...result.followUp,
      recorded: result.recorded,
      idempotent: result.idempotent,
    };
  }

  if (action === '准备' || action === '查看') {
    assignBounded(receipt, 'acceptance', task.acceptance, RECEIPT_LIMITS.defaultItems, ({ id, description }) => ({
      id,
      description,
    }));
    receipt.scope = (task.authorization?.scope ?? []).map(item => item.path);
    assignBounded(receipt, 'filesToRead', task.context?.filesToRead);
  }
  const allOutcomes = compactOutcomes(task);
  assignBounded(receipt, 'outcomes', allOutcomes);
  const verifiedCount = allOutcomes.filter(item => item.status === 'verified').length;
  receipt.result = {
    verifiedOutcomes: verifiedCount,
    totalOutcomes: allOutcomes.length,
    allOutcomesVerified: allOutcomes.length > 0 && verifiedCount === allOutcomes.length,
  };

  if (task.changeSet) {
    assignBounded(receipt, 'changes', task.changeSet.files, RECEIPT_LIMITS.changes, ({ path, status }) => ({ path, status }));
  }

  if (task.integration) {
    receipt.integration = {
      target: task.integration.target,
      ready: ['ready', 'integrated'].includes(task.integration.status),
      integrated: task.integration.status === 'integrated',
      status: task.integration.status,
      resultCommit: task.integration.resultCommit ?? null,
      targetCommit: task.integration.targetCommit ?? null,
      pauseReasons: task.integration.pauseReasons ?? [],
      conflictFiles: task.integration.conflictFiles ?? [],
      integrationWorktree: task.integration.integrationWorktree ?? null,
      cleanup: task.integration.cleanup ?? null,
    };
  }

  if (task.verification) {
    if ((task.verification.acceptanceGaps?.length ?? 0) > 0) {
      assignBounded(receipt, 'gaps', task.verification.acceptanceGaps, RECEIPT_LIMITS.defaultItems, gap => ({
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
        error: task.verification.firstFailure.error,
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
    if ((task.verification.auxiliaryEvidence ?? []).length > 0) {
      receipt.warnings = [
        ...(receipt.warnings ?? []),
        `${task.verification.auxiliaryEvidence.length} 条导入结果仅作为辅证，未直接闭合验收项`,
      ];
    }
    if (task.verification.browserSummary) receipt.browserSummary = task.verification.browserSummary;
  }

  if (task.specImpact && task.specImpact.level !== 'none') {
    receipt.specification = {
      impact: task.specImpact.level,
      reason: task.specImpact.reason,
      affectedSpecificationIds: task.specImpact.affectedSpecificationIds ?? [],
    };
  }

  if ((task.blockers?.length ?? 0) > 0) assignBounded(receipt, 'blockers', task.blockers);
  if ((task.residualRisks?.length ?? 0) > 0) assignBounded(receipt, 'residualRisks', task.residualRisks);

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
      : stopReason === 'integration-risk-user-decision'
        ? '集成存在需显式确认的风险；需要你决定是否授权风险集成并提供原因。'
        : stopReason.startsWith('integration-') && stopReason !== 'integration-evidence-sufficient'
          ? '目标分支集成或重验尚未完成；处理首个问题后再继续。'
        : gapText ?? nextAction(task.status);
  if (next) receipt.next = next;

  return receipt;
}

function compactTaskList(result) {
  const counts = { working: 0, needs_decision: 0, delivered: 0, done: 0 };
  for (const task of result.tasks ?? []) {
    const state = publicTaskStateForTask(task).id;
    counts[state] += 1;
  }
  return {
    schemaVersion: 2,
    view: 'outcome-list',
    counts,
    tasks: (result.tasks ?? []).map(task => {
      const state = publicTaskStateForTask(task);
      return {
        taskId: task.taskId,
        state: state.id,
        stateLabel: state.label,
        goal: task.goal?.summary,
        updatedAt: task.updatedAt,
        blockerCount: task.blockers?.length ?? 0,
      };
    }),
  };
}

function output(result) {
  let value;
  if (args.full === true) value = result?.task ?? result;
  else if (result?.task) value = compactTask(result.task, result);
  else if (Array.isArray(result?.tasks)) value = compactTaskList(result);
  else value = compactStandalone(result);
  console.log(JSON.stringify(value, null, 2));
}

function help() {
  if (args.full !== true) {
    console.log(`AI 研发操作系统 V${SYSTEM_VERSION}：
  预检 [--cwd <path>]（只读、返回 Local 直达或 Worktree 推荐路由）
  复核直达 --cwd <path> --baseline-head <commit> --baseline-git-root <path>
       --baseline-git-common-dir <path> (--baseline-branch <branch>|--baseline-detached) --intent <text>
       [--scope <relative>]
  准备 --cwd <path> --intent <text> [--acceptance <text>] [--scope <relative>（可重复）]
       （仅正式 Task 调用；必须从任务专属 Worktree 运行）
       [--allow-existing-change <relative>（用户明确授权继续修改已有变更，可重复）]
  交付 --task-id <id>
  后续 --task-id <id> --delivery-id <id> --observation-id <id>
       --kind related-question|defect-return|scope-extension|positive-acknowledgement|topic-advance
  验收 --task-id <id> --decision 通过|退回 [--note <原因>]
  继续验证 --task-id <id> --additional-budget-ms <毫秒> --reason <原因>
  保存|恢复|交接|查看|取消 --task-id <id>
  列表 [--cwd <path>] [--limit <数量，0=全部>] [--all-projects]
  记录轻量交付 --cwd <path> --commit <HEAD> --problem-type <类型> --scope <路径>（可重复）
       --baseline-head <commit> --baseline-git-root <path> --baseline-git-common-dir <path>
       --verified-change-fingerprint <sha256>
  评估摘要 [--cwd <path>] [--from <日期>] [--to <日期>] [--quiet-days <天数>] [--problem-type <类型>（可重复）] [--all-projects]
  诊断状态 [--state-root <path>]（只读，不修复、不迁移）
  迁移状态 [--state-root <path>] [--apply]（默认仅预演；写入前备份）

默认只返回四种用户状态和结果信息。Goal Card、Rationale、Task Check 等机器交换产物由宿主自动处理；运行“帮助 --full”查看宿主协议，运行具体命令时追加 --full 查看完整 Task。`);
    return;
  }
  console.log(`AI 研发操作系统 V${SYSTEM_VERSION} 宿主协议：
  预检|preflight [--cwd <path>] [--state-root <path>]（不加载工程上下文、不创建 Task；返回 writeRouting）
  复核直达|verify-local-direct --cwd <path> --baseline-head <commit>
       --baseline-git-root <path> --baseline-git-common-dir <path>
       (--baseline-branch <branch>|--baseline-detached) --intent <text>
       [--scope <relative>（可重复）] [--path <relative>（可重复）]
       （轻量写入完成后的无状态最终 Diff 复核；风险、越界、并发或 HEAD 变化时失败关闭）
  准备 --cwd <path> --intent <text> [--acceptance <text>] [--scope <relative>（可重复；不支持逗号或 glob）]
       （正式 Task 必须使用 Worktree；Codex managed 优先，不可用时使用 detached Worktree）
       [--goal-card-file <json>（Goal Card；兼容旧 --alignment-file，二选一）]
       [--quality-profile <name>（兼容旧 --skill，可重复）]
       [--allow-existing-change <relative>（用户明确授权继续修改已有变更，可重复）]
       [--integration-target <目标分支>（任务 Worktree 必填）]
       [--model <宿主声明 ID>] [--reasoning-effort <宿主声明档位>] [--execution-environment <宿主声明环境>]
       [--spec-impact none|updated|decision-required] [--spec-impact-reason <text>] [--spec-id <ID>]
  交付 --task-id <id> [--evidence-file <json>] [--review-file <json>]
       [--rationale-file <json>（ChangeSet → Goal/Acceptance 映射，Controlled/Structural 或严格行为保持任务必填，其他可选）]
       [--task-check-file <json>（Schema 2：受控 runner/cases，每个 case 显式绑定 Acceptance、Cover、测试文件与精确用例名）]
       [--spec-impact ...] [--spec-impact-reason <text>] [--spec-id <ID>]
  后续|follow-up --task-id <id> --delivery-id <id> --observation-id <id>
       --kind related-question|defect-return|scope-extension|positive-acknowledgement|topic-advance
       （只回写关联交付的最小对话事实；不保存消息正文、不运行检查、不自动创建 Task）
  记录轻量交付|record-light-delivery --cwd <path> --commit <当前 HEAD> --problem-type <类型> --scope <路径>（可重复）
       --baseline-head <commit> --baseline-git-root <path> --baseline-git-common-dir <path>
       --verified-change-fingerprint <复核直达回执的 verifiedSemanticFingerprint>
       [--task-id <缺陷退回后的原结果编号>] [--exclude-reason <原因>]
       [--model <宿主声明 ID>] [--reasoning-effort <宿主声明档位>] [--execution-environment <宿主声明环境>]
       （轻量直达验证并本地提交后由宿主自动调用；要求工作树干净，不执行 Push）
  重新对齐 --task-id <id> --goal-card-file <json> --reason <text>
       （仅 confirmed/delegated；不改变 Scope、外部授权与集成目标，清空旧验证产物）
  审查 --task-id <id> --review-file <json>
  集成 --task-id <id> [--target <目标分支>] [--keep-worktree]
       [--allow-risk-integration --risk-reason <原因>] [--confirm-only --cwd <目标仓库>]
       （默认在隔离集成 Worktree 应用、重验后快进目标分支并清理任务资源）
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
  评估摘要 [--cwd <path>] [--from <日期>] [--to <日期>] [--quiet-days <天数>]
       [--problem-type <类型>（可重复）] [--all-projects]
  诊断状态 [--state-root <path>]（只读，不修复、不迁移）
  迁移状态 [--state-root <path>] [--apply] [--migration-id <id>]
       （默认 dry-run；--apply 仅升级支持的旧 Schema 和修正非终态目录错位，写入前备份）

输出默认是轻量回执；诊断或审计时追加 --full 查看完整 Context 或 Task。

普通问答不建 Task；只读分析走 build-context。仓库修改先预检：continuity=ephemeral 的 Quick/普通 Standard 在干净、可用且无已知并发写入的 Local 直接做最小 Diff 与定点检查，验证通过后默认本地提交并记录轻量结果，不创建正式 Task 或重复集成；脏、占用、并发或不确定时进入 Worktree。Tracked、Controlled、Structural、规格、跨仓或外部写入才在 Worktree 准备正式 Task。显式验收是可选强事实，不是完成轮次统计的前置条件；任何路径都不得自动 Push。`);
}

function goalCardFileArg({ required = false } = {}) {
  const canonical = args['goal-card-file'];
  const legacy = args['alignment-file'];
  if (canonical && legacy) throw new Error('--goal-card-file 与兼容参数 --alignment-file 只能提供一个');
  return canonical ?? legacy ?? (required ? requiredArg(args, 'goal-card-file') : undefined);
}

try {
  if (action === '预检') {
    output(preflightWorkspace({
      stateRoot: args['state-root'],
      cwd: args.cwd ?? process.cwd(),
    }));
  } else if (action === '复核直达') {
    output(verifyLocalDirect({
      stateRoot:args['state-root'],
      cwd:args.cwd ?? process.cwd(),
      baselineHead:requiredArg(args, 'baseline-head'),
      baselineBranch:args['baseline-branch'],
      baselineDetached:args['baseline-detached'] === true,
      baselineGitRoot:requiredArg(args, 'baseline-git-root'),
      baselineGitCommonDir:requiredArg(args, 'baseline-git-common-dir'),
      intent:requiredArg(args, 'intent'),
      acceptance:listArg(args.acceptance).join(' '),
      scope:args.scope ?? '.',
      plannedPaths:listArg(args.path),
    }));
  } else if (action === '准备') {
    output(prepareTask({
      stateRoot: args['state-root'],
      cwd: args.cwd ?? process.cwd(),
      intent: requiredArg(args, 'intent'),
      acceptance: listArg(args.acceptance),
      alignmentFile: goalCardFileArg(),
      scope: args.scope ?? '.',
      projectId: args.project,
      qualityProfiles: [...new Set([
        ...listArg(args['quality-profile']),
        ...listArg(args.skill),
      ])],
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
      model:args.model,
      reasoningEffort:args['reasoning-effort'],
      executionEnvironment:args['execution-environment'],
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
    output(realignTask({
      stateRoot: args['state-root'],
      taskId: requiredArg(args, 'task-id'),
      alignmentFile: goalCardFileArg({ required:true }),
      reason: args.reason,
    }));
  } else if (action === '后续') {
    const input = {
      stateRoot: args['state-root'],
      taskId: requiredArg(args, 'task-id'),
      deliveryId: requiredArg(args, 'delivery-id'),
      observationId: requiredArg(args, 'observation-id'),
      kind: requiredArg(args, 'kind'),
    };
    output(input.taskId.startsWith('result-') ? recordLightFollowUp(input) : recordTaskFollowUp(input));
  } else if (action === '记录轻量交付') {
    output(recordLightDelivery({
      stateRoot: args['state-root'],
      cwd: args.cwd ?? process.cwd(),
      commit: requiredArg(args, 'commit'),
      baselineHead:requiredArg(args, 'baseline-head'),
      baselineGitRoot:requiredArg(args, 'baseline-git-root'),
      baselineGitCommonDir:requiredArg(args, 'baseline-git-common-dir'),
      verifiedChangeFingerprint:requiredArg(args, 'verified-change-fingerprint'),
      problemType: requiredArg(args, 'problem-type'),
      scope: listArg(args.scope),
      taskId: args['task-id'],
      eligible: args.exclude !== true && !args['exclude-reason'],
      exclusionReason: args['exclude-reason'],
      evaluationContext:captureEvaluationContext({
        model:args.model,
        reasoningEffort:args['reasoning-effort'],
        executionEnvironment:args['execution-environment'],
      }),
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
    const integrationOptions = {
      stateRoot: args['state-root'],
      taskId: requiredArg(args, 'task-id'),
      target: args.target,
      keepWorktree:args['keep-worktree'] === true,
      allowRisk:args['allow-risk-integration'] === true,
      riskReason:args['risk-reason'],
    };
    output(args['confirm-only'] === true
      ? confirmIntegration({ ...integrationOptions, cwd:args.cwd ?? process.cwd() })
      : integrateTask(integrationOptions));
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
    const taskStateIntegrity = diagnoseState({ stateRoot: args['state-root'] });
    const lightOutcomeLedger = diagnoseLightOutcomeLedger({ stateRoot:args['state-root'] });
    const storageIntegrity = {
      ...taskStateIntegrity,
      ok:taskStateIntegrity.ok && lightOutcomeLedger.ok,
      components:{ taskState:taskStateIntegrity.ok, lightOutcomeLedger:lightOutcomeLedger.ok },
    };
    const acceptanceEligibility = storageIntegrity.ok
      ? inspectAcceptanceEligibility({ stateRoot:args['state-root'] })
      : {
          schemaVersion:1,
          readOnly:true,
          scope:'all-projects',
          ok:null,
          checked:0,
          eligible:0,
          ineligible:0,
          skipped:true,
          reason:'storage-integrity-failed',
          diagnostics:[],
        };
    output({ schemaVersion:2, readOnly:true, storageIntegrity, lightOutcomeLedger, acceptanceEligibility });
  } else if (action === '迁移状态') {
    output(migrateState({
      stateRoot:args['state-root'],
      apply:args.apply === true,
      migrationId:args['migration-id'],
    }));
  } else if (action === '评估摘要') {
    const allProjects = args['all-projects'] === true;
    const gitRoot = allProjects ? null : findGitRoot(args.cwd ?? process.cwd());
    if (!allProjects && !gitRoot) {
      throw new Error('评估摘要默认按当前 Git 项目过滤；请在 Git 工作树中运行，或显式使用 --all-projects');
    }
    const repositoryIdentity = gitRoot ? captureRepositoryIdentity(gitRoot) : null;
    const active = listTasks({ stateRoot: args['state-root'], repositoryIdentity, limit: 0 }).tasks;
    const history = readHistory({ stateRoot: args['state-root'] })
      .filter(task => !repositoryIdentity || taskMatchesRepository(task, repositoryIdentity));
    const light = readLightOutcomeTasks({ stateRoot:args['state-root'], repositoryIdentity });
    output(summarizeOutcomeMetrics([...active, ...history, ...light], {
      from: args.from,
      to: args.to,
      quietDays: args['quiet-days'],
      problemTypes: listArg(args['problem-type']),
    }));
  } else if (action === '列表') {
    const allProjects = args['all-projects'] === true;
    const gitRoot = allProjects ? null : findGitRoot(args.cwd ?? process.cwd());
    if (!allProjects && !gitRoot) {
      throw new Error('Task 列表默认按当前 Git 项目过滤；请在 Git 工作树中运行，或显式使用 --all-projects');
    }
    const repositoryIdentity = gitRoot ? captureRepositoryIdentity(gitRoot) : null;
    const limit = args.limit === undefined ? 10 : Number(args.limit);
    if (!Number.isInteger(limit) || limit < 0) throw new Error('--limit 必须是大于等于 0 的整数');
    output(listTasks({
      stateRoot: args['state-root'],
      repositoryIdentity,
      limit,
    }));
  } else help();
} catch (error) {
  console.error(`任务失败: ${error.message}`);
  process.exitCode = 1;
}
