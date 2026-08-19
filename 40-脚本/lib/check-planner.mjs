import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBudget, budgetDecision, consumeBudget, remainingBudget } from './verification-budget.mjs';

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
  return {
    profiles: ['standard'],
    covers: ['behavior'],
    estimatedCost: 'medium',
    timeoutMs: 600000,
    acceptanceMode: 'matching-covers',
    ...check,
    acceptanceIds: [...new Set(check.acceptanceIds ?? [])],
    sideEffect,
    source
  };
}

function lexicalPathWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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
    estimatedCost: name === 'build' ? 'high' : 'medium'
  }, 'package.json'));
}

export function loadChecks(cwd, options = {}) {
  const project = readJson(path.join(cwd, '.ai', 'checks.json'), { schemaVersion: 4, packageFallback: { mode: 'none' }, checks: [] });
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

function validateTaskCheck(check, context) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) {
    throw new Error('Task Check 必须是对象');
  }
  const name = String(check.name ?? '').trim();
  const command = String(check.command ?? '').trim();
  const args = Array.isArray(check.args) ? check.args.map((item) => String(item)) : null;
  const covers = [...new Set(check.covers ?? [])].map((item) => String(item).trim()).filter(Boolean);
  const acceptanceIds = [...new Set(check.acceptanceIds ?? [])].map((item) => String(item).trim()).filter(Boolean);
  const testFiles = [...new Set(check.testFiles ?? [])].map((item) => String(item ?? '').trim()).filter(Boolean);
  const sideEffect = String(check.sideEffect ?? 'none').trim() || 'none';
  if (!name) throw new Error('Task Check 缺少 name');
  if (!command) throw new Error(`Task Check ${name} 缺少 command`);
  if (!args) throw new Error(`Task Check ${name} 的 args 必须是数组`);
  if (!covers.length) throw new Error(`Task Check ${name} 缺少 covers`);
  if (!acceptanceIds.length) throw new Error(`Task Check ${name} 必须显式绑定非空 acceptanceIds`);
  if (!testFiles.length) throw new Error(`Task Check ${name} 必须提供非空 testFiles`);
  if (!['none', 'workspace'].includes(sideEffect)) {
    throw new Error(`Task Check ${name} 禁止 external sideEffect`);
  }
  for (const acceptanceId of acceptanceIds) {
    const acceptance = (context.acceptance ?? []).find((item) => item.id === acceptanceId);
    if (!acceptance) throw new Error(`Task Check ${name} 绑定未知 Acceptance: ${acceptanceId}`);
    const intersects = covers.some((cover) => (acceptance.requiredCovers ?? []).includes(cover));
    if (!intersects) {
      throw new Error(`Task Check ${name} 的 covers 与 Acceptance ${acceptanceId} 的 requiredCovers 无关`);
    }
  }
  for (const testFile of testFiles) {
    const absolute = path.resolve(context.gitRoot, testFile);
    if (!lexicalPathWithin(path.resolve(context.gitRoot), absolute)) {
      throw new Error(`Task Check ${name} 的 testFiles 越出 Git Root: ${testFile}`);
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new Error(`Task Check ${name} 的 testFiles 不存在或不是文件: ${testFile}`);
    }
  }
  if ((context.projectCheckNames ?? new Set()).has(name) || (context.seen ?? new Set()).has(name)) {
    throw new Error(`Task Check 名称冲突: ${name}`);
  }
  context.seen.add(name);
  return {
    name,
    command,
    args,
    covers,
    acceptanceIds,
    testFiles,
    sideEffect,
    estimatedCost: String(check.estimatedCost ?? 'low').trim() || 'low',
    timeoutMs: Number(check.timeoutMs ?? 600000),
    acceptanceMode: 'explicit',
    profiles: ['quick', 'standard', 'controlled', 'release'],
    source: 'task-check-file'
  };
}

export function loadTaskChecks(file, options = {}) {
  if (!file) return [];
  let value;
  try {
    value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 task-check-file: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.checks)) {
    throw new Error('task-check-file 必须是包含 checks 数组的 JSON 对象');
  }
  const seen = new Set();
  return value.checks.map((check) => validateTaskCheck(check, { ...options, seen }));
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

export function resolveCommand(command, options = {}) {
  const platform = options.platform ?? process.platform;
  const comSpec = options.comSpec ?? process.env.ComSpec ?? 'cmd.exe';
  if (command === 'node') return { command: process.execPath, prefix: [] };
  if (platform !== 'win32') return { command, prefix: [] };
  if (/\.(cmd|bat)$/iu.test(command)) return { command: comSpec, prefix: ['/d', '/s', '/c', command] };
  if (['npm', 'npx', 'pnpm', 'pnpx'].includes(command)) return { command: comSpec, prefix: ['/d', '/s', '/c', `${command}.cmd`] };
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
    acceptanceMode: check.acceptanceMode,
    acceptanceIds: check.acceptanceIds ?? [],
    testFiles: check.testFiles ?? [],
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
  for (const check of plan.checks ?? []) {
    const decision = budgetDecision(budget);
    if (!decision.allowed) return { ok: false, status: 'unavailable', stopReason: 'budget', results, budget };
    const remainingMs = remainingBudget(budget);
    const checkTimeoutMs = Number(check.timeoutMs ?? 600000);
    const budgetLimited = remainingMs <= checkTimeoutMs;
    const timeout = Math.max(1, Math.min(checkTimeoutMs, remainingMs));
    const result = executeOne(check, options.cwd, timeout);
    budget = consumeBudget(budget, result.durationMs);
    results.push(result);
    if (result.status !== 0 || result.error) {
      const timedOut = /ETIMEDOUT|timed out/iu.test(result.error ?? '');
      const stopReason = timedOut ? (budgetLimited ? 'budget' : 'timeout') : 'failed';
      return { ok: false, status: timedOut ? 'unavailable' : 'failed', results, budget, stopReason };
    }
  }
  const ok = results.length === (plan.checks ?? []).length && results.every((item) => item.status === 0 && !item.error);
  return { ok, status: ok ? 'passed' : 'unavailable', results, budget };
}
