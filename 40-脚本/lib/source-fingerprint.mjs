import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'coverage',
  '.playwright-mcp'
]);

function normalizedRelative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function ignored(relative) {
  return relative === '80-运行记录'
    || relative.startsWith('80-运行记录/')
    || relative === '70-文档/验证记录'
    || relative.startsWith('70-文档/验证记录/')
    || relative.split('/').some((part) => IGNORED_DIRECTORIES.has(part));
}

function gitFiles(root) {
  const result = spawnSync('git', [
    '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.split('\0').filter(Boolean)
    .map((relative) => relative.replaceAll('\\', '/'))
    .filter((relative) => !ignored(relative))
    .filter((relative) => fs.existsSync(path.join(root, relative)));
}

function walkedFiles(root) {
  const files = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = normalizedRelative(root, file);
      if (ignored(relative)) continue;
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else files.push(relative);
    }
  }
  walk(root);
  return files;
}

function fileDigest(file) {
  const stat = fs.lstatSync(file);
  const payload = stat.isSymbolicLink()
    ? Buffer.from(`link:${fs.readlinkSync(file)}`)
    : fs.readFileSync(file);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function sourceEntries(root) {
  const resolvedRoot = path.resolve(root);
  const files = gitFiles(resolvedRoot) ?? walkedFiles(resolvedRoot);
  return [...new Set(files)].sort().map((relative) => [
    relative,
    fileDigest(path.join(resolvedRoot, relative))
  ]);
}

export function sourceFingerprint(root) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(sourceEntries(root)))
    .digest('hex');
}
