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
  '40-脚本/build-context.mjs',
  '40-脚本/task.mjs',
  '40-脚本/run-checks.mjs',
  '40-脚本/validate-evidence.mjs',
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

try {
  const registry = validateRegistry(loadRegistry());
  errors.push(...registry.errors.map((item) => `${item.location}: ${item.message}`));
} catch (error) {
  errors.push(`注册表: ${error.message}`);
}

const result = { ok: errors.length === 0, version: pkg?.version ?? null, errors };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
