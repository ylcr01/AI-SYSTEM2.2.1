import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function normalizedUtf8Bytes(value) {
  return Buffer.byteLength(value.replace(/\r\n/g, '\n'));
}

test('中央入口按需路由系统机制演进', () => {
  const agents = read('AGENTS.md');
  const readme = read('README.md');
  assert.ok(normalizedUtf8Bytes(agents) < 5000);
  assert.match(agents, /中央机制增删改读 `70-文档\/10-架构与原则\.md`、`70-文档\/55-系统演进准入\.md`/u);
  assert.match(agents, /仅净正向进入默认路径；其余不加载/u);
  assert.match(readme, /70-文档\/10-架构与原则\.md/u);
  assert.match(readme, /70-文档\/55-系统演进准入\.md/u);
  assert.equal(fs.existsSync(path.join(ROOT, '70-文档', '55-系统演进准入.md')), true);
});

test('系统使命固化六项核心诉求和不可退化边界', () => {
  const architecture = read(path.join('70-文档', '10-架构与原则.md'));
  for (const marker of ['模型能力不降低', '准确', '高质量', '高效率', '优雅', '清晰']) {
    assert.match(architecture, new RegExp(marker, 'u'));
  }
  assert.match(architecture, /不可退化边界/u);
  assert.match(architecture, /## 唯一结果标准/u);
  assert.match(architecture, /真实用户目标/u);
  assert.match(architecture, /总成本同时包含 Context、模型调用、用户交互、等待、验证、返工、集成、认知和维护成本/u);
  assert.match(architecture, /窄触发、低成本、可直接核验的机制封闭该缺口/u);
  assert.match(architecture, /代码、配置、Manifest 和 Git 状态证明当前实际实现/u);
  assert.match(architecture, /真实任务、相关后续、返工和 Regression 证明机制产生了什么效果/u);
});

test('系统演进准入区分候选试验采纳和增删改', () => {
  const governance = read(path.join('70-文档', '55-系统演进准入.md'));
  for (const marker of ['candidate', 'experiment', 'adopted', 'observe', 'shrink / remove']) {
    assert.match(governance, new RegExp(marker.replace('/', '\\/'), 'u'));
  }
  for (const marker of ['新增', '修改', '精简', '删除', '恢复']) {
    assert.match(governance, new RegExp(`\\| ${marker} \\|`, 'u'));
  }
  assert.match(governance, /coreImpact:/u);
  assert.match(governance, /## 默认不新增与逐项评估/u);
  for (const marker of ['真实问题', '现有缺口', '可观察结果', '负向成本', '适用与不适用边界', '证据状态', '退出设计']) {
    assert.match(governance, new RegExp(marker, 'u'));
  }
  assert.match(governance, /decision: adopted \| keep \| shrink \| remove \| observe \| experiment/u);
  assert.match(governance, /不为本准入规则新增第二套 Task、审批人、分数、Dashboard 或持久化状态机/u);
});

test('外部 Agent Skills 按三档边界选择性吸收', () => {
  const decision = read(path.join('70-文档', 'decisions', 'DEC-SELECTIVE-AGENT-SKILLS-ADOPTION-001.md'));
  assert.match(decision, /Source-driven Development \| `adopted`/u);
  assert.match(decision, /Constraint Weakening Detection \| `adopted`/u);
  assert.match(decision, /When NOT to Apply \| `adopted`/u);
  assert.match(decision, /Anti-rationalization \| `shrink \/ observe`/u);
  assert.match(decision, /Code Simplification Heuristics \| `shrink \/ observe`/u);
  assert.match(decision, /Incremental Implementation \| `experiment`/u);
  assert.match(decision, /Fresh-context Adversarial Review \| `experiment`/u);
  assert.match(decision, /当前不实现 Slice 状态机/u);
  assert.match(decision, /当前不扩大 Review 触发率/u);
  assert.match(decision, /不创建独立 Skill/u);
});

test('真实任务计划提供机制净收益判断口径', () => {
  const plan = read(path.join('70-文档', '60-真实任务验证计划.md'));
  assert.match(plan, /系统版本或 Commit/u);
  assert.match(plan, /目标理解、上下文、实现、验证、控制面、验收或环境/u);
  assert.match(plan, /完成轮次分布、返工、遗漏\/Regression、流程额外耗时和状态债务/u);
  assert.match(plan, /keep \| shrink \| remove \| observe \| experiment/u);
  assert.match(plan, /当前实现验证通过只能证明本次变更可交付/u);
});
