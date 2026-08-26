import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBudget, budgetDecision, consumeBudget, remainingBudget } from './verification-budget.mjs';
import { buildAdapterCheck, evaluateAdapterResult } from './check-adapters.mjs';

const COST = { 'very-low': 0, low: 1, medium: 2, high: 3 };

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateCheck(check, source) {
  if (!check || typeof check.name !== 'string' || typeof check.command !== 'string' || !Array.isArray(check.args)) {
    throw new Error(`${source} 包含无效检查`);
  }
  if (check.acceptanceIds !== undefined && !Array.isArray(check.acceptanceIds)) {
    throw new Error(`${check.name} 的 acceptanceIds 必须是数组`);
  }
  const acceptanceIds = [...new Set(check.acceptanceIds ?? [])];
  if (check.acceptanceMode === 'explicit' || acceptanceIds.length) {
    throw new Error(`${check.name} 是${source}通用检查，不能绑定任务 Acceptance；请使用 task-check-file`);
  }
  const sideEffect = check.sideEffect ?? 'workspace';
  if (!['none', 'workspace', 'external'].includes(sideEffect)) throw new Error(`${check.name} 副作用声明无效`);
  return {
    profiles: ['standard'],
    covers: ['behavior'],
    estimatedCost: 'medium',
    timeoutMs: 600000,
    ...check,
    acceptanceMode: 'none',
    acceptanceIds: [],
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

function canonicalTestFile(gitRoot, file, label) {
  const absolute = path.resolve(gitRoot, file);
  if (!lexicalPathWithin(path.resolve(gitRoot), absolute)) {
    throw new Error(`${label} 越出 Git Root: ${file}`);
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`${label} 不存在或不是文件: ${file}`);
  }
  return path.relative(gitRoot, absolute).split(path.sep).join('/');
}

function validateTaskCase(item, checkName, context, seenIds) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`Task Check ${checkName} 包含无效 case`);
  }
  const id = String(item.id ?? '').trim();
  const testName = String(item.testName ?? '').trim();
  if (!Array.isArray(item.acceptanceIds)) throw new Error(`Task Check ${checkName} 的 case ${id || '<missing>'} acceptanceIds 必须是数组`);
  if (!Array.isArray(item.covers)) throw new Error(`Task Check ${checkName} 的 case ${id || '<missing>'} covers 必须是数组`);
  const acceptanceIds = [...new Set(item.acceptanceIds)].map((value) => String(value).trim()).filter(Boolean);
  const covers = [...new Set(item.covers)].map((value) => String(value).trim()).filter(Boolean);
  const expectedMatches = item.expectedMatches ?? 1;
  if (!id) throw new Error(`Task Check ${checkName} 的 case 缺少 id`);
  if (seenIds.has(id)) throw new Error(`Task Check ${checkName} 的 case id 重复: ${id}`);
  seenIds.add(id);
  if (!testName) throw new Error(`Task Check ${checkName} 的 case ${id} 缺少 testName`);
  if (!acceptanceIds.length) throw new Error(`Task Check ${checkName} 的 case ${id} 必须显式绑定非空 acceptanceIds`);
  if (!covers.length) throw new Error(`Task Check ${checkName} 的 case ${id} 缺少 covers`);
  if (!Number.isSafeInteger(expectedMatches) || expectedMatches <= 0) {
    throw new Error(`Task Check ${checkName} 的 case ${id} expectedMatches 必须是正安全整数`);
  }
  const testFile = canonicalTestFile(context.gitRoot, String(item.testFile ?? '').trim(), `Task Check ${checkName} 的 case ${id} testFile`);
  for (const acceptanceId of acceptanceIds) {
    const acceptance = (context.acceptance ?? []).find((entry) => entry.id === acceptanceId);
    if (!acceptance) throw new Error(`Task Check ${checkName} 的 case ${id} 绑定未知 Acceptance: ${acceptanceId}`);
    if (!covers.some((cover) => (acceptance.requiredCovers ?? []).includes(cover))) {
      throw new Error(`Task Check ${checkName} 的 case ${id} covers 与 Acceptance ${acceptanceId} 的 requiredCovers 无关`);
    }
  }
  return { id, acceptanceIds, covers, testFile, testName, expectedMatches };
}

function validateTaskCheck(check, context) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) {
    throw new Error('Task Check 必须是对象');
  }
  const name = String(check.name ?? '').trim();
  if (!name) throw new Error('Task Check 缺少 name');
  const duplicateFields = ['covers', 'acceptanceIds', 'testFiles'].filter((field) => check[field] !== undefined);
  if (duplicateFields.length) throw new Error(`Task Check v2 ${name} 必须在 cases 中声明 ${duplicateFields.join(', ')}`);
  if (!Array.isArray(check.cases) || !check.cases.length) throw new Error(`Task Check ${name} 必须提供非空 cases`);
  const caseIds = new Set();
  const cases = check.cases.map((item) => validateTaskCase(item, name, context, caseIds));
  const covers = [...new Set(cases.flatMap((item) => item.covers))];
  const acceptanceIds = [...new Set(cases.flatMap((item) => item.acceptanceIds))];
  const testFiles = [...new Set(cases.map((item) => item.testFile))];
  if ((context.projectCheckNames ?? new Set()).has(name) || (context.seen ?? new Set()).has(name)) {
    throw new Error(`Task Check 名称冲突: ${name}`);
  }
  context.seen.add(name);
  const adapter = buildAdapterCheck({ ...check, name, cases, testFiles });
  return {
    name,
    runner: adapter.runner,
    adapterVersion: adapter.adapterVersion,
    resultProtocol: adapter.resultProtocol,
    command: adapter.command,
    args: adapter.args,
    covers,
    acceptanceIds,
    cases,
    testFiles,
    config: check.config ?? {},
    sideEffect: adapter.sideEffect,
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
  if (value.schemaVersion !== 2) throw new Error('新建 task-check-file 必须使用 Schema 2 用例级协议');
  const seen = new Set();
  return value.checks.map((check) => validateTaskCheck(check, { ...options, seen }));
}

function fileHashes(gitRoot, file) {
  const absolute = path.resolve(gitRoot, file);
  const content = fs.readFileSync(absolute);
  const raw = crypto.createHash('sha256').update(content).digest('hex');
  const text = content.toString('utf8');
  const normalized = !text.includes('\u0000') && Buffer.from(text, 'utf8').equals(content)
    ? crypto.createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex')
    : null;
  return { raw, normalized };
}

function storedFileHashMatches(stored, current) {
  return stored === current.raw || (current.normalized && stored === current.normalized);
}

export function createCheckManifest(plan, options = {}) {
  const gitRoot = path.resolve(options.gitRoot ?? options.cwd ?? '.');
  const checks = (plan.checks ?? []).map((check) => ({
    name: check.name,
    runner: check.runner ?? null,
    adapterVersion: check.adapterVersion ?? null,
    resultProtocol: check.resultProtocol ?? null,
    config: check.config ?? null,
    command: check.runner ? null : check.command,
    args: check.runner ? null : check.args,
    profiles: check.profiles ?? [],
    covers: check.covers ?? [],
    acceptanceMode: check.acceptanceMode ?? 'none',
    acceptanceIds: check.acceptanceIds ?? [],
    cases: check.cases ?? [],
    testFiles: check.testFiles ?? [],
    testFileHashes: Object.fromEntries((check.testFiles ?? []).map((file) => {
      const hashes = fileHashes(gitRoot, file);
      return [file, hashes.normalized ?? hashes.raw];
    })),
    sideEffect: check.sideEffect ?? 'workspace',
    estimatedCost: check.estimatedCost ?? 'medium',
    timeoutMs: check.timeoutMs ?? 600000,
    source: check.source ?? 'manifest',
  }));
  return {
    schemaVersion: 2,
    planFingerprint: plan.fingerprint,
    checks,
    createdAt: new Date().toISOString(),
  };
}

export function checksFromManifest(manifest, options = {}) {
  if (!manifest || ![1, 2].includes(manifest.schemaVersion) || !Array.isArray(manifest.checks)) {
    throw new Error('Check Manifest 无效或版本不受支持');
  }
  const gitRoot = path.resolve(options.gitRoot ?? options.cwd ?? '.');
  return manifest.checks.map((stored) => {
    for (const file of stored.testFiles ?? []) {
      const absolute = path.resolve(gitRoot, file);
      const current = fs.existsSync(absolute) && fs.statSync(absolute).isFile()
        ? fileHashes(gitRoot, file)
        : null;
      if (!current || !storedFileHashMatches(stored.testFileHashes?.[file], current)) {
        throw new Error(`Check Manifest 测试输入已变化: ${file}`);
      }
    }
    if (stored.runner) {
      const legacy = manifest.schemaVersion === 1;
      if (legacy && stored.acceptanceMode === 'explicit' && (stored.acceptanceIds ?? []).length) {
        throw new Error(`旧 Check Manifest ${stored.name} 只依据退出码，不能继续作为 Acceptance 证明；请重新交付并生成 Schema 2 用例级检查`);
      }
      const adapter = buildAdapterCheck({
        name: stored.name,
        runner: stored.runner,
        testFiles: stored.testFiles ?? [],
        cases: stored.cases ?? [],
        config: stored.config ?? {},
        legacy,
      });
      if (adapter.adapterVersion !== stored.adapterVersion) {
        throw new Error(`Check Manifest Runner 版本已变化: ${stored.name}`);
      }
      if (!legacy && adapter.resultProtocol !== stored.resultProtocol) {
        throw new Error(`Check Manifest Runner 结果协议已变化: ${stored.name}`);
      }
      return { ...stored, ...adapter, source: 'check-manifest' };
    }
    if (!stored.command || !Array.isArray(stored.args)) throw new Error(`Check Manifest 检查定义无效: ${stored.name}`);
    return { ...stored, source: 'check-manifest' };
  });
}

export function acceptanceIdsForCheck(check, acceptance = []) {
  if (check.acceptanceMode === 'none') return [];
  if (check.acceptanceMode !== 'explicit') return [];
  return (check.acceptanceIds ?? []).filter((id) => acceptance.some((item) => item.id === id));
}

function acceptanceCoverPairsForCheck(check, acceptance = []) {
  const knownAcceptanceIds = new Set(acceptance.map((item) => item.id));
  const pairs = new Set();
  if (Array.isArray(check.cases) && check.cases.length) {
    for (const item of check.cases) {
      for (const acceptanceId of item.acceptanceIds ?? []) {
        if (!knownAcceptanceIds.has(acceptanceId)) continue;
        for (const cover of item.covers ?? []) pairs.add(`${acceptanceId}\u0000${cover}`);
      }
    }
    return pairs;
  }
  for (const acceptanceId of acceptanceIdsForCheck(check, acceptance)) {
    for (const cover of check.covers ?? []) pairs.add(`${acceptanceId}\u0000${cover}`);
  }
  return pairs;
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
  const availablePairs = acceptanceCoverPairsForCheck(check, acceptance);
  const pairs = [];
  for (const requirement of pairRequired.values()) {
    const key = `${requirement.acceptanceId}\u0000${requirement.cover}`;
    if (!pairCovered.has(key) && availablePairs.has(key)) pairs.push(requirement);
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
    .sort((left, right) => {
      const proofOrder = Number(acceptanceCoverPairsForCheck(right, acceptance).size > 0)
        - Number(acceptanceCoverPairsForCheck(left, acceptance).size > 0);
      return proofOrder || (COST[left.estimatedCost] ?? 2) - (COST[right.estimatedCost] ?? 2);
    });

  const selected = [];
  for (const proofPass of [true, false]) {
    if (!proofPass && [...pairRequired].some(([key]) => !pairCovered.has(key))) break;
    for (const check of candidates) {
      const provesAcceptance = acceptanceCoverPairsForCheck(check, acceptance).size > 0;
      if (provesAcceptance !== proofPass) continue;
      const contribution = checkContributions(check, acceptance, required, covered, pairRequired, pairCovered);
      if (!contribution.global.length && !contribution.pairs.length) continue;
      selected.push(check);
      for (const cover of check.covers ?? []) covered.add(cover);
      for (const item of contribution.pairs) pairCovered.add(`${item.acceptanceId}\u0000${item.cover}`);
    }
  }

  const missingCovers = [...required].filter((cover) => !covered.has(cover));
  const missingAcceptanceCovers = [...pairRequired.values()].filter((item) => !pairCovered.has(`${item.acceptanceId}\u0000${item.cover}`));
  const missingAcceptance = [...new Set(missingAcceptanceCovers.map((item) => item.acceptanceId))];
  const gapsByAcceptance = new Map();
  for (const item of missingAcceptanceCovers) {
    const entry = gapsByAcceptance.get(item.acceptanceId) ?? { acceptanceId: item.acceptanceId, missingCovers: [] };
    entry.missingCovers.push(item.cover);
    gapsByAcceptance.set(item.acceptanceId, entry);
  }
  const gaps = [...gapsByAcceptance.values()].map((item) => {
    const found = acceptance.find((entry) => entry.id === item.acceptanceId);
    return { acceptanceId: item.acceptanceId, description: found?.description ?? null, missingCovers: item.missingCovers };
  });
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    selected: selected.map((check) => ({
      name: check.name,
      command: check.command,
      args: check.args,
      runner: check.runner ?? null,
      adapterVersion: check.adapterVersion ?? null,
      resultProtocol: check.resultProtocol ?? null,
      config: check.config ?? null,
      covers: check.covers,
      acceptanceMode: check.acceptanceMode,
      acceptanceIds: check.acceptanceIds ?? [],
      cases: check.cases ?? []
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
    gaps,
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
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(resolved.command, [...resolved.prefix, ...check.args], {
    cwd,
    env: childEnv,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024
  });
  const finishedAt = new Date().toISOString();
  const adapterResult = evaluateAdapterResult(check, {
    cwd,
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    error: result.error?.message ?? null,
  });
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
    error: result.error?.message ?? adapterResult.error ?? null,
    runner: check.runner ?? null,
    adapterVersion: check.adapterVersion ?? null,
    resultProtocol: check.resultProtocol ?? null,
    covers: check.covers ?? [],
    source: check.source,
    sideEffect: check.sideEffect,
    acceptanceMode: check.acceptanceMode,
    acceptanceIds: check.acceptanceIds ?? [],
    cases: check.cases ?? [],
    caseResults: adapterResult.caseResults ?? [],
    caseSummary: adapterResult.caseSummary ?? null,
    testFiles: check.testFiles ?? [],
    artifacts: check.artifacts ?? []
  };
  output.resultFingerprint = crypto.createHash('sha256').update(JSON.stringify({
    status: output.status,
    stdout: output.stdout,
    stderr: output.stderr,
    error: output.error,
    caseResults: output.caseResults,
    caseSummary: output.caseSummary
  })).digest('hex');
  return output;
}

export function checkExecutionFingerprint(check, options = {}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    cwd: path.resolve(options.cwd ?? '.'),
    command: check.command,
    args: check.args ?? [],
    runner: check.runner ?? null,
    adapterVersion: check.adapterVersion ?? null,
    resultProtocol: check.resultProtocol ?? null,
    config: check.config ?? null,
    testFiles: check.testFiles ?? [],
    cases: check.cases ?? [],
    sideEffect: check.sideEffect ?? 'workspace',
    timeoutMs: Number(check.timeoutMs ?? 600000),
  })).digest('hex');
}

function reuseExecution(previous, check, executionFingerprint) {
  return {
    ...previous,
    name: check.name,
    covers: check.covers ?? [],
    source: check.source,
    sideEffect: check.sideEffect,
    acceptanceMode: check.acceptanceMode,
    acceptanceIds: check.acceptanceIds ?? [],
    cases: check.cases ?? [],
    testFiles: check.testFiles ?? [],
    artifacts: check.artifacts ?? [],
    durationMs: 0,
    executionFingerprint,
    reused: true,
    reusedFrom: previous.name,
  };
}

export function executeCheckPlan(plan, options = {}) {
  if ((plan.checks ?? []).some((check) => check.sideEffect === 'external')) throw new Error('自动检查禁止执行外部写入');
  let budget = createBudget(options.budget ?? { mode: plan.profile });
  const results = [];
  const executions = new Map();
  for (const check of plan.checks ?? []) {
    const executionFingerprint = checkExecutionFingerprint(check, { cwd: options.cwd });
    const previous = executions.get(executionFingerprint);
    if (previous) {
      results.push(reuseExecution(previous, check, executionFingerprint));
      continue;
    }
    const decision = budgetDecision(budget);
    if (!decision.allowed) return { ok: false, status: 'unavailable', stopReason: 'budget', results, budget };
    const remainingMs = remainingBudget(budget);
    const checkTimeoutMs = Number(check.timeoutMs ?? 600000);
    const budgetLimited = remainingMs <= checkTimeoutMs;
    const timeout = Math.max(1, Math.min(checkTimeoutMs, remainingMs));
    const result = { ...executeOne(check, options.cwd, timeout), executionFingerprint, reused: false, reusedFrom: null };
    executions.set(executionFingerprint, result);
    budget = consumeBudget(budget, result.durationMs);
    results.push(result);
    if (result.status !== 0 || result.error) {
      const timedOut = /ETIMEDOUT|timed out/iu.test(result.error ?? '');
      const stopReason = timedOut ? (budgetLimited ? 'budget' : 'timeout') : 'failed';
      return { ok: false, status: timedOut ? 'unavailable' : 'failed', results, budget, stopReason };
    }
  }
  const ok = results.length === (plan.checks ?? []).length && results.every((item) => item.status === 0 && !item.error);
  return {
    ok,
    status: ok ? 'passed' : 'unavailable',
    results,
    budget,
    executedCount: results.filter((item) => item.reused !== true).length,
    reusedCount: results.filter((item) => item.reused === true).length,
  };
}
