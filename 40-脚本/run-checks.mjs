import path from 'node:path';
import { parseArgs, listArg } from './lib/args.mjs';
import { loadChecks, planChecks, executeCheckPlan } from './lib/check-planner.mjs';
import { DEFAULT_BUDGETS } from './lib/verification-budget.mjs';

function compactPlan(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    profile: plan.profile,
    checks: (plan.checks ?? []).map(({ name, covers, estimatedCost }) => ({ name, covers, estimatedCost })),
    missingCovers: plan.missingCovers ?? [],
    missingAcceptance: plan.missingAcceptance ?? [],
    missingAcceptanceCovers: plan.missingAcceptanceCovers ?? [],
    gaps: plan.gaps ?? [],
    fingerprint: plan.fingerprint,
  };
}

function compactResult(result) {
  const results = (result.results ?? []).map(item => ({
    name: item.name,
    status: item.status,
    durationMs: item.durationMs,
    covers: item.covers ?? [],
    caseSummary: item.caseSummary ?? null,
    executionFingerprint: item.executionFingerprint,
    reused: item.reused === true,
    reusedFrom: item.reusedFrom ?? null,
  }));
  const failed = (result.results ?? []).find(item => item.status !== 0 || item.error);
  return {
    ok: result.ok,
    status: result.status,
    stopReason: result.stopReason ?? null,
    results,
    executedCount: result.executedCount ?? results.filter(item => !item.reused).length,
    reusedCount: result.reusedCount ?? results.filter(item => item.reused).length,
    budget: result.budget,
    firstFailure: failed ? {
      name: failed.name,
      status: failed.status,
      error: failed.error,
      durationMs: failed.durationMs,
      stdout: failed.stdout,
      stderr: failed.stderr,
      caseSummary: failed.caseSummary ?? null,
      caseResults: failed.caseResults ?? [],
    } : null,
  };
}

const args = parseArgs(process.argv.slice(2));

try {
  const cwd = path.resolve(args.cwd ?? process.cwd());
  const profile = String(args.profile ?? 'standard');
  if (args.continue === true || args['continuation-note']) {
    throw new Error('无限继续参数已移除；Task 验证请使用“继续验证 --additional-budget-ms <毫秒> --reason <原因>”');
  }
  const checks = loadChecks(cwd);
  const requested = listArg(args.covers);
  const plan = planChecks({
    cwd,
    profile,
    requiredCovers: requested.length ? requested : ['static', 'behavior'],
    checks,
  });
  if (!args.execute) {
    console.log(JSON.stringify({ mode: 'plan', cwd, ...(args.full === true ? plan : compactPlan(plan)) }, null, 2));
  } else {
    const result = executeCheckPlan(plan, {
      cwd,
      budget: {
        mode: profile,
        limitMs: Number(args['budget-ms'] ?? DEFAULT_BUDGETS[profile] ?? DEFAULT_BUDGETS.standard),
      },
    });
    console.log(JSON.stringify({
      mode: 'execute',
      cwd,
      plan: args.full === true ? plan : compactPlan(plan),
      ...(args.full === true ? result : compactResult(result)),
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
} catch (error) {
  console.error(`检查失败: ${error.message}`);
  process.exitCode = 1;
}
