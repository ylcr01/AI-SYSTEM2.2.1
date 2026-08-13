import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, atomicWriteText } from './atomic-file.mjs';
import { resolveRepositoryPath } from './path-boundary.mjs';
import { findGitRoot, runGit, SYSTEM_ROOT } from './registry.mjs';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const INDEX_RELATIVE = '.ai/workstations/index.json';
const SHARED_RELATIVE = '.ai/workstations/shared.md';
const PLAN_TEMPLATE = path.join(SYSTEM_ROOT, '.ai', 'templates', 'workstations', 'plan.example.json');
const PROFILE_TEMPLATE = path.join(SYSTEM_ROOT, '.ai', 'templates', 'workstations', 'profile-template.md');
const RUNBOOK_TEMPLATE = path.join(SYSTEM_ROOT, '.ai', 'templates', 'workstations', 'runbook-template.md');
const SHARED_TEMPLATE = path.join(SYSTEM_ROOT, '.ai', 'templates', 'workstations', 'shared-template.md');

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${label} JSON 无效: ${error.message}`); }
}

function projectRoot(cwd) {
  const resolved = path.resolve(cwd ?? process.cwd());
  const root = findGitRoot(resolved);
  if (!root) throw new Error(`目标不在可确认的 Git 工作树中: ${resolved}`);
  return root;
}

function stringList(value, label, options = {}) {
  if (value === undefined && options.optional) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label}必须是非空字符串数组`);
  }
  return [...new Set(value.map(item => item.trim()))];
}

function renderList(values, empty = '待确认') {
  return values.length ? values.map(item => `- ${item}`).join('\n') : `- ${empty}`;
}

function renderTemplate(file, values) {
  let content = fs.readFileSync(file, 'utf8');
  for (const [key, value] of Object.entries(values)) content = content.replaceAll(`{{${key}}}`, String(value));
  return content;
}

function normalizePlan(input) {
  if (!input || input.schemaVersion !== 1) throw new Error('工作站方案 schemaVersion 必须是 1');
  const project = input.project ?? {};
  if (!ID_PATTERN.test(project.id ?? '')) throw new Error('project.id 仅允许小写字母、数字和连字符');
  if (typeof project.name !== 'string' || !project.name.trim()) throw new Error('project.name 不能为空');
  if (!Array.isArray(input.workstations) || input.workstations.length === 0) throw new Error('至少需要一个工作站');

  const ids = new Set();
  const workstations = input.workstations.map((item, index) => {
    const label = `workstations[${index}]`;
    if (!ID_PATTERN.test(item?.id ?? '') || ids.has(item.id)) throw new Error(`${label}.id 无效或重复`);
    ids.add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim()) throw new Error(`${label}.name 不能为空`);
    if (typeof item.summary !== 'string' || !item.summary.trim()) throw new Error(`${label}.summary 不能为空`);
    const keywords = stringList(item.keywords, `${label}.keywords`);
    if (!keywords.length) throw new Error(`${label}.keywords 至少需要一项`);
    return {
      id: item.id,
      name: item.name.trim(),
      summary: item.summary.trim(),
      keywords,
      responsibilities: stringList(item.responsibilities, `${label}.responsibilities`, { optional: true }),
      nonGoals: stringList(item.nonGoals, `${label}.nonGoals`, { optional: true }),
      terminology: stringList(item.terminology, `${label}.terminology`, { optional: true }),
      invariants: stringList(item.invariants, `${label}.invariants`, { optional: true }),
      codeEntrypoints: stringList(item.codeEntrypoints, `${label}.codeEntrypoints`, { optional: true }),
      dependencies: stringList(item.dependencies, `${label}.dependencies`, { optional: true }),
      validation: stringList(item.validation, `${label}.validation`, { optional: true }),
      futureDirection: stringList(item.futureDirection, `${label}.futureDirection`, { optional: true }),
    };
  });

  const shared = input.shared ?? {};
  return {
    schemaVersion: 1,
    project: { id: project.id, name: project.name.trim() },
    shared: {
      principles: stringList(shared.principles, 'shared.principles', { optional: true }),
      hotspots: stringList(shared.hotspots, 'shared.hotspots', { optional: true }),
      integrationRules: stringList(shared.integrationRules, 'shared.integrationRules', { optional: true }),
    },
    workstations,
  };
}

function workstationPaths(item) {
  return {
    profile: `.ai/workstations/${item.id}/profile.md`,
    runbook: `.ai/workstations/${item.id}/runbook.md`,
  };
}

export function loadWorkstationIndex(root, options = {}) {
  const repositoryRoot = projectRoot(root);
  const indexFile = path.join(repositoryRoot, INDEX_RELATIVE);
  if (!fs.existsSync(indexFile)) {
    if (options.required) throw new Error(`项目尚未初始化工作站: ${indexFile}`);
    return null;
  }
  return { root: repositoryRoot, file: indexFile, value: readJson(indexFile, '工作站索引') };
}

export function validateWorkstationIndex(root) {
  const loaded = loadWorkstationIndex(root, { required: true });
  const { value, file, root: repositoryRoot } = loaded;
  const errors = [];
  const warnings = [];
  if (value?.schemaVersion !== 1) errors.push('schemaVersion 必须是 1');
  if (!ID_PATTERN.test(value?.project?.id ?? '') || !String(value?.project?.name ?? '').trim()) errors.push('project 身份无效');
  if (value?.contextLoading?.strategy !== 'progressive' || value?.contextLoading?.maxAutoSelected !== 1) {
    errors.push('contextLoading 必须使用 progressive 且 maxAutoSelected 为 1');
  }

  const ids = new Set();
  const keywords = new Map();
  if (!Array.isArray(value?.workstations) || value.workstations.length === 0) errors.push('workstations 必须至少包含一项');
  for (const [index, item] of (value?.workstations ?? []).entries()) {
    const location = `workstations[${index}]`;
    if (!ID_PATTERN.test(item?.id ?? '') || ids.has(item.id)) errors.push(`${location}.id 无效或重复`);
    else ids.add(item.id);
    if (!String(item?.name ?? '').trim() || !String(item?.summary ?? '').trim()) errors.push(`${location} 缺少 name 或 summary`);
    if (!Array.isArray(item?.keywords) || item.keywords.length === 0) errors.push(`${location}.keywords 不能为空`);
    for (const keyword of item?.keywords ?? []) {
      const normalized = String(keyword).trim().toLowerCase();
      if (!normalized) errors.push(`${location}.keywords 包含空值`);
      else {
        const owners = keywords.get(normalized) ?? [];
        owners.push(item.id);
        keywords.set(normalized, owners);
      }
    }
    for (const key of ['profile', 'runbook']) {
      try {
        const expected = workstationPaths(item)[key];
        if (item?.[key] !== expected) errors.push(`${location}.${key} 必须为 ${expected}`);
        const resolved = resolveRepositoryPath(repositoryRoot, item?.[key], { label: `${location}.${key}` }).target;
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) errors.push(`${location}.${key} 文件不存在`);
      } catch (error) { errors.push(error.message); }
    }
  }
  for (const [keyword, owners] of keywords.entries()) {
    if (owners.length > 1) warnings.push(`关键词“${keyword}”同时属于 ${owners.join(', ')}，自动路由时可能需要显式选择`);
  }

  try {
    if (value?.shared !== SHARED_RELATIVE) errors.push(`shared 必须为 ${SHARED_RELATIVE}`);
    const shared = resolveRepositoryPath(repositoryRoot, value?.shared, { label: 'shared' }).target;
    if (!fs.existsSync(shared) || !fs.statSync(shared).isFile()) errors.push('shared 文件不存在');
  } catch (error) { errors.push(error.message); }

  const head = runGit(repositoryRoot, ['rev-parse', 'HEAD']);
  if (head && value?.lastVerifiedCommit && value.lastVerifiedCommit !== head) {
    warnings.push(`档案最后核实于 ${value.lastVerifiedCommit.slice(0, 12)}，当前为 ${head.slice(0, 12)}`);
  }
  return { ok: errors.length === 0, file, root: repositoryRoot, project: value?.project ?? null, workstationCount: value?.workstations?.length ?? 0, errors, warnings };
}

export function routeWorkstation(root, intent, explicitId = null) {
  const loaded = loadWorkstationIndex(root, { required: Boolean(explicitId) });
  if (!loaded) return null;
  const workstations = loaded.value?.workstations ?? [];
  let selected = null;
  let candidates = [];
  if (explicitId) {
    selected = workstations.find(item => item.id === explicitId);
    if (!selected) throw new Error(`工作站不存在: ${explicitId}`);
    candidates = [{ id: selected.id, name: selected.name, score: null }];
  } else {
    const normalized = String(intent ?? '').toLowerCase();
    candidates = workstations.map(item => {
      const terms = [item.id, item.name, ...(item.keywords ?? [])].map(term => String(term).toLowerCase()).filter(Boolean);
      const matched = [...new Set(terms.filter(term => normalized.includes(term)))];
      return { id: item.id, name: item.name, score: matched.reduce((sum, term) => sum + term.length, 0), matched };
    }).filter(item => item.score > 0).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    if (candidates.length && (candidates.length === 1 || candidates[0].score > candidates[1].score)) {
      selected = workstations.find(item => item.id === candidates[0].id);
    }
  }

  const files = [INDEX_RELATIVE];
  if (selected) {
    files.push(loaded.value.shared, selected.profile);
    if (/修改|实现|修复|开发|提交|验证|测试|重构|排查|bug|fix|implement|change|refactor|test/iu.test(String(intent ?? ''))) {
      files.push(selected.runbook);
    }
  }
  return {
    index: INDEX_RELATIVE,
    selected: selected ? { id: selected.id, name: selected.name, summary: selected.summary } : null,
    candidates,
    ambiguous: !selected && candidates.length > 1,
    files: [...new Set(files)].map(relative => resolveRepositoryPath(loaded.root, relative, { label: '工作站资料' }).target),
  };
}

export function analyzeWorkstations(options = {}) {
  const root = projectRoot(options.cwd);
  const loaded = loadWorkstationIndex(root);
  const validation = loaded ? validateWorkstationIndex(root) : null;
  const routing = loaded && String(options.intent ?? '').trim()
    ? routeWorkstation(root, options.intent, options.workstation ?? null)
    : null;
  return {
    schemaVersion: 1,
    mode: loaded ? 'maintain' : 'propose',
    projectRoot: root,
    git: { branch: runGit(root, ['branch', '--show-current']) || null, head: runGit(root, ['rev-parse', 'HEAD']) },
    existing: loaded ? { index: loaded.file, validation, routing } : null,
    planTemplate: PLAN_TEMPLATE,
    next: loaded
      ? ['按任务读取 index 与命中的单个领域档案', '档案与当前代码不一致时以代码为准并更新档案', '完成核实后显式运行“刷新 --confirm-reviewed”']
      : ['读取项目入口、目录、Manifest、规格和关键依赖', '提出按业务能力而非技术目录划分的工作站方案', '由用户确认领域边界后填写方案文件', '在仓库写 Task 内运行“初始化 --plan <文件> --confirm-plan”'],
  };
}

export function initializeWorkstations(options = {}) {
  if (options.confirmPlan !== true) throw new Error('初始化前必须由用户确认领域划分，并传入 --confirm-plan');
  const root = projectRoot(options.cwd);
  const planFile = path.resolve(options.planFile ?? '');
  if (!options.planFile || !fs.existsSync(planFile) || !fs.statSync(planFile).isFile()) throw new Error('必须提供可读取的 --plan JSON 文件');
  const plan = normalizePlan(readJson(planFile, '工作站方案'));
  const targetRoot = path.join(root, '.ai', 'workstations');
  if (fs.existsSync(targetRoot)) throw new Error(`工作站目录已存在，不会覆盖: ${targetRoot}`);

  const head = runGit(root, ['rev-parse', 'HEAD']);
  if (!head) throw new Error('无法读取 Git HEAD');
  const now = new Date().toISOString();
  const pending = path.join(root, '.ai', '.pending');
  const entries = plan.workstations.map(item => ({
    id: item.id,
    name: item.name,
    summary: item.summary,
    status: 'active',
    keywords: item.keywords,
    ...workstationPaths(item),
    lastVerifiedCommit: head,
  }));
  const index = {
    schemaVersion: 1,
    project: plan.project,
    contextLoading: { strategy: 'progressive', maxAutoSelected: 1 },
    shared: SHARED_RELATIVE,
    workstations: entries,
    updatedAt: now,
    lastVerifiedCommit: head,
  };

  fs.mkdirSync(targetRoot, { recursive: true });
  atomicWriteJson(path.join(root, INDEX_RELATIVE), index, pending);
  atomicWriteText(path.join(root, SHARED_RELATIVE), renderTemplate(SHARED_TEMPLATE, {
    project_name: plan.project.name,
    principles: renderList(plan.shared.principles, '暂无额外原则'),
    hotspots: renderList(plan.shared.hotspots, '暂未确认共享热点'),
    integration_rules: renderList(plan.shared.integrationRules, '遵循项目 AGENTS.md 与中央 Task 门禁'),
  }), pending);
  for (const item of plan.workstations) {
    const paths = workstationPaths(item);
    atomicWriteText(path.join(root, paths.profile), renderTemplate(PROFILE_TEMPLATE, {
      id: item.id,
      name: item.name,
      summary: item.summary,
      responsibilities: renderList(item.responsibilities),
      non_goals: renderList(item.nonGoals),
      terminology: renderList(item.terminology),
      invariants: renderList(item.invariants),
      code_entrypoints: renderList(item.codeEntrypoints),
      dependencies: renderList(item.dependencies),
      future_direction: renderList(item.futureDirection),
    }), pending);
    atomicWriteText(path.join(root, paths.runbook), renderTemplate(RUNBOOK_TEMPLATE, {
      id: item.id,
      name: item.name,
      validation: renderList(item.validation, '按项目 Manifest 和变更范围选择验证'),
    }), pending);
  }
  const validation = validateWorkstationIndex(root);
  if (!validation.ok) throw new Error(`初始化后检查失败: ${validation.errors.join('; ')}`);
  return { ok: true, root, index: path.join(root, INDEX_RELATIVE), workstationCount: entries.length, files: [INDEX_RELATIVE, SHARED_RELATIVE, ...entries.flatMap(item => [item.profile, item.runbook])] };
}

export function refreshWorkstations(options = {}) {
  if (options.confirmReviewed !== true) throw new Error('刷新只记录已人工/模型核实的结果，必须传入 --confirm-reviewed');
  const loaded = loadWorkstationIndex(options.cwd, { required: true });
  const validation = validateWorkstationIndex(loaded.root);
  if (!validation.ok) throw new Error(`工作站检查失败: ${validation.errors.join('; ')}`);
  const head = runGit(loaded.root, ['rev-parse', 'HEAD']);
  const updated = {
    ...loaded.value,
    workstations: loaded.value.workstations.map(item => ({ ...item, lastVerifiedCommit: head })),
    updatedAt: new Date().toISOString(),
    lastVerifiedCommit: head,
  };
  atomicWriteJson(loaded.file, updated, path.join(loaded.root, '.ai', '.pending'));
  return { ok: true, file: loaded.file, lastVerifiedCommit: head, workstationCount: updated.workstations.length };
}

export { INDEX_RELATIVE, PLAN_TEMPLATE };
