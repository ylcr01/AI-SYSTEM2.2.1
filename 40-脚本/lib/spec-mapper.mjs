import fs from 'node:fs';
import path from 'node:path';
import { normalizeRepositoryRelative, resolveRepositoryPath } from './path-boundary.mjs';

const SPEC_ID_PATTERN = /\b(?:BR|TR|SC|EX)-[A-Z0-9][A-Z0-9-]*-\d{3,}\b/gu;
const DEFAULT_CONFIG = '.ai/spec-map.json';
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.java', '.kt', '.kts', '.go', '.rs',
  '.py', '.rb', '.php', '.cs', '.cpp', '.cc', '.c', '.h', '.hpp', '.vue', '.svelte',
  '.sql', '.graphql', '.gql', '.sh', '.ps1'
]);
const TEST_MARKERS = [/^tests?\//u, /^__tests__\//u, /\.(?:test|spec)\.[^.]+$/u];
const DECISION_MARKERS = [/(?:^|\/)decisions?\//iu, /(?:^|\/)adr\//iu, /\bDEC-[A-Z0-9-]+/u];
const WALK_IGNORES = new Set(['.git', 'node_modules', 'coverage']);

function normalizeRelative(value, label = '规格映射路径') {
  return normalizeRepositoryRelative(value, label);
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
}

export function globToRegExp(pattern) {
  const normalized = normalizeRelative(pattern);
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        index += 1;
        if (normalized[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else source += '.*';
      } else source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`, 'u');
}

function matchesPattern(file, pattern) {
  const normalizedFile = normalizeRelative(file, '仓库文件路径');
  const normalizedPattern = normalizeRelative(pattern);
  if (!/[?*]/u.test(normalizedPattern)) {
    return normalizedFile === normalizedPattern || normalizedFile.startsWith(`${normalizedPattern}/`);
  }
  return globToRegExp(normalizedPattern).test(normalizedFile);
}

export function extractSpecificationIds(text) {
  return [...new Set(String(text ?? '').match(SPEC_ID_PATTERN) ?? [])].sort();
}

function readTextIfFile(file) {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return '';
    if (fs.statSync(file).size > 2 * 1024 * 1024) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizedList(values, label) {
  return (values ?? []).map((value) => normalizeRelative(value, label)).filter(Boolean);
}

function normalizeRule(rule, index) {
  if (!rule || typeof rule !== 'object') throw new Error(`spec-map mappings[${index}] 必须是对象`);
  const id = String(rule.id ?? `mapping-${index + 1}`).trim();
  const paths = normalizedList(rule.paths, `${id}.paths`);
  if (!paths.length) throw new Error(`spec-map ${id} 缺少 paths`);
  return {
    id,
    paths,
    keywords: (rule.keywords ?? []).map(String).map((item) => item.trim()).filter(Boolean),
    specificationFiles: normalizedList(rule.specificationFiles, `${id}.specificationFiles`),
    specificationIds: (rule.specificationIds ?? []).map(String).map((item) => item.trim()).filter(Boolean),
    testFiles: normalizedList(rule.testFiles, `${id}.testFiles`),
    decisionFiles: normalizedList(rule.decisionFiles, `${id}.decisionFiles`)
  };
}

export function loadSpecMap(gitRoot, options = {}) {
  const root = path.resolve(gitRoot);
  const configRelative = normalizeRelative(options.configPath ?? DEFAULT_CONFIG, 'spec-map 配置路径');
  const configPath = resolveRepositoryPath(root, configRelative, { label: 'spec-map 配置路径' }).target;
  if (!fs.existsSync(configPath)) return { schemaVersion: 1, configured: false, configPath, mappings: [] };
  const raw = readJson(configPath);
  if (raw.schemaVersion !== 1) throw new Error(`不支持的 spec-map schemaVersion: ${raw.schemaVersion}`);
  if (!Array.isArray(raw.mappings)) throw new Error('spec-map mappings 必须是数组');
  return { schemaVersion: 1, configured: true, configPath, mappings: raw.mappings.map(normalizeRule) };
}

function staticBase(pattern) {
  const wildcard = pattern.search(/[?*]/u);
  if (wildcard < 0) return pattern;
  const prefix = pattern.slice(0, wildcard);
  return prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
}

function walkFiles(root, relativeBase, limit = 10000) {
  const base = relativeBase
    ? resolveRepositoryPath(root, relativeBase, { label: '规格映射扫描根' }).target
    : path.resolve(root);
  if (!fs.existsSync(base)) return [];
  if (fs.statSync(base).isFile()) return [normalizeRelative(path.relative(root, base))];
  const files = [];
  const stack = [base];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (WALK_IGNORES.has(entry.name)) continue;
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) {
        files.push(normalizeRelative(path.relative(root, target)));
        if (files.length > limit) throw new Error(`规格映射扫描文件超过上限 ${limit}`);
      }
    }
  }
  return files.sort();
}

export function expandRepositoryPatterns(gitRoot, patterns = []) {
  const root = path.resolve(gitRoot);
  const results = new Set();
  for (const raw of patterns) {
    const pattern = normalizeRelative(raw);
    if (!/[?*]/u.test(pattern)) {
      const resolved = resolveRepositoryPath(root, pattern, { label: '规格映射目标' }).target;
      if (!fs.existsSync(resolved)) continue;
      if (fs.statSync(resolved).isFile()) results.add(pattern);
      else for (const file of walkFiles(root, pattern)) results.add(file);
      continue;
    }
    const regex = globToRegExp(pattern);
    for (const file of walkFiles(root, staticBase(pattern))) {
      if (regex.test(file)) results.add(file);
    }
  }
  return [...results].sort();
}

function expandIdPatterns(patterns, availableIds) {
  const ids = new Set();
  for (const pattern of patterns) {
    if (!/[?*]/u.test(pattern)) ids.add(pattern);
    else {
      const regex = globToRegExp(pattern);
      for (const id of availableIds) if (regex.test(id)) ids.add(id);
    }
  }
  return [...ids].sort();
}

function parseFrontMatter(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/u, '').split(/\r?\n/u);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return null;
  const metadata = {};
  let currentList = null;
  for (const line of lines.slice(1, end)) {
    const listItem = line.match(/^\s*-\s+(.+)$/u);
    if (listItem && currentList) {
      metadata[currentList].push(listItem[1].trim().replace(/^['"]|['"]$/gu, ''));
      continue;
    }
    const pair = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u);
    if (!pair) continue;
    const [, key, rawValue] = pair;
    const value = rawValue.trim();
    if (!value) {
      metadata[key] = [];
      currentList = key;
    } else {
      currentList = null;
      if (value.startsWith('[') && value.endsWith(']')) {
        metadata[key] = value.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/gu, '')).filter(Boolean);
      } else metadata[key] = value.replace(/^['"]|['"]$/gu, '');
    }
  }
  return metadata;
}

export function readDecisionMetadata(gitRoot, relative) {
  const normalized = normalizeRelative(relative, 'Decision 路径');
  const file = resolveRepositoryPath(gitRoot, normalized, { label: 'Decision 路径' }).target;
  const frontMatter = parseFrontMatter(readTextIfFile(file));
  if (!frontMatter) return { file: normalized, present: false, metadata: null };
  return {
    file: normalized,
    present: true,
    metadata: {
      id: typeof frontMatter.id === 'string' ? frontMatter.id : null,
      status: typeof frontMatter.status === 'string' ? frontMatter.status : null,
      affects: Array.isArray(frontMatter.affects) ? frontMatter.affects : typeof frontMatter.affects === 'string' ? [frontMatter.affects] : [],
      sourceTaskId: typeof frontMatter.sourceTaskId === 'string' ? frontMatter.sourceTaskId : null,
      supersedes: Array.isArray(frontMatter.supersedes) ? frontMatter.supersedes : [],
      supersededBy: typeof frontMatter.supersededBy === 'string' ? frontMatter.supersededBy : null
    }
  };
}

function ruleAnalysis(gitRoot, rule) {
  const specificationFiles = expandRepositoryPatterns(gitRoot, rule.specificationFiles);
  const testFiles = expandRepositoryPatterns(gitRoot, rule.testFiles);
  const decisionFiles = expandRepositoryPatterns(gitRoot, rule.decisionFiles);
  const idsFromFiles = new Set();
  for (const relative of specificationFiles) {
    const file = resolveRepositoryPath(gitRoot, relative, { label: '模块规格路径' }).target;
    for (const id of extractSpecificationIds(readTextIfFile(file))) idsFromFiles.add(id);
  }
  const configured = rule.specificationIds.length
    ? expandIdPatterns(rule.specificationIds, [...idsFromFiles])
    : [...idsFromFiles].sort();
  return {
    specificationFiles,
    testFiles,
    decisionFiles,
    specificationIds: [...new Set([...configured, ...idsFromFiles])].sort()
  };
}

function fileKind(file, matchedRules) {
  const normalized = normalizeRelative(file, 'Changed File');
  if (matchedRules.some(({ rule }) => rule.specificationFiles.some((pattern) => matchesPattern(normalized, pattern)))) return 'specification';
  if (matchedRules.some(({ rule }) => rule.decisionFiles.some((pattern) => matchesPattern(normalized, pattern))) || DECISION_MARKERS.some((pattern) => pattern.test(normalized))) return 'decision';
  if (matchedRules.some(({ rule }) => rule.testFiles.some((pattern) => matchesPattern(normalized, pattern))) || TEST_MARKERS.some((pattern) => pattern.test(normalized))) return 'test';
  if (CODE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) return 'code';
  if (/\.(?:md|mdx|rst|adoc|txt)$/iu.test(normalized)) return 'documentation';
  if (/\.(?:json|ya?ml|toml|ini|env)$/iu.test(normalized)) return 'configuration';
  return 'other';
}

function testCoverageForIds(gitRoot, analyses, ids) {
  const coverage = Object.fromEntries(ids.map((id) => [id, []]));
  const files = [...new Set(analyses.flatMap((item) => item.testFiles))];
  for (const relative of files) {
    const file = resolveRepositoryPath(gitRoot, relative, { label: '测试追踪路径' }).target;
    const referenced = new Set(extractSpecificationIds(readTextIfFile(file)));
    for (const id of ids) if (referenced.has(id)) coverage[id].push(relative);
  }
  for (const id of Object.keys(coverage)) coverage[id] = [...new Set(coverage[id])].sort();
  return coverage;
}

export function mapChangedFilesToSpecifications(input = {}) {
  const gitRoot = path.resolve(input.gitRoot ?? input.cwd ?? process.cwd());
  const config = input.specMap ?? loadSpecMap(gitRoot, input);
  const changedFiles = (input.changedFiles ?? []).map((item) => typeof item === 'string' ? { path: item, status: null } : item);
  const normalizedFiles = changedFiles.map((item) => ({
    ...item,
    path: normalizeRelative(item.path, 'Changed File')
  })).filter((item) => item.path);
  const analyses = new Map(config.mappings.map((rule) => [rule.id, ruleAnalysis(gitRoot, rule)]));

  const files = normalizedFiles.map((item) => {
    const matchedRules = config.mappings
      .filter((rule) => [...rule.paths, ...rule.specificationFiles, ...rule.testFiles, ...rule.decisionFiles]
        .some((pattern) => matchesPattern(item.path, pattern)))
      .map((rule) => ({ rule, analysis: analyses.get(rule.id) }));
    const resolved = resolveRepositoryPath(gitRoot, item.path, { label: 'Changed File' }).target;
    const inlineSpecificationIds = extractSpecificationIds(readTextIfFile(resolved));
    const specificationIds = [...new Set([
      ...inlineSpecificationIds,
      ...matchedRules.flatMap(({ analysis }) => analysis.specificationIds)
    ])].sort();
    const kind = fileKind(item.path, matchedRules);
    return {
      path: item.path,
      status: item.status ?? null,
      kind,
      matchedRuleIds: matchedRules.map(({ rule }) => rule.id),
      specificationFiles: [...new Set(matchedRules.flatMap(({ analysis }) => analysis.specificationFiles))].sort(),
      specificationIds,
      testFiles: [...new Set(matchedRules.flatMap(({ analysis }) => analysis.testFiles))].sort(),
      decisionFiles: [...new Set(matchedRules.flatMap(({ analysis }) => analysis.decisionFiles))].sort(),
      decisionMetadata: kind === 'decision' && fs.existsSync(resolved) ? readDecisionMetadata(gitRoot, item.path) : null,
      inlineSpecificationIds,
      confidence: inlineSpecificationIds.length ? 'explicit-inline' : matchedRules.length ? 'configured' : 'unmapped'
    };
  });

  const affectedSpecificationIds = [...new Set(files.flatMap((item) => item.specificationIds))].sort();
  const matchedRuleIds = [...new Set(files.flatMap((item) => item.matchedRuleIds))];
  const matchedAnalyses = matchedRuleIds.map((id) => analyses.get(id)).filter(Boolean);
  const coverage = testCoverageForIds(gitRoot, matchedAnalyses, affectedSpecificationIds);
  const unmappedCodeFiles = files
    .filter((item) => item.kind === 'code' && item.matchedRuleIds.length === 0 && item.inlineSpecificationIds.length === 0)
    .map((item) => item.path);

  return {
    schemaVersion: 2,
    gitRoot,
    configured: config.configured,
    configPath: config.configPath,
    files,
    affectedSpecificationIds,
    specificationFiles: [...new Set(matchedAnalyses.flatMap((item) => item.specificationFiles))].sort(),
    testFiles: [...new Set(matchedAnalyses.flatMap((item) => item.testFiles))].sort(),
    decisionFiles: [...new Set(matchedAnalyses.flatMap((item) => item.decisionFiles))].sort(),
    testCoverage: coverage,
    unmappedCodeFiles,
    warnings: unmappedCodeFiles.length ? [`${unmappedCodeFiles.length} 个代码文件没有规格映射`] : []
  };
}

export function mapIntentToSpecifications(input = {}) {
  const gitRoot = path.resolve(input.gitRoot ?? input.cwd ?? process.cwd());
  const config = input.specMap ?? loadSpecMap(gitRoot, input);
  const text = String(input.intent ?? '').toLowerCase();
  const rules = config.mappings.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())));
  const analyses = rules.map((rule) => ({ rule, analysis: ruleAnalysis(gitRoot, rule) }));
  return {
    configured: config.configured,
    matchedRuleIds: rules.map((rule) => rule.id),
    specificationFiles: [...new Set(analyses.flatMap(({ analysis }) => analysis.specificationFiles))].sort(),
    specificationIds: [...new Set(analyses.flatMap(({ analysis }) => analysis.specificationIds))].sort(),
    testFiles: [...new Set(analyses.flatMap(({ analysis }) => analysis.testFiles))].sort()
  };
}
