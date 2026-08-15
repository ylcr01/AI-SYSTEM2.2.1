export const DEFAULT_BUDGETS = Object.freeze({
  quick:60_000,
  standard:300_000,
  controlled:900_000,
  release:1_800_000,
});

export function createBudget(input = {}) {
  const mode = input.mode ?? 'standard';
  const requestedLimitMs = Number(input.limitMs ?? DEFAULT_BUDGETS[mode] ?? DEFAULT_BUDGETS.standard);
  const limitMs = requestedLimitMs === Number.MAX_SAFE_INTEGER
    ? DEFAULT_BUDGETS[mode] ?? DEFAULT_BUDGETS.standard
    : requestedLimitMs;
  const spentMs = Number(input.spentMs ?? 0);
  if (!Number.isSafeInteger(limitMs) || limitMs <= 0) throw new Error('验证预算必须是大于零的安全整数');
  if (!Number.isFinite(spentMs) || spentMs < 0) throw new Error('已消费验证预算无效');
  return {
    schemaVersion:1,
    mode,
    limitMs,
    spentMs,
    extensions:Array.isArray(input.extensions) ? structuredClone(input.extensions) : [],
  };
}

export function remainingBudget(budget) {
  return Math.max(0, budget.limitMs - budget.spentMs);
}

export function consumeBudget(budget, durationMs) {
  return { ...budget, spentMs:Math.max(0, budget.spentMs + Math.max(0, Number(durationMs ?? 0))) };
}

export function extendBudget(budget, input = {}) {
  const additionalMs = Number(input.additionalMs);
  const reason = String(input.reason ?? '').trim();
  if (!Number.isSafeInteger(additionalMs) || additionalMs <= 0) throw new Error('追加验证预算必须是大于零的安全整数毫秒数');
  if (!reason) throw new Error('追加验证预算必须说明原因');
  const normalized = createBudget(budget);
  const nextLimit = normalized.limitMs + additionalMs;
  if (!Number.isSafeInteger(nextLimit)) throw new Error('追加后的验证预算超出安全范围');
  const extension = {
    additionalMs,
    reason,
    extendedAt:input.extendedAt ?? new Date().toISOString(),
  };
  return {
    ...normalized,
    limitMs:nextLimit,
    extensions:[...normalized.extensions, extension],
  };
}

export function budgetDecision(budget) {
  const remainingMs = remainingBudget(budget);
  return { allowed:remainingMs > 0, remainingMs, reason:remainingMs > 0 ? null : 'budget-exhausted' };
}
