import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM_ROOT } from './registry.mjs';

const ROLE_PROFILE = {
  web: 'develop-web',
  app: 'develop-app',
  server: 'develop-server',
  docs: 'write-documentation',
  ops: 'operate-environments',
};
const INTENT_PROFILES = [
  ['clarify-requirements', /需求|范围|验收|requirement/iu],
  ['design-product', /产品|规划|product/iu],
  ['design-ui', /界面|交互|视觉|\bui\b|\bux\b/iu],
  ['integrate-systems', /联调|跨仓|第三方|集成|integration/iu],
  ['operate-environments', /环境|发布|部署|容器|网关|deploy|runtime/iu],
  ['write-documentation', /文档|README|架构说明|documentation/iu],
  ['curate-knowledge', /经验|知识|复盘|knowledge/iu],
];
const IMPLEMENTATION_QUALITY_KINDS = new Set(['code', 'api', 'data', 'integration', 'ui']);

export function implementationQualityBaseline(artifactKinds = []) {
  const kinds = Array.isArray(artifactKinds) ? artifactKinds : [];
  if (!kinds.some((kind) => IMPLEMENTATION_QUALITY_KINDS.has(kind))) return null;
  return {
    schemaVersion: 1,
    id: 'implementation-quality-baseline',
    rules: [
      { id: 'goal-fit', text: '实现必须直接服务 Goal / Acceptance，不解决无关邻近问题' },
      { id: 'simplicity', text: '同等正确方案优先最低必要复杂度；稳定功能查漏补缺优先修改、替换或删除现有权威实现，避免重复逻辑、平行业务规则和无职责抽象' },
      { id: 'structure-naming', text: '职责、数据流和命名必须清晰，并遵循项目已有术语与结构' },
      { id: 'architecture-fit', text: '优先复用现有模块边界和依赖方向，不按模型偏好重塑项目' },
      { id: 'scope-behavior', text: 'ChangeSet 保持最小充分并保护未请求改变的已有行为；核心运行代码明显净增或旧路径继续保留时，先判断是否缺少基础模型并重新规划' },
      { id: 'boundary', text: '只处理与当前目标相关的必要失败、权限、并发、兼容等边界' },
    ],
    conditionalRules: [
      { id: 'performance', when: 'hot-path-or-io-changed', text: '热路径、查询、I/O、网络或批处理发生变化时检查明显性能退化' },
    ],
  };
}

function existing(file) {
  return file && fs.existsSync(file) && fs.statSync(file).isFile() ? path.resolve(file) : null;
}

function existingPath(file) {
  return file && fs.existsSync(file) ? path.resolve(file) : null;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function selectProfiles(role, intent, explicit = []) {
  if (explicit.length) return unique(explicit).slice(0, 2);
  const result = [];
  if (ROLE_PROFILE[role]) result.push(ROLE_PROFILE[role]);
  for (const [name, pattern] of INTENT_PROFILES) if (pattern.test(intent)) result.push(name);
  return unique(result).slice(0, 2);
}

function qualityManifest(root, source) {
  if (!root) return null;
  const file = path.join(root, '.ai', 'quality.json');
  const value = readJson(file);
  if (!value) return null;
  return {
    source,
    root: path.resolve(root),
    file: path.resolve(file),
    contracts: Array.isArray(value.contracts) ? value.contracts : [],
    exemplars: Array.isArray(value.exemplars) ? value.exemplars : [],
    disabledDefaults: new Set(value.disabledDefaults ?? []),
    exceptions: value.exceptions ?? [],
  };
}

function configuredProfiles(item) {
  if (Array.isArray(item.profiles)) return item.profiles;
  return Array.isArray(item.skills) ? item.skills : [];
}

function matches(item, input) {
  if (item.status && item.status !== 'active') return false;
  const profiles = configuredProfiles(item);
  if (profiles.length && !profiles.some((profile) => input.profiles.includes(profile))) return false;
  if (item.roles?.length && !item.roles.includes(input.role)) return false;
  if (item.artifactKinds?.length && !item.artifactKinds.some((kind) => input.artifactKinds.includes(kind))) return false;
  return true;
}

function resolvePaths(manifest, values = []) {
  return values.map((relative) => existingPath(path.resolve(manifest.root, relative))).filter(Boolean);
}

function contractFromManifest(manifest, input) {
  for (const item of manifest?.contracts ?? []) {
    if (!matches(item, input)) continue;
    const file = existing(path.resolve(manifest.root, item.path ?? ''));
    if (file) return { id: item.id, version: item.version ?? 1, path: file, source: manifest.source, manifest: manifest.file };
  }
  return null;
}

function exemplarCandidates(manifest, input) {
  const normalized = input.intent.toLowerCase();
  return (manifest?.exemplars ?? [])
    .filter((item) => matches(item, input) && !item.supersededBy && (item.structureImpacts ?? ['structural']).includes('structural'))
    .map((item) => ({ item, score: (item.keywords ?? []).filter((keyword) => normalized.includes(String(keyword).toLowerCase())).length }))
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item);
}

function exemplarFromManifest(manifest, input) {
  const item = exemplarCandidates(manifest, input)[0];
  if (!item) return null;
  const files = resolvePaths(manifest, item.read ?? []);
  return files.length ? { ...item, files, source: manifest.source, manifest: manifest.file } : null;
}

function centralContract(profile) {
  const file = existing(path.join(SYSTEM_ROOT, '20-能力模块', profile, 'CONTRACT.md'));
  if (!file) return null;
  const text = fs.readFileSync(file, 'utf8');
  const id = text.match(/^id:\s*([^\r\n]+)/mu)?.[1]?.trim() ?? profile;
  const version = Number(text.match(/^version:\s*(\d+)/mu)?.[1] ?? 2);
  return { id, version, path: file, source: 'central' };
}

function universalContract() {
  const file = existing(path.join(SYSTEM_ROOT, '20-能力模块', '10-通用工程契约.md'));
  if (!file) return null;
  const text = fs.readFileSync(file, 'utf8');
  const id = text.match(/^id:\s*([^\r\n]+)/mu)?.[1]?.trim() ?? 'universal-engineering';
  const version = Number(text.match(/^version:\s*(\d+)/mu)?.[1] ?? 2);
  return { id, version, path: file, source: 'central' };
}

function centralExemplar(profile, intent) {
  const root = path.join(SYSTEM_ROOT, '20-能力模块', profile);
  const manifest = readJson(path.join(SYSTEM_ROOT, '20-能力模块', 'manifest.json'));
  const configured = manifest?.profiles ?? manifest?.abilities ?? [];
  const entry = configured.find((item) => item.name === profile);
  const normalized = intent.toLowerCase();
  const item = (entry?.exemplars ?? [])
    .filter((candidate) => candidate.status === 'active' && !candidate.supersededBy && (candidate.structureImpacts ?? ['structural']).includes('structural'))
    .map((candidate) => ({ candidate, score: (candidate.keywords ?? []).filter((keyword) => normalized.includes(String(keyword).toLowerCase())).length }))
    .sort((left, right) => right.score - left.score)[0]?.candidate;
  if (!item) return null;
  const files = (item.read ?? []).map((file) => existing(path.join(root, file))).filter(Boolean);
  return files.length ? { ...item, files, source: 'central' } : null;
}

function selectExperience(intent, projectRoot) {
  const normalized = intent.toLowerCase();
  const sources = [];
  if (projectRoot) {
    const index = readJson(path.join(projectRoot, '.ai', '30-经验', '索引.json'));
    if (index) sources.push({ root: path.join(projectRoot, '.ai', '30-经验'), index, source: 'project' });
  }
  const centralRoot = path.join(SYSTEM_ROOT, '30-知识库');
  sources.push({ root: centralRoot, index: readJson(path.join(centralRoot, '索引.json'), { routes: [] }), source: 'central' });
  for (const source of sources) {
    const route = (source.index.routes ?? [])
      .filter((item) => item.lifecycle === 'active')
      .map((item) => ({ item, score: (item.keywords ?? []).filter((keyword) => normalized.includes(String(keyword).toLowerCase())).length }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)[0]?.item;
    if (route) {
      const file = existing(path.join(source.root, route.read?.[0] ?? ''));
      if (file) return [{ path: file, source: source.source }];
    }
  }
  return [];
}

export function loadQualityContext(input = {}) {
  const explicitProfiles = unique(input.explicitProfiles ?? input.explicitSkills ?? []);
  const profiles = selectProfiles(input.role, input.intent ?? '', explicitProfiles);
  const baseline = implementationQualityBaseline(input.artifactKinds ?? []);
  const experiences = selectExperience(input.intent ?? '', input.projectRoot);
  const shouldLoadContract = input.structureImpact === 'structural' || explicitProfiles.length > 0;
  const baseResult = {
    baseline,
    profiles,
    selectionSource: explicitProfiles.length ? 'explicit' : 'automatic',
    contracts: [],
    exemplars: [],
    experiences,
    files: [],
  };
  if (!shouldLoadContract) return baseResult;

  const matchInput = {
    profiles,
    role: input.role,
    artifactKinds: input.artifactKinds ?? ['code'],
    intent: input.intent ?? '',
  };
  const project = qualityManifest(input.projectRoot, 'project');
  const template = qualityManifest(input.templateRoot, 'template');
  let contract = contractFromManifest(project, matchInput) ?? contractFromManifest(template, matchInput);
  if (!contract) {
    for (const profile of profiles) {
      if (project?.disabledDefaults.has(profile) || template?.disabledDefaults.has(profile)) continue;
      contract = centralContract(profile);
      if (contract) break;
    }
  }
  contract ??= universalContract();

  let exemplar = null;
  if (input.structureImpact === 'structural') {
    exemplar = exemplarFromManifest(project, matchInput) ?? exemplarFromManifest(template, matchInput);
    if (!exemplar) {
      for (const profile of profiles) {
        if (project?.disabledDefaults.has(profile) || template?.disabledDefaults.has(profile)) continue;
        exemplar = centralExemplar(profile, input.intent ?? '');
        if (exemplar) break;
      }
    }
  }

  const files = [
    contract?.path,
    ...(exemplar?.files ?? []),
    ...(input.structureImpact === 'structural' ? experiences.map((item) => item.path) : []),
  ].filter(Boolean);
  return {
    ...baseResult,
    contracts: contract ? [contract] : [],
    exemplars: exemplar ? [exemplar] : [],
    files: unique(files),
    authority: { project: project?.file ?? null, template: template?.file ?? null },
  };
}
