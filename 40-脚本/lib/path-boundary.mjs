import fs from 'node:fs';
import path from 'node:path';

export function normalizeRepositoryRelative(value, label = '路径') {
  const raw = String(value ?? '').trim().replaceAll('\\', '/');
  if (!raw) throw new Error(`${label}不能为空`);
  if (raw.startsWith('/') || /^[A-Za-z]:\//u.test(raw) || raw.startsWith('//')) {
    throw new Error(`${label}必须是仓库内相对路径: ${value}`);
  }
  const normalized = path.posix.normalize(raw.replace(/^\.\//u, ''));
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`${label}不能越出仓库: ${value}`);
  }
  if (normalized === '.' || normalized === '') throw new Error(`${label}不能为空`);
  return normalized.replace(/^\/+|\/+$/gu, '');
}

function lexicalContains(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function resolveRepositoryPath(root, relative, options = {}) {
  const repositoryRoot = path.resolve(root);
  const normalized = normalizeRepositoryRelative(relative, options.label ?? '路径');
  const target = path.resolve(repositoryRoot, normalized);
  if (!lexicalContains(repositoryRoot, target)) throw new Error(`${options.label ?? '路径'}越出仓库: ${relative}`);

  if (fs.existsSync(target)) {
    const realRoot = fs.realpathSync(repositoryRoot);
    const realTarget = fs.realpathSync(target);
    if (!lexicalContains(realRoot, realTarget)) throw new Error(`${options.label ?? '路径'}通过符号链接越出仓库: ${relative}`);
  } else if (options.mustExist) {
    throw new Error(`${options.label ?? '路径'}不存在: ${relative}`);
  }
  return { root: repositoryRoot, relative: normalized, target };
}

export function pathWithinAnyRoot(target, roots = []) {
  if (!target || !roots.length) return false;
  const resolvedTarget = fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target);
  return roots.some((root) => {
    if (!root) return false;
    const resolvedRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
    return lexicalContains(resolvedRoot, resolvedTarget);
  });
}
