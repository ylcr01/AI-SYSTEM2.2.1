import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SYSTEM_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
export const VALID_ROLES = new Set(['web', 'app', 'server', 'docs', 'ops', 'other']);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

export function normalizeRemote(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replaceAll('\\', '/')
    .replace(/^ssh:\/\/git@/iu, '').replace(/^git@([^:]+):/iu, '$1/')
    .replace(/^(https?|git):\/\//iu, '').replace(/^[^@/]+@/u, '')
    .replace(/\/+$/u, '').replace(/\.git$/iu, '').toLowerCase();
}

export function normalizePath(value) {
  if (!value) return '';
  const resolved = path.resolve(value);
  let actual = resolved;
  try { actual = fs.realpathSync.native(resolved); } catch {}
  const normalized = actual.replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function pathContains(parentPath, childPath) {
  const parent = normalizePath(parentPath);
  const child = normalizePath(childPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export function realDirectory(value) {
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error(`目标路径不可访问: ${resolved}`);
  return fs.realpathSync.native(resolved);
}

export function runGit(cwd, args, timeout = 10000) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024
  });
  return result.status === 0 && !result.error ? result.stdout.trim() : null;
}

export function findGitRoot(cwd) {
  const root = runGit(cwd, ['rev-parse', '--show-toplevel']);
  return root ? path.resolve(root) : null;
}

export function getGitRemote(gitRoot) {
  const origin = runGit(gitRoot, ['remote', 'get-url', 'origin']);
  if (origin) return origin;
  const names = runGit(gitRoot, ['remote']);
  const first = names?.split(/\r?\n/u).filter(Boolean)[0];
  return first ? runGit(gitRoot, ['remote', 'get-url', first]) : null;
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`JSON 解析失败 ${file}: ${error.message}`); }
}

export function loadRegistry(root = SYSTEM_ROOT) {
  const dir = path.join(root, '10-注册表');
  return {
    root,
    templates: readJson(path.join(dir, 'templates.json'), { schemaVersion: 1, templates: [] }),
    projects: readJson(path.join(dir, 'projects.json'), { schemaVersion: 1, projects: [] }),
    localPaths: readJson(path.join(dir, 'local.paths.json'), {})
  };
}

function validRelative(value) {
  return typeof value === 'string' && value.length > 0
    && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)
    && !value.includes('\\') && !value.split('/').some((part) => ['.', '..'].includes(part))
    && path.posix.normalize(value) === value;
}

export function validateRegistry(registry) {
  const errors = []; const warnings = [];
  const ids = new Set(); const pathKeys = new Set(); const remoteOwners = new Map();
  const templates = registry.templates?.templates; const projects = registry.projects?.projects;
  if (registry.templates?.schemaVersion !== 1 || !Array.isArray(templates)) errors.push({ location: 'templates', message: '模板注册表无效' });
  if (registry.projects?.schemaVersion !== 1 || !Array.isArray(projects)) errors.push({ location: 'projects', message: '项目注册表无效' });

  function addId(id, location) {
    if (!ID_PATTERN.test(id ?? '') || ids.has(id)) { errors.push({ location, message: 'ID 无效或重复' }); return false; }
    ids.add(id); return true;
  }
  function addPathKey(key, location) {
    if (!key || pathKeys.has(key)) { errors.push({ location, message: '路径键无效或重复' }); return; }
    pathKeys.add(key);
  }
  function addIdentity(kind, id, remote, subpath = null) {
    const key = normalizeRemote(remote); if (!key || !key.includes('/')) { errors.push({ location: `${kind}.${id}`, message: 'Remote 无效' }); return; }
    const list = remoteOwners.get(key) ?? [];
    const overlap = (a,b) => !a || !b || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
    if (list.some((item) => item.kind === 'template' || kind === 'template' || overlap(item.subpath, subpath))) {
      errors.push({ location: `${kind}.${id}`, message: `Remote 身份冲突: ${key}` });
    }
    list.push({ kind, id, subpath }); remoteOwners.set(key, list);
  }

  const templateById = new Map();
  for (const template of templates ?? []) {
    if (!template || !addId(template.id, 'templates')) continue;
    templateById.set(template.id, template);
    if (!VALID_ROLES.has(template.role)) errors.push({ location: template.id, message: '模板角色无效' });
    addPathKey(template.localPathKey, template.id);
    if (!validRelative(template.entrypoints?.agents) || !validRelative(template.entrypoints?.manifest)) errors.push({ location: template.id, message: '模板入口必须是仓库内相对路径' });
    if (template.quality?.manifest && !validRelative(template.quality.manifest)) errors.push({ location: template.id, message: '质量清单路径无效' });
    if (template.enabled !== false) addIdentity('template', template.id, template.repository?.canonicalRemote);
  }

  for (const project of projects ?? []) {
    if (!project || !addId(project.id, 'projects')) continue;
    addPathKey(project.localPathKey, project.id);
    if (!validRelative(project.entrypoints?.agents)) errors.push({ location: project.id, message: '项目入口路径无效' });
    if (!Array.isArray(project.modules)) { errors.push({ location: project.id, message: 'modules 必须是数组' }); continue; }
    for (const module of project.modules) {
      addId(module.id, project.id); addPathKey(module.localPathKey, module.id);
      if (!VALID_ROLES.has(module.role)) errors.push({ location: module.id, message: '模块角色无效' });
      if (module.subpath && !validRelative(module.subpath)) errors.push({ location: module.id, message: 'Subpath 无效' });
      if (module.templateId) {
        const template = templateById.get(module.templateId);
        if (!template) errors.push({ location: module.id, message: '绑定模板不存在' });
        else if (template.role !== module.role) errors.push({ location: module.id, message: '模块和模板角色不一致' });
      }
      if (project.enabled !== false) addIdentity('module', module.id, module.canonicalRemote, module.subpath ?? null);
    }
  }

  for (const [key, value] of Object.entries(registry.localPaths ?? {})) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) errors.push({ location: `local.paths.${key}`, message: '本机路径必须是绝对路径' });
    if (/(password|token|secret|private[-_]?key)/iu.test(key)) errors.push({ location: `local.paths.${key}`, message: '路径表禁止凭据字段' });
    if (!pathKeys.has(key)) warnings.push({ location: `local.paths.${key}`, message: '路径键未被引用' });
  }
  return { errors, warnings };
}

function matchingProjects(registry, cwd, gitRoot, remote) {
  const matches = [];
  for (const project of (registry.projects.projects ?? []).filter((item) => item.enabled !== false)) {
    const projectPath = registry.localPaths[project.localPathKey];
    if (!projectPath || !pathContains(projectPath, cwd)) continue;
    for (const module of project.modules ?? []) {
      const modulePath = registry.localPaths[module.localPathKey];
      if (!modulePath || !pathContains(modulePath, cwd)) continue;
      if (normalizeRemote(module.canonicalRemote) !== remote) throw new Error(`登记路径的 Git Remote 与模块身份冲突: ${module.id}`);
      if (module.subpath && normalizePath(path.join(gitRoot, module.subpath)) !== normalizePath(modulePath)) throw new Error(`模块 Subpath 与登记路径不一致: ${module.id}`);
      matches.push({ project, projectPath, module, modulePath });
    }
    if (!matches.some((item) => item.project.id === project.id)
      && (project.modules ?? []).some((module) => normalizeRemote(module.canonicalRemote) === remote)) {
      matches.push({ project, projectPath, module: null, modulePath: null });
    }
  }
  return matches;
}

export function resolveContext(options = {}) {
  const registry = options.registry ?? loadRegistry(options.root);
  const validation = validateRegistry(registry);
  if (validation.errors.length) throw new Error(validation.errors.map((x) => `${x.location}: ${x.message}`).join('; '));
  const cwd = realDirectory(options.cwd ?? process.cwd());
  const gitRoot = findGitRoot(cwd);
  const remote = gitRoot ? normalizeRemote(getGitRemote(gitRoot)) : '';

  if (options.projectId) {
    const project = (registry.projects.projects ?? []).find((item) => item.id === options.projectId && item.enabled !== false);
    if (!project) throw new Error(`未找到项目: ${options.projectId}`);
    const projectPath = registry.localPaths[project.localPathKey];
    if (!projectPath || !pathContains(projectPath, cwd)) throw new Error('目标路径与显式项目身份不一致');
  }

  const matches = matchingProjects(registry, cwd, gitRoot, remote);
  if (matches.length > 1) throw new Error(`项目或模块身份多重匹配: ${matches.map((x) => x.module?.id ?? x.project.id).join(', ')}`);
  if (matches.length === 1) {
    const match = matches[0];
    const template = match.module?.templateId
      ? (registry.templates.templates ?? []).find((item) => item.id === match.module.templateId && item.enabled !== false)
      : null;
    const templatePath = template ? registry.localPaths[template.localPathKey] ?? null : null;
    return { kind: match.module ? 'project-module' : 'project', cwd, gitRoot, remote, registry,
      project: match.project, projectPath: match.projectPath, module: match.module, modulePath: match.modulePath,
      template, templatePath };
  }

  for (const template of (registry.templates.templates ?? []).filter((item) => item.enabled !== false)) {
    const templatePath = registry.localPaths[template.localPathKey];
    if (templatePath && normalizePath(templatePath) === normalizePath(gitRoot ?? cwd)) {
      if (normalizeRemote(template.repository?.canonicalRemote) !== remote) throw new Error(`模板身份冲突: ${template.id}`);
      return { kind: 'template', cwd, gitRoot, remote, registry, template, templatePath };
    }
  }
  return { kind: 'transient', cwd, gitRoot, remote, registry };
}

export function publicContext(context) {
  return {
    kind: context.kind, cwd: context.cwd, gitRoot: context.gitRoot, remote: context.remote,
    branch: context.gitRoot ? runGit(context.gitRoot, ['branch', '--show-current']) : null,
    head: context.gitRoot ? runGit(context.gitRoot, ['rev-parse', 'HEAD']) : null,
    project: context.project ? { id: context.project.id, path: context.projectPath } : null,
    module: context.module ? { id: context.module.id, role: context.module.role, path: context.modulePath, subpath: context.module.subpath ?? null } : null,
    template: context.template ? { id: context.template.id, role: context.template.role, path: context.templatePath } : null
  };
}
