import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gitRepo, tempDir, runNode } from '../helpers.mjs';
import { updateTask } from '../../40-脚本/lib/state-manager.mjs';
import { createEvidence } from '../../40-脚本/lib/evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD_CONTEXT = path.join(ROOT, '40-脚本/build-context.mjs');
const TASK = path.join(ROOT, '40-脚本/task.mjs');
const RUN_CHECKS = path.join(ROOT, '40-脚本/run-checks.mjs');

test('Task CLI 默认帮助隐藏机器协议，--full 公开宿主参数', () => {
  const result = runNode(TASK, ['--help'], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--allow-existing-change/u);
  assert.match(result.stdout, /四种用户状态/u);
  assert.doesNotMatch(result.stdout, /--task-check-file/u);
  const full = runNode(TASK, ['--help', '--full'], { cwd:ROOT });
  assert.equal(full.status, 0, full.stderr);
  assert.match(full.stdout, /--task-check-file/u);
  assert.match(full.stdout, /--goal-card-file/u);
  assert.match(full.stdout, /--reason-category/u);
  assert.match(result.stdout, /继续验证.*--additional-budget-ms/u);
  assert.match(full.stdout, /重验集成/u);
});

test('独立检查入口拒绝旧的无限继续参数', () => {
  const result = runNode(RUN_CHECKS, ['--continue'], { cwd:ROOT });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /无限继续参数已移除/u);
});

test('build-context 默认轻量，--full 保留完整上下文', t => {
  const repo = gitRepo(t);
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# test\n');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    name: 'sample-app',
    scripts: { test: 'node --test', build: 'vite build' },
    dependencies: { vue: '3' },
  }));

  const compactResult = runNode(BUILD_CONTEXT, [
    '--cwd', repo,
    '--intent', '分析 Web 页面当前实现',
  ], { cwd: ROOT });
  assert.equal(compactResult.status, 0, compactResult.stderr);
  const compact = JSON.parse(compactResult.stdout);
  assert.equal(compact.view, 'summary');
  assert.equal(path.basename(compact.context.gitRoot), path.basename(repo));
  assert.equal(fs.existsSync(compact.context.gitRoot), true);
  assert.ok(compact.filesToRead.some(file => file.endsWith('AGENTS.md')));
  assert.ok(!compact.filesToRead.some(file => file.endsWith('package.json')));
  assert.ok(Array.isArray(compact.readPlan));
  assert.equal(compact.readPlan.length, compact.filesToRead.length);
  assert.ok(compact.readPlan.some(item => item.path.endsWith('AGENTS.md') && item.reason && item.authority === 'project'));
  assert.ok(compact.readPlan.every(item => compact.filesToRead.includes(item.path)));
  assert.ok(!compact.readPlan.some(item => item.path.endsWith('package.json')));
  assert.equal(compact.quality.pass?.timing, 'before-delivery');
  assert.equal(compact.quality.pass?.rerunAffectedChecks, true);
  assert.equal(compact.manifests[0].name, 'sample-app');
  assert.deepEqual(compact.manifests[0].frameworks, ['vue']);
  assert.equal('facts' in compact, false);
  assert.equal('quality' in compact, true);
  assert.equal(compact.quality.baseline?.id, 'implementation-quality-baseline');
  assert.ok(compact.quality.contracts.every(item => !('path' in item) && !('files' in item)));

  const fullResult = runNode(BUILD_CONTEXT, [
    '--cwd', repo,
    '--intent', '分析 Web 页面当前实现',
    '--full',
  ], { cwd: ROOT });
  assert.equal(fullResult.status, 0, fullResult.stderr);
  const full = JSON.parse(fullResult.stdout);
  assert.equal(full.view, undefined);
  assert.ok(Array.isArray(full.facts));
  assert.ok(Array.isArray(full.manifests));
  assert.equal(full.facts.find(fact => fact.path.endsWith('package.json')).readMode, 'machine');
  assert.ok(full.quality);
  assert.ok(full.quality.methods.some(method => method.name === 'develop-web'));
  assert.ok(!compact.filesToRead.some(file => file.endsWith(path.join('develop-web', 'SKILL.md'))));
  assert.ok(Buffer.byteLength(compactResult.stdout) < Buffer.byteLength(fullResult.stdout));

  const explicitSkillResult = runNode(BUILD_CONTEXT, [
    '--cwd', repo,
    '--intent', '分析当前实现',
    '--skill', 'develop-web',
  ], { cwd: ROOT });
  assert.equal(explicitSkillResult.status, 0, explicitSkillResult.stderr);
  assert.ok(JSON.parse(explicitSkillResult.stdout).filesToRead
    .some(file => file.endsWith(path.join('develop-web', 'SKILL.md'))));

  const dependencyResult = runNode(BUILD_CONTEXT, [
    '--cwd', repo,
    '--intent', '分析 package 依赖',
  ], { cwd: ROOT });
  assert.equal(dependencyResult.status, 0, dependencyResult.stderr);
  assert.ok(JSON.parse(dependencyResult.stdout).filesToRead.some(file => file.endsWith('package.json')));
});

test('系统入口已由宿主加载时不进入 filesToRead', () => {
  const compactResult = runNode(BUILD_CONTEXT, [
    '--cwd', ROOT,
    '--intent', '分析当前实现',
  ], { cwd: ROOT });
  assert.equal(compactResult.status, 0, compactResult.stderr);
  const compact = JSON.parse(compactResult.stdout);
  assert.ok(!compact.filesToRead.some(file => file === path.join(ROOT, 'AGENTS.md')));
  assert.ok(!compact.filesToRead.some(file => file === path.join(ROOT, 'package.json')));
  assert.ok(!compact.readPlan.some(item => item.path === path.join(ROOT, 'AGENTS.md')));
  assert.equal(compact.manifests[0].name, 'personal-ai-rd-operating-system');

  const fullResult = runNode(BUILD_CONTEXT, [
    '--cwd', ROOT,
    '--intent', '分析当前实现',
    '--full',
  ], { cwd: ROOT });
  assert.equal(fullResult.status, 0, fullResult.stderr);
  const full = JSON.parse(fullResult.stdout);
  assert.equal(full.facts.find(fact => fact.path === path.join(ROOT, 'AGENTS.md')).readMode, 'preloaded');
  assert.equal(full.facts.find(fact => fact.path === path.join(ROOT, 'package.json')).readMode, 'machine');
});

test('结构性任务 readPlan 解释质量契约来源', t => {
  const repo = gitRepo(t);
  const result = runNode(BUILD_CONTEXT, [
    '--cwd', repo,
    '--intent', '新增 Web 模块并调整架构职责',
  ], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  const compact = JSON.parse(result.stdout);
  assert.equal(compact.readPlan.length, compact.filesToRead.length);
  const contractEntry = compact.readPlan.find(item => item.path.endsWith('CONTRACT.md'));
  assert.ok(contractEntry, JSON.stringify(compact.readPlan));
  assert.match(contractEntry.reason, /质量契约/u);
});

test('Task CLI 默认只展示四态结果，--full 保留完整 Task', t => {
  const repo = gitRepo(t);
  const otherRepo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = runNode(TASK, [
    '准备',
    '--cwd', repo,
    '--intent', '修复普通功能',
    '--acceptance', '功能正确',
    '--scope', '.',
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const receipt = JSON.parse(prepared.stdout);
  assert.equal(receipt.view, 'outcome');
  assert.equal(receipt.state, 'working');
  assert.equal(receipt.stateLabel, '正在处理');
  assert.deepEqual(receipt.scope, ['.']);
  assert.equal('baseline' in receipt, false);
  for (const key of ['status','taskSchemaVersion','stateRevision','alignment','verification','recordPath','changeSet','changeRationale','deliveryDecision']) {
    assert.equal(key in receipt, false);
  }

  const compactShown = runNode(TASK, [
    '查看',
    '--task-id', receipt.taskId,
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(compactShown.status, 0, compactShown.stderr);
  assert.equal('baseline' in JSON.parse(compactShown.stdout), false);

  const fullShown = runNode(TASK, [
    '查看',
    '--task-id', receipt.taskId,
    '--state-root', stateRoot,
    '--full',
  ], { cwd: ROOT });
  assert.equal(fullShown.status, 0, fullShown.stderr);
  const fullTask = JSON.parse(fullShown.stdout);
  assert.ok(fullTask.baseline);
  assert.ok(fullTask.context);
  assert.equal(fullTask.status, 'prepared');
  assert.ok(fullTask.outcomeMetrics);
  assert.equal(fullTask.stateRevision, 1);
  assert.ok(Buffer.byteLength(prepared.stdout) < Buffer.byteLength(fullShown.stdout));

  const otherPrepared = runNode(TASK, [
    '准备',
    '--cwd', otherRepo,
    '--intent', '修复另一个项目',
    '--acceptance', '功能正确',
    '--scope', '.',
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(otherPrepared.status, 0, otherPrepared.stderr);

  const compactList = runNode(TASK, [
    '列表',
    '--cwd', repo,
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(compactList.status, 0, compactList.stderr);
  const taskList = JSON.parse(compactList.stdout);
  assert.equal(taskList.view, 'outcome-list');
  assert.deepEqual(taskList.counts, { working:1, needs_decision:0, ready_for_acceptance:0, done:0 });
  for (const key of ['globalCounts', 'total', 'matched', 'shown', 'hasMore', 'filter']) {
    assert.equal(key in taskList, false);
  }
  assert.equal(taskList.tasks[0].taskId, receipt.taskId);
  assert.equal(taskList.tasks[0].state, 'working');
  assert.equal('status' in taskList.tasks[0], false);
  assert.equal('baseline' in taskList.tasks[0], false);

  const globalList = runNode(TASK, [
    '列表',
    '--all-projects',
    '--limit', '0',
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(globalList.status, 0, globalList.stderr);
  const globalTaskList = JSON.parse(globalList.stdout);
  assert.equal(globalTaskList.tasks.length, 2);

  const fullList = runNode(TASK, [
    '列表',
    '--cwd', repo,
    '--state-root', stateRoot,
    '--full',
  ], { cwd: ROOT });
  assert.equal(fullList.status, 0, fullList.stderr);
  assert.ok(JSON.parse(fullList.stdout).tasks[0].baseline);
});

test('CLI 准备→交付→验收完整闭环', t => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = runNode(TASK, [
    '准备',
    '--cwd', repo,
    '--intent', '修复普通功能',
    '--acceptance', '功能正确',
    '--scope', '.',
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const task = JSON.parse(prepared.stdout);
  assert.equal(task.outcomes.length, 1);
  assert.equal(task.outcomes[0].status, 'pending');
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');

  const delivered = runNode(TASK, [
    '交付',
    '--task-id', task.taskId,
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(delivered.status, 0, delivered.stderr);
  const deliveryReceipt = JSON.parse(delivered.stdout);
  assert.equal(deliveryReceipt.state, 'ready_for_acceptance');
  assert.equal(deliveryReceipt.stateLabel, '等待你验收');
  assert.equal(deliveryReceipt.view, 'outcome');
  assert.equal('evidence' in deliveryReceipt, false);
  assert.equal('verification' in deliveryReceipt, false);
  assert.equal(deliveryReceipt.outcomes.length, 1);
  assert.equal(deliveryReceipt.outcomes[0].status, 'verified');
  assert.equal(deliveryReceipt.outcomes[0].description, '功能正确');

  const accepted = runNode(TASK, [
    '验收',
    '--task-id', task.taskId,
    '--state-root', stateRoot,
    '--decision', '通过',
  ], { cwd: ROOT });
  assert.equal(accepted.status, 0, accepted.stderr);
  const acceptedReceipt = JSON.parse(accepted.stdout);
  assert.equal(acceptedReceipt.state, 'done');
  assert.equal(acceptedReceipt.stateLabel, '已结束');
});

test('交付回执用 Outcome 语言展示每条验收状态与缺口提示', t => {
  const repo = gitRepo(t, { checks: [] });
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'target.test.js'), '// targeted\n');
  for (const args of [['add', '.'], ['-c', 'user.email=t@e.c', '-c', 'user.name=T', 'commit', '-m', 'tests']]) {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  const stateRoot = tempDir(t);
  const prepared = runNode(TASK, [
    '准备',
    '--cwd', repo,
    '--state-root', stateRoot,
    '--intent', '修复退款后库存恢复',
    '--acceptance', '退款后库存恢复',
    '--acceptance', '部分退款只恢复对应数量',
    '--scope', '.',
  ], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const task = JSON.parse(prepared.stdout);
  assert.ok(task.outcomes.every(item => item.status === 'pending'));
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const taskCheck = path.join(stateRoot, 'task-checks.json');
  fs.writeFileSync(taskCheck, JSON.stringify({
    schemaVersion: 1,
    checks: [{
      name: 'bind-A1',
      runner: 'node-test',
      covers: ['behavior'],
      acceptanceIds: ['A1'],
      testFiles: ['tests/target.test.js'],
      estimatedCost: 'very-low',
      timeoutMs: 5000,
    }],
  }));
  const delivered = runNode(TASK, [
    '交付',
    '--task-id', task.taskId,
    '--state-root', stateRoot,
    '--task-check-file', taskCheck,
  ], { cwd: ROOT });
  assert.equal(delivered.status, 0, delivered.stderr);
  const receipt = JSON.parse(delivered.stdout);
  const byId = Object.fromEntries(receipt.outcomes.map(item => [item.id, item]));
  assert.equal(byId.A1.status, 'verified');
  assert.equal(byId.A1.description, '退款后库存恢复');
  assert.equal(byId.A2.status, 'unverified');
  assert.equal(byId.A2.description, '部分退款只恢复对应数量');
  assert.match(receipt.next, /A2（部分退款只恢复对应数量）/u);
  assert.match(receipt.next, /还缺少行为验证/u);
  assert.deepEqual(receipt.gaps, [
    { outcomeId: 'A2', description: '部分退款只恢复对应数量', missingEvidence: ['行为验证'] },
  ]);
});

test('--goal-card-file 是公开入口且 --alignment-file 保持兼容', t => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const card = {
    schemaVersion: 1,
    originalRequest: '修复普通功能',
    goal: '修复普通功能',
    expectedOutcomes: ['功能正确'],
    protectedBehaviors: [],
    acceptance: ['功能正确'],
    confirmedDecisions: [],
    nonGoals: [],
    assumptions: [],
    alignment: { mode: 'direct', reasonCodes: [], decisionNote: null, delegatedTopics: [] },
  };
  const cardFile = path.join(stateRoot, 'goal-card.json');
  fs.writeFileSync(cardFile, JSON.stringify(card));
  const prepared = runNode(TASK, [
    '准备',
    '--cwd', repo,
    '--state-root', stateRoot,
    '--intent', '修复普通功能',
    '--goal-card-file', cardFile,
    '--scope', '.',
  ], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const receipt = JSON.parse(prepared.stdout);
  assert.equal(receipt.state, 'working');
  assert.equal('alignment' in receipt, false);
  const shown = runNode(TASK, ['查看', '--task-id', receipt.taskId, '--state-root', stateRoot, '--full'], { cwd:ROOT });
  assert.equal(shown.status, 0, shown.stderr);
  const full = JSON.parse(shown.stdout);
  assert.equal(full.goal.alignment.mode, 'direct');
  assert.deepEqual(full.goal.alignment.reasonCodes, []);

  const both = runNode(TASK, [
    '准备',
    '--cwd', repo,
    '--state-root', stateRoot,
    '--intent', '修复普通功能',
    '--goal-card-file', cardFile,
    '--alignment-file', cardFile,
    '--scope', '.',
  ], { cwd: ROOT });
  assert.notEqual(both.status, 0);
  assert.match(both.stderr, /只能提供一个/u);
});

test('需求契约包含严格 Preservation 的 Goal Card 扩展示例', () => {
  const contract = fs.readFileSync(path.join(ROOT, '20-能力模块', 'clarify-requirements', 'CONTRACT.md'), 'utf8');
  assert.match(contract, /Goal Card 的严格 Preservation 扩展/u);
  assert.match(contract, /基础 Goal Card 保持轻量/u);
  assert.match(contract, /"preservation"/u);
  assert.match(contract, /referenceRoots/u);
});

test('交付被隔离阻断时 outcomes 不得标记为已证明', t => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const target = path.join(repo, 'target.txt');
  fs.writeFileSync(target, 'user-before\n');
  const prepared = runNode(TASK, [
    '准备',
    '--cwd', repo,
    '--state-root', stateRoot,
    '--intent', '修复普通功能',
    '--acceptance', '功能正确',
    '--scope', '.',
  ], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const task = JSON.parse(prepared.stdout);
  fs.writeFileSync(target, 'task-after\n');
  const delivered = runNode(TASK, [
    '交付',
    '--task-id', task.taskId,
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(delivered.status, 0, delivered.stderr);
  const receipt = JSON.parse(delivered.stdout);
  assert.equal(receipt.state, 'needs_decision');
  assert.equal(receipt.stateLabel, '需要你决定');
  assert.ok(receipt.outcomes.length > 0);
  assert.ok(receipt.outcomes.every(item => item.status === 'unverified'));
});

test('CLI 继续验证按原因追加有限预算', t => {
  const repo = gitRepo(t), stateRoot = tempDir(t);
  const prepared = runNode(TASK, ['准备', '--cwd', repo, '--intent', '验证普通功能', '--acceptance', '功能正确', '--scope', '.', '--budget-ms', '100', '--state-root', stateRoot], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const task = JSON.parse(prepared.stdout);
  updateTask({
    stateRoot,
    taskId:task.taskId,
    expectedRevision:1,
    transitionTo:'saved',
    event:'delivery',
    mutate(next){next.verification.budget.spentMs=100;next.verification.stopReason='budget';return next;}
  });
  const continued = runNode(TASK, ['继续验证', '--task-id', task.taskId, '--state-root', stateRoot, '--additional-budget-ms', '50', '--reason', '用户批准继续'], { cwd:ROOT });
  assert.equal(continued.status, 0, continued.stderr);
  const receipt = JSON.parse(continued.stdout);
  assert.equal(receipt.state, 'working');
  assert.equal('verification' in receipt, false);
  const full = runNode(TASK, ['查看', '--task-id', task.taskId, '--state-root', stateRoot, '--full'], { cwd:ROOT });
  assert.equal(full.status, 0, full.stderr);
  assert.equal(JSON.parse(full.stdout).verification.budget.limitMs,150);
  assert.equal(JSON.parse(full.stdout).verification.budget.spentMs,100);
  assert.equal(JSON.parse(full.stdout).verification.budget.extensions.length,1);
});

test('Task CLI 轻量回执包含首个失败诊断', t => {
  const repo = gitRepo(t, { checks: [{
    name: 'failing-check', command: process.execPath,
    args: ['-e', "process.stderr.write('boom');process.exit(1)"],
    profiles: ['standard'], covers: ['behavior'], sideEffect: 'none',
    estimatedCost: 'very-low', timeoutMs: 5000, acceptanceMode: 'matching-covers'
  }] });
  const stateRoot = tempDir(t);
  const prepared = runNode(TASK, ['准备', '--cwd', repo, '--intent', '修复普通功能', '--acceptance', '功能正确', '--scope', '.', '--state-root', stateRoot], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const task = JSON.parse(prepared.stdout);
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const delivered = runNode(TASK, ['交付', '--task-id', task.taskId, '--state-root', stateRoot], { cwd: ROOT });
  assert.equal(delivered.status, 0, delivered.stderr);
  const receipt = JSON.parse(delivered.stdout);
  assert.equal(receipt.state, 'working');
  assert.equal(receipt.issue.check, 'failing-check');
  assert.equal(receipt.issue.exitCode, 1);
  assert.match(receipt.issue.output, /boom/u);
  assert.equal('evidence' in receipt, false);
});

test('Alignment 失败的交付回执 next 要求重新对齐且不提示继续验证', t => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = runNode(TASK, [
    '准备',
    '--cwd', repo,
    '--intent', '修改用户权限判断逻辑',
    '--scope', '.',
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const task = JSON.parse(prepared.stdout);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'user-service.js'), 'export const x = 1;\n');
  const delivered = runNode(TASK, [
    '交付',
    '--task-id', task.taskId,
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(delivered.status, 0, delivered.stderr);
  const receipt = JSON.parse(delivered.stdout);
  assert.equal(receipt.state, 'working');
  assert.equal('verification' in receipt, false);
  assert.match(receipt.next, /重新对齐/u);
  assert.doesNotMatch(receipt.next, /--alignment-file/u);
});

test('CLI 回执显示 untrustedTechnicalEvidence', t => {
  const repo = gitRepo(t, { checks: [] });
  const stateRoot = tempDir(t);
  const prepared = runNode(TASK, [
    '准备',
    '--cwd', repo,
    '--intent', '修复普通功能',
    '--acceptance', '功能正确',
    '--scope', '.',
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const task = JSON.parse(prepared.stdout);
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const first = runNode(TASK, [
    '交付',
    '--task-id', task.taskId,
    '--no-auto-checks',
    '--full',
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(first.status, 0, first.stderr);
  const firstReceipt = JSON.parse(first.stdout);
  const fake = createEvidence({
    taskId: task.taskId,
    changeFingerprint: firstReceipt.changeSet.fingerprint,
    inputCycle: 0,
    acceptanceIds: ['A1'],
    covers: ['behavior'],
    source: { type: 'command' },
    result: { status: 'passed', exitCode: 0 },
  });
  const fakeFile = path.join(stateRoot, 'fake-evidence.json');
  fs.writeFileSync(fakeFile, JSON.stringify([fake]));
  const second = runNode(TASK, [
    '交付',
    '--task-id', task.taskId,
    '--evidence-file', fakeFile,
    '--no-auto-checks',
    '--state-root', stateRoot,
  ], { cwd: ROOT });
  assert.equal(second.status, 0, second.stderr);
  const receipt = JSON.parse(second.stdout);
  assert.ok(receipt.warnings.some((item) => /外部技术结果未被作为验收证明/u.test(item)));
  assert.equal('verification' in receipt, false);
});

test('CLI 自动记录退回指标并提供只读评估摘要', t => {
  const repo = gitRepo(t);
  const stateRoot = tempDir(t);
  const prepared = runNode(TASK, [
    '准备', '--cwd', repo, '--intent', '修复普通功能', '--acceptance', '功能正确',
    '--scope', '.', '--state-root', stateRoot,
  ], { cwd:ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  const task = JSON.parse(prepared.stdout);
  fs.writeFileSync(path.join(repo, 'target.txt'), 'changed\n');
  const delivered = runNode(TASK, ['交付', '--task-id', task.taskId, '--state-root', stateRoot], { cwd:ROOT });
  assert.equal(delivered.status, 0, delivered.stderr);
  assert.equal(JSON.parse(delivered.stdout).state, 'ready_for_acceptance');
  const rejected = runNode(TASK, [
    '验收', '--task-id', task.taskId, '--state-root', stateRoot, '--decision', '退回',
    '--reason-category', 'code-quality', '--note', '命名不符合项目习惯',
  ], { cwd:ROOT });
  assert.equal(rejected.status, 0, rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).state, 'working');

  const metrics = runNode(TASK, ['评估摘要', '--cwd', repo, '--state-root', stateRoot], { cwd:ROOT });
  assert.equal(metrics.status, 0, metrics.stderr);
  const summary = JSON.parse(metrics.stdout);
  assert.equal(summary.view, 'outcome-metrics');
  assert.equal(summary.sample.total, 1);
  assert.equal(summary.sample.tracked, 1);
  assert.deepEqual(summary.firstPassAcceptance, { decided:1, passed:0, rate:0 });
  assert.deepEqual(summary.rework, { tasks:1, count:1 });
  assert.deepEqual(summary.returnReasons, [{ category:'code-quality', count:1 }]);
  assert.equal(summary.verification.runs, 1);
  assert.ok(summary.warnings.some(item => /不能单独证明/u.test(item)));
});

test('系统完整检查通过', () => {
  const result = runNode(path.join(ROOT, '40-脚本/check-system.mjs'), [], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});
