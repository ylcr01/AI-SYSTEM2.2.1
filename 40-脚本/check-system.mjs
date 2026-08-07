import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM_ROOT, loadRegistry, validateRegistry } from './lib/registry.mjs';

const errors = [];
const warnings = [];

function requireFile(relative) {
  const file = path.join(SYSTEM_ROOT, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) errors.push(`${relative}: 缺少`);
  return file;
}

function readJson(relative) {
  try { return JSON.parse(fs.readFileSync(requireFile(relative), 'utf8')); }
  catch (error) { errors.push(`${relative}: JSON 无效 ${error.message}`); return null; }
}

const pkg = readJson('package.json');
if (pkg?.version !== '2.2.1') errors.push('package.json: 版本必须为 2.2.1');

for (const relative of [
  'README.md', 'AGENTS.md', '.ai/checks.json',
  '.ai/templates/module-spec-template.md', '.ai/templates/decision-template.md', '.ai/templates/spec-map.example.json', '.ai/templates/spec-policy.example.json',
  '00-大模型接入/通用自定义指令.md', '00-大模型接入/Codex-接入说明.md', '00-大模型接入/使用边界.md',
  '10-注册表/projects.json', '10-注册表/templates.json',
  '20-能力模块/00-质量宪法.md', '20-能力模块/10-通用工程契约.md', '20-能力模块/manifest.json',
  '30-知识库/索引.json',
  '40-脚本/configure-model-entry.mjs', '40-脚本/task.mjs', '40-脚本/spec-map.mjs', '40-脚本/spec-consistency.mjs',
  '40-脚本/lib/state-manager.mjs', '40-脚本/lib/evidence.mjs', '40-脚本/lib/task-runner.mjs',
  '40-脚本/lib/spec-mapper.mjs', '40-脚本/lib/spec-consistency.mjs', '40-脚本/lib/spec-service.mjs', '40-脚本/lib/path-boundary.mjs',
  '40-脚本/lib/experience-candidate.mjs', '40-脚本/lib/experience-quality.mjs', '40-脚本/lib/experience-dedupe.mjs',
  '40-脚本/lib/manifest-reader.mjs', '50-检查规则/10-通用检查.md', '80-运行记录/README.md'
]) requireFile(relative);

try {
  const result = validateRegistry(loadRegistry());
  errors.push(...result.errors.map((item) => `${item.location}: ${item.message}`));
  warnings.push(...result.warnings.map((item) => `${item.location}: ${item.message}`));
} catch (error) {
  errors.push(`注册表: ${error.message}`);
}

const abilityManifest = readJson('20-能力模块/manifest.json');
const artifactKinds = new Set(['code','product','requirements','ui','api','data','integration','operations','documentation','knowledge']);
for (const ability of abilityManifest?.abilities ?? []) {
  for (const key of ['skill','contract','verification']) requireFile(ability[key]);
  for (const kind of ability.artifactKinds ?? []) if (!artifactKinds.has(kind)) errors.push(`${ability.name}: artifactKind 无效 ${kind}`);
  if (ability.exemplarIndex) {
    const index = readJson(ability.exemplarIndex);
    if (index?.schemaVersion !== 4 || !Array.isArray(index.exemplars)) errors.push(`${ability.exemplarIndex}: Schema 无效`);
    for (const item of index?.exemplars ?? []) {
      if (!['active','observe','retired','deprecated','disabled'].includes(item.status)) errors.push(`${item.id}: lifecycle 无效`);
      if (item.status === 'active' && item.supersededBy) errors.push(`${item.id}: active 不能同时 superseded`);
      for (const kind of item.artifactKinds ?? []) if (!artifactKinds.has(kind)) errors.push(`${item.id}: artifactKind 无效 ${kind}`);
      for (const relative of item.read ?? []) {
        const file = path.join(path.dirname(path.join(SYSTEM_ROOT, ability.exemplarIndex)), relative);
        if (!fs.existsSync(file)) errors.push(`${item.id}: Canonical 文件不存在 ${relative}`);
      }
    }
  }
}

const knowledge = readJson('30-知识库/索引.json');
for (const route of knowledge?.routes ?? []) {
  if (!['active','observe','retired'].includes(route.lifecycle)) errors.push('知识生命周期无效');
  for (const file of route.read ?? []) if (!fs.existsSync(path.join(SYSTEM_ROOT, '30-知识库', file))) errors.push(`知识文件不存在: ${file}`);
}

const specMapExample = readJson('.ai/templates/spec-map.example.json');
if (specMapExample?.schemaVersion !== 1 || !Array.isArray(specMapExample.mappings)) errors.push('spec-map.example.json: Schema 无效');
const specPolicyExample = readJson('.ai/templates/spec-policy.example.json');
if (specPolicyExample?.schemaVersion !== 1 || !['advisory','balanced','strict'].includes(specPolicyExample.mode)) errors.push('spec-policy.example.json: Schema 无效');

const state = fs.readFileSync(path.join(SYSTEM_ROOT, '40-脚本/lib/state-manager.mjs'), 'utf8');
if (!/TRANSITIONS/u.test(state) || !/withFileLock/u.test(state) || !/CURRENT_SCHEMA = 6/u.test(state)) errors.push('State Manager 缺少 V6 转换或并发锁');
const policy = fs.readFileSync(path.join(SYSTEM_ROOT, '40-脚本/lib/task-policy.mjs'), 'utf8');
if (/autoSpawn|verifierQueue|multiAgentConsensus/u.test(policy)) errors.push('禁止自动 Agent 编排策略');
const agents = fs.readFileSync(path.join(SYSTEM_ROOT, 'AGENTS.md'), 'utf8');
for (const marker of ['普通对话','只读工程分析','仓库写任务','waiting_acceptance','specImpact']) if (!agents.includes(marker)) errors.push(`AGENTS.md: 缺少入口规则 ${marker}`);

const result = {
  ok: errors.length === 0,
  version: pkg?.version ?? null,
  abilities: abilityManifest?.abilities?.length ?? 0,
  knowledgeRoutes: knowledge?.routes?.length ?? 0,
  errors,
  warnings
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
