import assert from 'node:assert/strict';
import test from 'node:test';
import { createBudget, consumeBudget, extendBudget, budgetDecision } from '../../40-脚本/lib/verification-budget.mjs';

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
