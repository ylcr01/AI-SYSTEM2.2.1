#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { atomicWriteText } from './lib/atomic-file.mjs';

const SYSTEM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const action = args._[0] ?? '检查';

function instructionText(fallback) {
  const fallbackPath = path.resolve(fallback ?? SYSTEM_ROOT);
  return `# Personal AI R&D Operating System\n\nFor every request that depends on local repository facts or may change repository files:\n\n1. Resolve \`AI_RD_OS_ROOT\`. Read \`$AI_RD_OS_ROOT/AGENTS.md\` before acting.\n2. If the variable is unavailable or unreadable, use \`${fallbackPath}\` as the current-machine fallback and read its \`AGENTS.md\`.\n3. Follow that file's routing rules:\n   - ordinary conversation: answer directly;\n   - read-only repository analysis: run \`40-脚本/build-context.mjs\`;\n   - repository write task: run \`40-脚本/task.mjs 准备\` before editing, then \`交付\` after validation;\n   - never run user acceptance on the user's behalf.\n4. Do not claim completion unless the Task reaches \`waiting_acceptance\`.\n5. Push, deploy, publish, delete remote data, or other external writes require separate explicit user authorization.\n`;
}

function checkRoot(root) {
  const checks = [
    'AGENTS.md',
    'package.json',
    '40-脚本/build-context.mjs',
    '40-脚本/task.mjs',
    '40-脚本/spec-consistency.mjs'
  ].map((relative) => {
    const file = path.join(root, relative);
    return { relative, file, ok: fs.existsSync(file) && fs.statSync(file).isFile() };
  });
  let version = null;
  try { version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch {}
  return { ok: checks.every((item) => item.ok) && version === '2.2.1', root, version, checks };
}

function projectAgentText() {
  return `# Project AI Entry\n\n## 系统入口\n\n- 先解析环境变量 \`AI_RD_OS_ROOT\`，读取其中的 \`AGENTS.md\`。\n- 本文件只补充当前项目事实，不替代 AI-SYSTEM 的可信执行规则。\n\n## 项目知识\n\n- 模块规格：\`docs/modules/\`（存在时按目标模块读取）\n- 规格映射：\`.ai/spec-map.json\`（存在时使用）\n- 规格策略：\`.ai/spec-policy.json\`（存在时使用）\n- 项目经验：\`.ai/30-经验/\`（只按任务相关性读取）\n\n## 规则\n\n- 普通问答不建立 Task。\n- 只读分析先构建 Context，不修改仓库。\n- 写任务必须先准备 Task，再修改，最后交付并等待用户验收。\n- 规格、代码和测试冲突时不得静默选择。\n`;
}

try {
  if (action === '生成' || action === 'generate') {
    process.stdout.write(instructionText(args.fallback));
  } else if (action === '初始化项目' || action === 'init-project') {
    const cwd = path.resolve(args.cwd ?? process.cwd());
    const target = path.join(cwd, 'AGENTS.md');
    if (fs.existsSync(target) && args.force !== true) throw new Error('项目 AGENTS.md 已存在；如需覆盖请使用 --force');
    atomicWriteText(target, projectAgentText(), path.join(cwd, '.ai', '.pending'));
    console.log(JSON.stringify({ ok: true, file: target }, null, 2));
  } else {
    const root = path.resolve(args.root ?? process.env.AI_RD_OS_ROOT ?? SYSTEM_ROOT);
    const result = checkRoot(root);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
} catch (error) {
  console.error(`大模型入口配置失败: ${error.message}`);
  process.exitCode = 1;
}
