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
  return `# Personal AI R&D Operating System\n\nResolve \`AI_RD_OS_ROOT\` (fallback: \`${fallbackPath}\`); read \`AGENTS.md\`. Operation=read/write/external-write; read stays read-only. Preflight before repository writes. An ephemeral Quick/ordinary Standard uses a clean, available Local checkout (no writer) or clean isolated current Worktree: diff/check, guard full preflight identity/scope/risk; its receipt binds the final scoped local commit and lightweight outcome record. Dirty, occupied, concurrent, or uncertain state routes to managed Worktree or deterministic detached fallback. Formal, Controlled, Structural: task-dedicated Worktree, Task/integration gates, local result commit. Never bypass Scope/Evidence gates or claim delivery before \`waiting_acceptance\`; no external writes without explicit authorization. Never Push by default. Explicit acceptance is optional; with an exact prior \`continuation\`, record every distinct related follow-up and never scan for a pending Task. Unreadable: report degraded state.\n\nBrowser hard limits remain global: at most 4 smoke flows; 15s each; 2-minute batch; hard 3-minute outer timeout. Stop on the first failure or timeout; no retry/fixed wait over 1 second. Runner lacks 30-second heartbeat/no-output termination; report \`unimplemented\`. Over 4 flows/2 minutes or a full regression requires explicit user authorization. Report failed/skipped/terminated/circuit-broken checks. Other checks never substitute for browser verification.\n`;
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
