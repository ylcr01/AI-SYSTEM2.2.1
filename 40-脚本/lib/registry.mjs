import fs from 'node:fs';
import path from 'node:path';
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

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`JSON 解析失败 ${file}: ${error.message}`);
  }
}

export function loadRegistry(root = SYSTEM_ROOT) {
  const directory = path.join(root, '10-注册表');
  return {
    root,
    templates: readJson(path.join(directory, 'templates.json'), { schemaVersion: 1, templates: [] }),
    projects: readJson(path.join(directory, 'projects.json'), { schemaVersion: 1, projects: [] }),
    localPaths: readJson(path.join(directory, 'local.paths.json'), {})
  };
}

function validRelative(value) {
  return typeof value === 'string' && value.length > 0
    && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)
    && !value.includes('\\') && !value.split('/').some((part) => ['.', '..'].includes(part))
    && path.posix.normalize(value) === value;
}

export function validateRegistry(registry) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const pathKeys = new Set();
  const remoteOwners = new Map();
  const templates = registry.templates?.templates;
  const projects = registry.projects?.projects;

  if (registry.templates?.schemaVersion !== 1 || !Array.isArray(templates)) {
    errors.push({ location: 'templates', message: '模板注册表无效' });
  }
  if (registry.projects?.schemaVersion !== 1 || !Array.isArray(projects)) {
    errors.push({ location: 'projects', message: '项目注册表无效' });
  }

  function addId(id, location) {
    if (!ID_PATTERN.test(id ?? '') || ids.has(id)) {
      errors.push({ location, message: 'ID 无效或重复' });
      return false;
    }
    ids.add(id);
    return true;
  }

  function addPathKey(key, location) {
    if (!key || pathKeys.has(key)) {
      errors.push({ location, message: '路径键无效或重复' });
      return;
    }
    pathKeys.add(key);
  }

  function addIdentity(kind, id, remote, subpath = null) {
    const key = normalizeRemote(remote);
    if (!key || !key.includes('/')) {
      errors.push({ location: `${kind}.${id}`, message: 'Remote 无效' });
      return;
    }
    const list = remoteOwners.get(key) ?? [];
    const overlap = (left, right) => !left || !right || left === right
      || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
    if (list.some((item) => item.kind === 'template' || kind === 'template' || overlap(item.subpath, subpath))) {
      errors.push({ location: `${kind}.${id}`, message: `Remote 身份冲突: ${key}` });
    }
    list.push({ kind, id, subpath });
    remoteOwners.set(key, list);
  }

  const templateById = new Map();
  for (const template of templates ?? []) {
    if (!template || !addId(template.id, 'templates')) continue;
    templateById.set(template.id, template);
    const isLocalTemplate = template.repository === null;
    if (!VALID_ROLES.has(template.role)) errors.push({ location: template.id, message: '模板角色无效' });
    addPathKey(template.localPathKey, template.id);
    if (!isLocalTemplate && template.repository?.allowedRemotes !== undefined
      && !Array.isArray(template.repository.allowedRemotes)) {
      errors.push({ location: template.id, message: '模板 Allowed Remotes 必须是数组' });
    }
    if (!validRelative(template.entrypoints?.agents) || !validRelative(template.entrypoints?.manifest)) {
      errors.push({ location: template.id, message: '模板入口必须是仓库内相对路径' });
    }
    if (template.quality?.manifest && !validRelative(template.quality.manifest)) {
      errors.push({ location: template.id, message: '质量清单路径无效' });
    }
    if (template.knowledge?.mode && !['in-repo', 'none'].includes(template.knowledge.mode)) {
      errors.push({ location: template.id, message: '模板知识模式无效' });
    }
    if (template.knowledge?.root && !validRelative(template.knowledge.root)) {
      errors.push({ location: template.id, message: '模板知识根目录无效' });
    }
    if (template.knowledge?.manifest && !validRelative(template.knowledge.manifest)) {
      errors.push({ location: template.id, message: '模板知识清单路径无效' });
    }
    if (template.knowledge?.root && template.knowledge?.manifest
      && template.knowledge.manifest !== template.knowledge.root
      && !template.knowledge.manifest.startsWith(`${template.knowledge.root}/`)) {
      errors.push({ location: template.id, message: '模板知识清单必须位于知识根目录内' });
    }
    if (template.enabled !== false && !isLocalTemplate) {
      addIdentity('template', template.id, template.repository?.canonicalRemote);
    }
  }

  for (const project of projects ?? []) {
    if (!project || !addId(project.id, 'projects')) continue;
    addPathKey(project.localPathKey, project.id);
    if (!validRelative(project.entrypoints?.agents)) {
      errors.push({ location: project.id, message: '项目入口路径无效' });
    }
    if (project.entrypoints?.docs && !validRelative(project.entrypoints.docs)) {
      errors.push({ location: project.id, message: '项目说明路径无效' });
    }
    if (!Array.isArray(project.modules)) {
      errors.push({ location: project.id, message: 'modules 必须是数组' });
      continue;
    }
    for (const module of project.modules) {
      addId(module.id, project.id);
      addPathKey(module.localPathKey, module.id);
      if (!VALID_ROLES.has(module.role)) errors.push({ location: module.id, message: '模块角色无效' });
      if (module.subpath && !validRelative(module.subpath)) {
        errors.push({ location: module.id, message: 'Subpath 无效' });
      }
      if (module.templateId) {
        const template = templateById.get(module.templateId);
        if (!template) errors.push({ location: module.id, message: '绑定模板不存在' });
        else if (template.role !== module.role) {
          errors.push({ location: module.id, message: '模块和模板角色不一致' });
        }
      }
      if (project.enabled !== false) {
        addIdentity('module', module.id, module.canonicalRemote, module.subpath ?? null);
      }
    }
  }

  for (const [key, value] of Object.entries(registry.localPaths ?? {})) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
      errors.push({ location: `local.paths.${key}`, message: '本机路径必须是绝对路径' });
    }
    if (/(password|token|secret|private[-_]?key)/iu.test(key)) {
      errors.push({ location: `local.paths.${key}`, message: '路径表禁止凭据字段' });
    }
    if (!pathKeys.has(key)) warnings.push({ location: `local.paths.${key}`, message: '路径键未被引用' });
  }
  return { errors, warnings };
}
