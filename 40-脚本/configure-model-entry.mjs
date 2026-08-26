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
  return `# Personal AI R&D Operating System\n\nResolve \`AI_RD_OS_ROOT\` (fallback: \`${fallbackPath}\`); read \`AGENTS.md\`. Route lightweight direct changes separately from formal Tasks; every write uses a task-dedicated Worktree (managed or deterministic detached fallback). Never write or silently fall back to Local/main. Never bypass Scope/Evidence gates, run user acceptance, claim formal delivery before \`waiting_acceptance\`, or perform external writes without explicit user authorization. With an exact prior \`continuation\`, record one follow-up; never scan for a pending Task. If the entry is unreadable, report degraded state and do only repo-grounded low-risk work.\n\nBrowser hard limits remain global: at most 4 smoke flows, 15 seconds each, 2 minutes per batch, and a hard 3-minute outer timeout. Stop on the first failure or timeout; never auto-retry; wait at most 1 second on state/events. Terminate after 30 seconds without output and report progress. More than 4 flows, over 2 minutes, or a full regression requires explicit user authorization. Report failures, skips, terminations, and circuit breaks; enforce limits in the runner. Other checks never substitute for browser verification.\n`;
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
  let releaseVersion = null;
  try { version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch {}
  try { releaseVersion = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json'), 'utf8')).version; } catch {}
  return { ok: checks.every((item) => item.ok) && Boolean(version) && version === releaseVersion, root, version, releaseVersion, checks };
}

function projectAgentText() {
  return fs.readFileSync(path.join(SYSTEM_ROOT, '.ai', 'templates', 'project-AGENTS-template.md'), 'utf8');
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
