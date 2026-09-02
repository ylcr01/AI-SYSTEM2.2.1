import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('架构明确模型与系统职责边界', () => {
  const architecture = read('70-文档/10-架构与原则.md');
  assert.match(architecture, /模型自主负责/u);
  assert.match(architecture, /系统只守住/u);
  assert.match(architecture, /不自动加载 Contract、规格、经验、样板或测试/u);
});

test('系统使命与六项核心诉求受到保护', () => {
  const architecture = read('70-文档/10-架构与原则.md');
  assert.match(architecture, /系统以真实研发问题和真实交付结果为反馈/u);
  assert.match(architecture, /系统使命、唯一结果标准、六项核心诉求和不可退化边界/u);
  for (const marker of ['模型能力不降低', '准确', '高质量', '高效率', '优雅', '清晰']) {
    assert.match(architecture, new RegExp(marker, 'u'));
  }
});

test('中央硬约束必须满足三项资格', () => {
  const governance = read('70-文档/55-系统演进准入.md');
  assert.match(governance, /模型无法仅凭目标和项目事实可靠确认/u);
  assert.match(governance, /失败会造成难以恢复/u);
  assert.match(governance, /机器客观确认/u);
  assert.match(governance, /决定应为 `remove`，不是继续修补/u);
});

test('模型自主决定已退役中央生命周期', () => {
  const decision = read('70-文档/decisions/DEC-MODEL-AUTONOMY-EXECUTION-001.md');
  assert.match(decision, /中央 Task、Goal Card、Scope、Evidence/u);
  assert.match(decision, /退出当前架构/u);
  assert.match(decision, /不得接管整项研发任务/u);
});
