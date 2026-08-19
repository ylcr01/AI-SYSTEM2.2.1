export const DEFAULT_BUDGETS = Object.freeze({
  quick:60_000,
  standard:300_000,
  controlled:900_000,
  release:1_800_000,
});

function defaultLimit(mode) {
  return DEFAULT_BUDGETS[mode] ?? DEFAULT_BUDGETS.standard;
}

function requirePositiveSafeInteger(value, message) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(message);
}

function resolveLimit(mode, requested) {
  const value = Number(requested ?? defaultLimit(mode));
  return value === Number.MAX_SAFE_INTEGER ? defaultLimit(mode) : value;
}

function resolveSpent(value) {
  const spent = Number(value ?? 0);
  if (!Number.isFinite(spent) || spent < 0) throw new Error('已消费验证预算无效');
  return spent;
}

function nonNegative(value) {
  return Math.max(0, value);
}

export function createBudget(input = {}) {
  const mode = input.mode ?? 'standard';
  const limitMs = resolveLimit(mode, input.limitMs);
  requirePositiveSafeInteger(limitMs, '验证预算必须是大于零的安全整数');
  const spentMs = resolveSpent(input.spentMs);
  return {
    schemaVersion:1,
    mode,
    limitMs,
    spentMs,
    extensions:Array.isArray(input.extensions) ? structuredClone(input.extensions) : [],
  };
}

export function remainingBudget(budget) {
  return nonNegative(budget.limitMs - budget.spentMs);
}

export function consumeBudget(budget, durationMs) {
  const delta = nonNegative(Number(durationMs ?? 0));
  return { ...budget, spentMs:nonNegative(budget.spentMs + delta) };
}

export function extendBudget(budget, input = {}) {
  const additionalMs = Number(input.additionalMs);
  requirePositiveSafeInteger(additionalMs, '追加验证预算必须是大于零的安全整数毫秒数');
  const reason = String(input.reason ?? '').trim();
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
  const allowed = remainingMs > 0;
  return { allowed, remainingMs, reason:allowed ? null : 'budget-exhausted' };
}
