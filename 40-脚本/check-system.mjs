import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM_ROOT, loadRegistry, validateRegistry } from './lib/registry.mjs';

const errors = [];

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
const release = readJson('release-manifest.json');
if (!/^\d+\.\d+\.\d+$/u.test(pkg?.version ?? '')) errors.push('package.json: 版本必须是 SemVer');
if (release?.version !== pkg?.version) errors.push('release-manifest.json: version 必须与 package.json 一致');

for (const relative of [
  'AGENTS.md',
  'README.md',
  '00-大模型接入/接入说明.md',
  '40-脚本/configure-model-entry.mjs',
  '40-脚本/manage-registry.mjs',
  '40-脚本/spec-map.mjs',
  '40-脚本/spec-consistency.mjs',
  '40-脚本/lib/registry.mjs',
  '40-脚本/lib/spec-mapper.mjs',
  '40-脚本/lib/spec-consistency.mjs',
  '70-文档/10-架构与原则.md',
  '70-文档/20-可信门禁.md',
  '70-文档/55-系统演进准入.md',
]) requireFile(relative);

for (const retired of [
  '.ai/templates/goal-card.example.json',
  '20-能力模块/manifest.json',
  '40-脚本/build-context.mjs',
  '40-脚本/task.mjs',
  '40-脚本/run-checks.mjs',
  '40-脚本/validate-evidence.mjs',
  '40-脚本/lib/experience-candidate.mjs',
  '40-脚本/lib/experience-dedupe.mjs',
  '40-脚本/lib/task-runner.mjs',
  '40-脚本/lib/task-policy.mjs',
  '40-脚本/lib/state-manager.mjs',
  '40-脚本/lib/evidence.mjs',
  '40-脚本/lib/check-planner.mjs',
  '40-脚本/lib/integration-workflow.mjs',
]) {
  if (fs.existsSync(path.join(SYSTEM_ROOT, retired))) errors.push(`${retired}: 已退役机制不应存在`);
}

const agents = fs.readFileSync(path.join(SYSTEM_ROOT, 'AGENTS.md'), 'utf8');
for (const marker of ['模型负责研发', '系统只提供事实与工具', '保留用户已有改动', '默认不 Push', '如实报告']) {
  if (!agents.includes(marker)) errors.push(`AGENTS.md: 缺少 ${marker}`);
}

const architecture = fs.readFileSync(path.join(SYSTEM_ROOT, '70-文档', '10-架构与原则.md'), 'utf8');
const protectedMission = '系统以真实研发问题和真实交付结果为反馈，在不实质降低模型理解、推理、探索、判断和创造能力的前提下，通过最小充分的 Context、Prompt、规则、Contract、Skill、工具和门禁，减少无效消耗与重复错误，使模型更高效、稳定地交付准确、高质量、优雅、清晰且可验证的结果。';
if (!architecture.includes(protectedMission)) errors.push('架构与原则: 受保护的系统使命缺失或被改写');
for (const marker of ['## 目标保护', '## 唯一结果标准', '## 六项核心诉求', '模型能力不降低', '准确', '高质量', '高效率', '优雅', '清晰', '## 不可退化边界']) {
  if (!architecture.includes(marker)) errors.push(`架构与原则: 缺少受保护目标 ${marker}`);
}

try {
  const registry = validateRegistry(loadRegistry());
  errors.push(...registry.errors.map((item) => `${item.location}: ${item.message}`));
} catch (error) {
  errors.push(`注册表: ${error.message}`);
}

const result = { ok: errors.length === 0, version: pkg?.version ?? null, errors };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
