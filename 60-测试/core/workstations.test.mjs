import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildContext } from '../../40-脚本/lib/context-builder.mjs';
import {
  initializeWorkstations,
  refreshWorkstations,
  routeWorkstation,
  validateWorkstationIndex,
} from '../../40-脚本/lib/workstations.mjs';
import { gitRepo, runNode, tempDir } from '../helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TASK = path.join(ROOT, '40-脚本', 'task.mjs');

function planFile(t, projectRoot) {
  const directory = tempDir(t, 'ai-rd-os-workstations-');
  const file = path.join(directory, 'plan.json');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    project: { id: 'shop', name: '商城' },
    shared: {
      principles: ['业务领域是软归属'],
      hotspots: ['共享类型'],
      integrationRules: ['并行写使用独立 worktree'],
    },
    workstations: [
      {
        id: 'order', name: '订单', summary: '订单生命周期', keywords: ['订单', '共同'],
        responsibilities: ['维护订单状态'], invariants: ['取消订单不能支付'],
        codeEntrypoints: ['src/domains/order'], validation: ['运行订单测试'],
      },
      {
        id: 'product', name: '商品', summary: '商品资料', keywords: ['商品', '共同'],
        responsibilities: ['维护商品资料'], codeEntrypoints: ['src/domains/product'],
      },
    ],
  }, null, 2));
  return { file, projectRoot };
}

test('工作站初始化生成项目档案并拒绝覆盖', t => {
  const repo = gitRepo(t);
  const plan = planFile(t, repo);
  assert.throws(() => initializeWorkstations({ cwd: repo, planFile: plan.file }), /--confirm-plan/u);

  const created = initializeWorkstations({ cwd: repo, planFile: plan.file, confirmPlan: true });
  assert.equal(created.ok, true);
  assert.equal(created.workstationCount, 2);
  for (const relative of created.files) assert.equal(fs.existsSync(path.join(repo, relative)), true, relative);

  const checked = validateWorkstationIndex(repo);
  assert.equal(checked.ok, true, checked.errors.join('; '));
  assert.ok(checked.warnings.some(item => item.includes('共同')));
  assert.throws(
    () => initializeWorkstations({ cwd: repo, planFile: plan.file, confirmPlan: true }),
    /不会覆盖/u,
  );
});

test('工作站路由唯一命中、歧义停止和显式选择', t => {
  const repo = gitRepo(t);
  const plan = planFile(t, repo);
  initializeWorkstations({ cwd: repo, planFile: plan.file, confirmPlan: true });

  const unique = routeWorkstation(repo, '修复订单状态问题');
  assert.equal(unique.selected.id, 'order');
  assert.ok(unique.files.some(file => file.endsWith(path.join('order', 'profile.md'))));
  assert.ok(unique.files.some(file => file.endsWith(path.join('order', 'runbook.md'))));
  assert.ok(!unique.files.some(file => file.endsWith(path.join('product', 'profile.md'))));

  const ambiguous = routeWorkstation(repo, '分析共同规则');
  assert.equal(ambiguous.selected, null);
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(ambiguous.files.length, 1);

  const explicit = routeWorkstation(repo, '分析共同规则', 'product');
  assert.equal(explicit.selected.id, 'product');
  assert.ok(explicit.files.some(file => file.endsWith(path.join('product', 'profile.md'))));
  assert.throws(() => routeWorkstation(repo, '任务', 'missing'), /工作站不存在/u);
});

test('上下文按领域渐进加载且刷新需要显式确认', t => {
  const repo = gitRepo(t);
  const plan = planFile(t, repo);
  initializeWorkstations({ cwd: repo, planFile: plan.file, confirmPlan: true });

  const analysis = buildContext({ cwd: repo, intent: '分析订单状态' });
  assert.equal(analysis.workstationRouting.selected.id, 'order');
  assert.ok(analysis.filesToRead.some(file => file.endsWith(path.join('workstations', 'index.json'))));
  assert.ok(analysis.filesToRead.some(file => file.endsWith(path.join('order', 'profile.md'))));
  assert.ok(!analysis.filesToRead.some(file => file.endsWith(path.join('order', 'runbook.md'))));
  assert.ok(!analysis.filesToRead.some(file => file.endsWith(path.join('product', 'profile.md'))));

  const explicit = buildContext({ cwd: repo, intent: '修复共同规则', workstation: 'product' });
  assert.equal(explicit.workstationRouting.selected.id, 'product');
  assert.ok(explicit.filesToRead.some(file => file.endsWith(path.join('product', 'runbook.md'))));

  const stateRoot = tempDir(t, 'ai-rd-os-workstation-task-');
  const prepared = runNode(TASK, [
    '准备', '--cwd', repo, '--intent', '修复共同规则', '--acceptance', '行为正确', '--scope', '.',
    '--workstation', 'product', '--state-root', stateRoot, '--full',
  ], { cwd: ROOT });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(JSON.parse(prepared.stdout).context.workstationRouting.selected.id, 'product');

  assert.throws(() => refreshWorkstations({ cwd: repo }), /--confirm-reviewed/u);
  const refreshed = refreshWorkstations({ cwd: repo, confirmReviewed: true });
  assert.equal(refreshed.ok, true);
});
