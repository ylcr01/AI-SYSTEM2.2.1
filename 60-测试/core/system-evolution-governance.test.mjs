import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('中央入口按需路由系统机制演进', () => {
  const agents = read('AGENTS.md');
  const readme = read('README.md');
  assert.ok(Buffer.byteLength(agents) < 5000);
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
  assert.match(architecture, /代码、配置、Manifest 和 Git 状态证明当前实际实现/u);
  assert.match(architecture, /真实任务、用户验收、返工和 Regression 证明机制产生了什么效果/u);
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
  assert.match(governance, /不为本准入规则新增第二套 Task、审批人、分数、Dashboard 或持久化状态机/u);
});

test('真实任务计划提供机制净收益判断口径', () => {
  const plan = read(path.join('70-文档', '60-真实任务验证计划.md'));
  assert.match(plan, /系统版本或 Commit/u);
  assert.match(plan, /目标理解、上下文、实现、验证、控制面、验收或环境/u);
  assert.match(plan, /首轮验收、返工、遗漏\/Regression、流程额外耗时和状态债务/u);
  assert.match(plan, /keep \| shrink \| remove \| observe \| experiment/u);
  assert.match(plan, /当前实现验证通过只能证明本次变更可交付/u);
});
