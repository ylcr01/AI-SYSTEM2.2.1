import assert from 'node:assert/strict';
import test from 'node:test';
import { createBudget, consumeBudget, budgetDecision } from '../../40-脚本/lib/verification-budget.mjs';

test('验证预算针对整个输入周期累计', () => {
  let budget = createBudget({ mode: 'standard', limitMs: 100 });
  budget = consumeBudget(budget, 60);
  assert.equal(budgetDecision(budget).remainingMs, 40);
  budget = consumeBudget(budget, 40);
  assert.equal(budgetDecision(budget).allowed, false);
});
