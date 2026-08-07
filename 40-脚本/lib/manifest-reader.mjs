import fs from 'node:fs';
import path from 'node:path';

const CANDIDATES = ['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'Cargo.toml', 'go.mod', 'pyproject.toml'];

function existingFile(root, relative) {
  if (!root || !relative) return null;
  const file = path.resolve(root, relative);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

function parsePackage(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  const deps = { ...(value.dependencies ?? {}), ...(value.devDependencies ?? {}) };
  const frameworks = [];
  for (const name of ['vue','react','next','nuxt','svelte','@angular/core','vite','webpack','typescript','electron','uni-app']) if (deps[name]) frameworks.push(name);
  return {
    kind: 'node', path: file, name: value.name ?? null, packageManager: value.packageManager ?? null,
    workspaces: value.workspaces ?? null, scripts: Object.keys(value.scripts ?? {}), frameworks,
    checksHints: Object.keys(value.scripts ?? {}).filter((name) => ['typecheck','lint','test','build','check'].includes(name))
  };
}

function parseText(file, kind) {
  const text = fs.readFileSync(file, 'utf8');
  const hints = [];
  if (kind === 'maven') hints.push('test', 'package');
  if (kind === 'gradle') hints.push('test', 'build');
  if (kind === 'rust') hints.push('test', 'build');
  if (kind === 'go') hints.push('test', 'build');
  if (kind === 'python') hints.push('test');
  return { kind, path: file, name: path.basename(path.dirname(file)), scripts: [], frameworks: [], checksHints: hints, fingerprintSourceBytes: Buffer.byteLength(text) };
}

function parseManifest(file) {
  const base = path.basename(file);
  if (base === 'package.json') return parsePackage(file);
  if (base === 'pom.xml') return parseText(file, 'maven');
  if (base.startsWith('build.gradle') || base === 'settings.gradle') return parseText(file, 'gradle');
  if (base === 'Cargo.toml') return parseText(file, 'rust');
  if (base === 'go.mod') return parseText(file, 'go');
  if (base === 'pyproject.toml') return parseText(file, 'python');
  return parseText(file, 'unknown');
}

export function readProjectManifests(context) {
  const roots = [...new Set([context.modulePath, context.projectPath, context.templatePath, context.gitRoot].filter(Boolean).map((item) => path.resolve(item)))];
  const explicit = [];
  if (context.templatePath && context.template?.entrypoints?.manifest) explicit.push(existingFile(context.templatePath, context.template.entrypoints.manifest));
  const files = [];
  for (const file of explicit.filter(Boolean)) if (!files.includes(file)) files.push(file);
  for (const root of roots) {
    for (const candidate of CANDIDATES) {
      const file = existingFile(root, candidate);
      if (file && !files.includes(file)) files.push(file);
    }
  }
  return files.slice(0, 4).map(parseManifest);
}
