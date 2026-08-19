import assert from 'node:assert/strict';
import test from 'node:test';
import { createBudget, consumeBudget, extendBudget, budgetDecision, remainingBudget } from '../../40-脚本/lib/verification-budget.mjs';

test('验证预算针对整个输入周期累计', () => {
  let budget = createBudget({ mode: 'standard', limitMs: 100 });
  budget = consumeBudget(budget, 60);
  assert.equal(budgetDecision(budget).remainingMs, 40);
  budget = consumeBudget(budget, 40);
  assert.equal(budgetDecision(budget).allowed, false);
});

test('验证预算只能按明确原因有界追加，不再存在无限继续状态', () => {
  let budget = createBudget({ mode:'standard', limitMs:100, spentMs:100, continued:true });
  assert.equal(budgetDecision(budget).allowed, false);
  assert.throws(()=>extendBudget(budget, { additionalMs:50 }), /必须说明原因/u);
  budget = extendBudget(budget, { additionalMs:50, reason:'用户批准继续', extendedAt:'2026-08-16T00:00:00.000Z' });
  assert.equal(budget.limitMs, 150);
  assert.equal(budgetDecision(budget).remainingMs, 50);
  assert.deepEqual(budget.extensions, [{ additionalMs:50, reason:'用户批准继续', extendedAt:'2026-08-16T00:00:00.000Z' }]);
  assert.ok(createBudget({ mode:'release', limitMs:Number.MAX_SAFE_INTEGER }).limitMs < Number.MAX_SAFE_INTEGER);
});

test('预算创建拒绝非法额度 R1', () => {
  assert.throws(() => createBudget({ limitMs: 0 }), /大于零的安全整数/u);
  assert.throws(() => createBudget({ limitMs: 1.5 }), /大于零的安全整数/u);
  assert.throws(() => createBudget({ limitMs: Number.NaN }), /大于零的安全整数/u);
});

test('预算创建拒绝非法已消费额度 R2', () => {
  assert.throws(() => createBudget({ spentMs: -1 }), /已消费验证预算无效/u);
  assert.throws(() => createBudget({ spentMs: Number.NaN }), /已消费验证预算无效/u);
});

test('剩余预算永不为负 R3', () => {
  const budget = createBudget({ limitMs: 10, spentMs: 30 });
  assert.equal(remainingBudget(budget), 0);
  assert.equal(budgetDecision(budget).allowed, false);
});

test('consumeBudget 只累计非负时长 R4', () => {
  const base = createBudget({ limitMs: 100 });
  assert.equal(consumeBudget(base, -5).spentMs, 0);
  assert.equal(consumeBudget(base, 25).spentMs, 25);
});

test('extendBudget 拒绝非法追加 R5', () => {
  const budget = createBudget({ limitMs: 100 });
  assert.throws(() => extendBudget(budget, { additionalMs: 0, reason: 'x' }), /大于零的安全整数毫秒数/u);
  assert.throws(() => extendBudget(budget, { additionalMs: -1, reason: 'x' }), /大于零的安全整数毫秒数/u);
  assert.throws(() => extendBudget(budget, { additionalMs: 50, reason: '' }), /必须说明原因/u);
});

test('extendBudget 累计限额与扩展记录 R6', () => {
  let budget = createBudget({ limitMs: 100 });
  budget = extendBudget(budget, { additionalMs: 20, reason: '第一次' });
  budget = extendBudget(budget, { additionalMs: 30, reason: '第二次' });
  assert.equal(budget.limitMs, 150);
  assert.equal(budget.extensions.length, 2);
  assert.deepEqual(budget.extensions.map((item) => item.reason), ['第一次', '第二次']);
});
