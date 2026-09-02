import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runNode, tempDir } from '../helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, '40-脚本', 'configure-model-entry.mjs');

test('宿主入口只定位根规则', () => {
  const result = runNode(SCRIPT, ['生成', '--fallback', ROOT], { cwd: ROOT });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AI_RD_OS_ROOT/u);
  assert.match(result.stdout, /AGENTS\.md/u);
  assert.doesNotMatch(result.stdout, /Task|Scope|Worktree|Evidence|Browser/u);
});

test('根入口把研发判断交给模型', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  for (const marker of ['模型负责研发', '系统只提供事实与工具', '保留用户已有改动', '默认不 Push', '如实报告']) {
    assert.match(agents, new RegExp(marker, 'u'));
  }
  assert.match(agents, /不得用关键词、路径、文件类型、风险等级或模型判断结果触发/u);
});

test('项目入口保持轻量且默认不覆盖', (t) => {
  const project = tempDir(t);
  const first = runNode(SCRIPT, ['初始化项目', '--cwd', project], { cwd: ROOT });
  assert.equal(first.status, 0, first.stderr);
  const file = path.join(project, 'AGENTS.md');
  assert.match(fs.readFileSync(file, 'utf8'), /模型根据用户目标与项目事实自主选择/u);
  const second = runNode(SCRIPT, ['初始化项目', '--cwd', project], { cwd: ROOT });
  assert.notEqual(second.status, 0);
});

test('中央研发生命周期入口已移除', () => {
  for (const relative of [
    '40-脚本/build-context.mjs',
    '40-脚本/task.mjs',
    '40-脚本/run-checks.mjs',
    '40-脚本/validate-evidence.mjs',
  ]) assert.equal(fs.existsSync(path.join(ROOT, relative)), false, relative);
});
