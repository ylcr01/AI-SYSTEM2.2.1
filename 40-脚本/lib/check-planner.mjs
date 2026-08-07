import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBudget, budgetDecision, consumeBudget, remainingBudget } from './verification-budget.mjs';
import { cacheEligible, checkCacheKey, lookupCheckCache, saveCheckCache } from './check-cache.mjs';

const COST = { 'very-low': 0, low: 1, medium: 2, high: 3 };

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateCheck(check, source) {
  if (!check || typeof check.name !== 'string' || typeof check.command !== 'string' || !Array.isArray(check.args)) {
    throw new Error(`${source} 包含无效检查`);
  }
  const sideEffect = check.sideEffect ?? 'workspace';
  if (!['none', 'workspace', 'external'].includes(sideEffect)) throw new Error(`${check.name} 副作用声明无效`);
  if (check.cacheable === true && sideEffect !== 'none') throw new Error(`${check.name} 只有无副作用检查可以缓存`);
  return {
    profiles: ['standard'],
    covers: ['behavior'],
    estimatedCost: 'medium',
    timeoutMs: 600000,
    cacheable: false,
    acceptanceMode: 'matching-covers',
    ...check,
    acceptanceIds: [...new Set(check.acceptanceIds ?? [])],
    sideEffect,
    source
  };
}

function packageChecks(root, fallback) {
  if (!fallback || fallback.mode === 'none') return [];
  const pkg = readJson(path.join(root, 'package.json'));
  if (!pkg?.scripts) return [];
  const requested = fallback.mode === 'selected' ? (fallback.scripts ?? []) : ['typecheck', 'lint', 'test', 'build'];
  return requested.filter((name) => pkg.scripts[name]).map((name) => validateCheck({
    name: `package-${name}`,
    command: 'npm',
    args: ['run', name],
    profiles: name === 'build' ? ['controlled', 'release'] : ['standard', 'controlled', 'release'],
    covers: name === 'typecheck' ? ['typecheck'] : name === 'lint' ? ['static'] : name === 'build' ? ['package'] : ['unit', 'behavior'],
    sideEffect: 'workspace',
    cacheable: false,
    estimatedCost: name === 'build' ? 'high' : 'medium'
  }, 'package.json'));
}

export function loadChecks(cwd, options = {}) {
  const project = readJson(path.join(cwd, '.ai', 'checks.json'), { schemaVersion: 4, packageFallback: { mode: 'auto' }, checks: [] });
  const template = options.templateRoot
    ? readJson(path.join(options.templateRoot, '.ai', 'checks.json'), { checks: [] })
    : { checks: [] };
  const declared = [
    ...(template?.checks ?? []).map((check) => validateCheck(check, 'template')),
    ...(project?.checks ?? []).map((check) => validateCheck(check, 'project'))
  ];
  const names = new Set(declared.map((check) => check.name));
  return [
    ...packageChecks(cwd, project?.packageFallback).filter((check) => !names.has(check.name)),
    ...declared
  ];
}

export function acceptanceIdsForCheck(check, acceptance = []) {
  if (check.acceptanceMode === 'none') return [];
  if (check.acceptanceMode === 'all') return acceptance.map((item) => item.id);
  if (check.acceptanceIds?.length) return check.acceptanceIds.filter((id) => acceptance.some((item) => item.id === id));
  const covers = new Set(check.covers ?? []);
  return acceptance
    .filter((item) => (item.requiredCovers ?? []).some((cover) => covers.has(cover)))
    .map((item) => item.id);
}

function acceptanceRequirements(acceptance, existingCoverage = {}) {
  const requirements = new Map();
  for (const item of acceptance ?? []) {
    const existing = new Set(existingCoverage[item.id]?.covers ?? []);
    for (const cover of item.requiredCovers ?? []) {
      if (!existing.has(cover)) requirements.set(`${item.id}\u0000${cover}`, { acceptanceId: item.id, cover });
    }
  }
  return requirements;
}

function checkContributions(check, acceptance, globalRequired, globalCovered, pairRequired, pairCovered) {
  const global = (check.covers ?? []).filter((cover) => globalRequired.has(cover) && !globalCovered.has(cover));
  const boundIds = new Set(acceptanceIdsForCheck(check, acceptance));
  const pairs = [];
  for (const requirement of pairRequired.values()) {
    const key = `${requirement.acceptanceId}\u0000${requirement.cover}`;
    if (!pairCovered.has(key) && boundIds.has(requirement.acceptanceId) && (check.covers ?? []).includes(requirement.cover)) {
      pairs.push(requirement);
    }
  }
  return { global, pairs };
}

export function planChecks(input = {}) {
  const required = new Set(input.requiredCovers ?? []);
  const covered = new Set(input.existingCovers ?? []);
  const acceptance = input.acceptance ?? [];
  const pairRequired = acceptanceRequirements(acceptance, input.acceptanceCoverage ?? {});
  const pairCovered = new Set();
  const profile = input.profile ?? 'standard';
  const candidates = (input.checks ?? loadChecks(input.cwd, input))
    .filter((check) => (check.profiles ?? []).includes(profile))
    .filter((check) => check.sideEffect !== 'external')
    .sort((left, right) => (COST[left.estimatedCost] ?? 2) - (COST[right.estimatedCost] ?? 2));

  const selected = [];
  for (const check of candidates) {
    const contribution = checkContributions(check, acceptance, required, covered, pairRequired, pairCovered);
    if (!contribution.global.length && !contribution.pairs.length) continue;
    selected.push(check);
    for (const cover of check.covers ?? []) covered.add(cover);
    for (const item of contribution.pairs) pairCovered.add(`${item.acceptanceId}\u0000${item.cover}`);
  }

  const missingCovers = [...required].filter((cover) => !covered.has(cover));
  const missingAcceptanceCovers = [...pairRequired.values()].filter((item) => !pairCovered.has(`${item.acceptanceId}\u0000${item.cover}`));
  const missingAcceptance = [...new Set(missingAcceptanceCovers.map((item) => item.acceptanceId))];
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    selected: selected.map((check) => ({
      name: check.name,
      command: check.command,
      args: check.args,
      covers: check.covers,
      acceptanceMode: check.acceptanceMode,
      acceptanceIds: check.acceptanceIds ?? []
    })),
    missingCovers,
    missingAcceptanceCovers
  })).digest('hex');

  return {
    schemaVersion: 4,
    profile,
    checks: selected,
    missingCovers,
    missingAcceptance,
    missingAcceptanceCovers,
    fingerprint
  };
}

function tail(value, max = 5000) {
  const text = String(value ?? '');
  return { text: text.slice(-max), bytes: Buffer.byteLength(text), truncated: text.length > max };
}

function resolveCommand(command) {
  if (process.platform !== 'win32') return { command, prefix: [] };
  if (/\.(cmd|bat)$/iu.test(command)) return { command: process.env.ComSpec ?? 'cmd.exe', prefix: ['/d', '/s', '/c', command] };
  if (['npm', 'npx'].includes(command)) return { command: process.env.ComSpec ?? 'cmd.exe', prefix: ['/d', '/s', '/c', `${command}.cmd`] };
  return { command, prefix: [] };
}

function executeOne(check, cwd, timeoutMs) {
  const resolved = resolveCommand(check.command);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(resolved.command, [...resolved.prefix, ...check.args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024
  });
  const finishedAt = new Date().toISOString();
  const output = {
    name: check.name,
    command: check.command,
    args: check.args,
    cwd,
    startedAt,
    finishedAt,
    status: result.status,
    durationMs: Date.now() - started,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
    error: result.error?.message ?? null,
    covers: check.covers ?? [],
    source: check.source,
    sideEffect: check.sideEffect,
    cacheable: check.cacheable === true,
    acceptanceMode: check.acceptanceMode,
    acceptanceIds: check.acceptanceIds ?? [],
    artifacts: check.artifacts ?? []
  };
  output.resultFingerprint = crypto.createHash('sha256').update(JSON.stringify({
    status: output.status,
    stdout: output.stdout,
    stderr: output.stderr,
    error: output.error
  })).digest('hex');
  return output;
}

export function executeCheckPlan(plan, options = {}) {
  if ((plan.checks ?? []).some((check) => check.sideEffect === 'external')) throw new Error('自动检查禁止执行外部写入');
  let budget = createBudget(options.budget ?? { mode: plan.profile });
  const results = [];
  const cacheFile = options.cacheFile ?? path.join(options.stateRoot ?? process.cwd(), 'check-cache.json');
  for (const check of plan.checks ?? []) {
    const decision = budgetDecision(budget);
    if (!decision.allowed) return { ok: false, status: 'unavailable', stopReason: 'budget', results, budget };
    const key = checkCacheKey({
      taskId: options.taskId,
      acceptanceFingerprint: options.acceptanceFingerprint,
      planFingerprint: plan.fingerprint,
      changeFingerprint: options.changeFingerprint,
      inputCycle: options.inputCycle ?? 0,
      command: check.command,
      args: check.args,
      cwd: options.cwd,
      dependencyFingerprint: options.dependencyFingerprint,
      configFingerprint: options.configFingerprint,
      environmentIdentity: options.environmentIdentity
    });
    if (cacheEligible(check)) {
      const cached = lookupCheckCache(cacheFile, key, { cwd: options.cwd });
      if (cached?.status === 0 && !cached.error) {
        results.push({ ...cached, reused: true, cacheKey: key, durationMs: 0 });
        continue;
      }
    }
    const timeout = Math.max(1, Math.min(Number(check.timeoutMs ?? 600000), remainingBudget(budget)));
    const result = executeOne(check, options.cwd, timeout);
    budget = consumeBudget(budget, result.durationMs);
    result.cacheKey = key;
    result.reused = false;
    results.push(result);
    if (cacheEligible(check) && result.status === 0 && !result.error) saveCheckCache(cacheFile, key, result);
    if (result.status !== 0 || result.error) {
      const timedOut = result.error?.includes('timed out');
      return { ok: false, status: timedOut ? 'unavailable' : 'failed', results, budget, stopReason: timedOut ? 'timeout' : 'failed' };
    }
  }
  const ok = results.length === (plan.checks ?? []).length && results.every((item) => item.status === 0 && !item.error);
  return { ok, status: ok ? 'passed' : 'unavailable', results, budget };
}
