# AI-SYSTEM

**面向个人开发者和强 Coding Agent 的轻量 AI 研发增强层。**

AI-SYSTEM 不替代 Codex、Claude Code 等 Coding Agent，也不试图成为 IDE、Agent Runtime、工作流平台或企业治理系统。它通过宿主自定义指令、项目 `AGENTS.md` 和本地 Node.js 工具，为真实软件任务补上少量但关键的纠偏能力：

> **理解用户目标 → 获取正确上下文 → 在授权范围内实现 → 用定点检查证明结果 → 保持集成状态真实 → 交给用户验收。**

系统不引入常驻服务，不接管模型的分析、设计和编码过程，也不把流程数量当作研发质量。

## 为什么存在

强 Coding Agent 的常见失败通常不是“不会写代码”，而是：

- 理解错用户真正需要的业务结果；
- 读取大量无关信息，或遗漏真正重要的项目事实；
- 顺手修改 Scope 之外的文件，覆盖用户已有改动；
- 跑了很多测试，却没有证明具体 Acceptance；
- Worktree 内验证通过，但集成到目标分支后已经失真；
- AI 宣布完成，而用户要求的结果仍缺少可信证据。

AI-SYSTEM 的目标不是增加更多流程，而是减少这些失败。

## 核心闭环

```text
普通对话        → 直接回答，不建立 Task
只读工程分析    → build-context → 读取最小相关事实
主工作区写任务  → 准备 → AI 实现 → 交付验证 → waiting_acceptance → 用户验收
并行 Worktree   → 准备 → 提交 → ready_to_integrate → 目标 HEAD 重验 → 用户验收
外部写入        → 完整闭环 + 单独明确授权
```

可信内核只硬控可以机器确认的事实：Goal、项目身份、Scope、用户已有改动、ChangeSet、Evidence、检查输入、Worktree 集成新鲜度和用户最终验收。模型仍负责理解、设计、实现和代码质量。

## 当前可信边界

### 显式证明

- 通用项目检查可以补充全局 Covers，但不能根据 Covers 猜测并自动证明某条 Acceptance。
- Acceptance 只有被检查显式列出时才算被证明。
- Task Check 只能声明受控 Runner、测试文件和显式 Acceptance ID；不能携带任意命令、参数或副作用。
- 当前 Task Check Runner 为 `node-test`。执行计划会保存为 Check Manifest，并绑定 Runner 版本和测试文件哈希。
- 外部导入的技术 Evidence 不能冒充系统亲自执行产生的 Gate Evidence。

Task Check 示例：

```json
{
  "schemaVersion": 1,
  "checks": [
    {
      "name": "order-create-A1",
      "runner": "node-test",
      "testFiles": ["tests/order-create.test.mjs"],
      "covers": ["behavior"],
      "acceptanceIds": ["A1"],
      "timeoutMs": 30000
    }
  ]
}
```

### 状态真实

- Task Schema V8 将写作态、待验收和历史记录分别保存在 `进行中/`、`待验收/` 和 `历史.jsonl`。
- `task.mjs 诊断状态` 只读报告重复、错位和无效记录，不自动修复账本。
- 测试入口使用独立临时 `stateRoot`，不会把测试 Task 写入中央运行记录。
- `forcedMode` 只能向上加强；文本参数不能声明“输入已变化”来清除失败事实。
- 相同输入失败不能机械重跑；只有真实 ChangeSet 变化、正式重新对齐或一次受限诊断重试会改变后续路径。

### Worktree 集成真实

- 每个并行写任务独占一个 Worktree；工作站是业务身份，不是 Worktree。
- Worktree 成果必须形成 `resultCommit`，系统使用 `refs/ai/pending/<taskId>` 保活待集成提交。
- 首次确认集成和目标分支后续变化都在干净的真实目标 HEAD 上重放交付时的 Check Manifest。
- 检查失败时保留 pending ref 并退回验证；只有重验通过后才能进入 `waiting_acceptance`。
- `accepted` 只能由用户验收事件产生。

## 快速开始

要求：Node.js 20 或 22、Git，以及具备本地文件和终端能力的 Coding Agent。

### 接入模型入口

```powershell
node ./40-脚本/configure-model-entry.mjs 生成
node ./40-脚本/configure-model-entry.mjs 检查
```

具体宿主和权限边界见 [`00-大模型接入/接入说明.md`](00-大模型接入/接入说明.md)。

### 读取项目上下文

```powershell
node ./40-脚本/build-context.mjs --cwd <项目路径> --intent "<目标>"
```

默认返回轻量上下文；只有身份、路由或依赖诊断需要完整信息时才追加 `--full`。

### 执行写任务

```powershell
node ./40-脚本/task.mjs 准备 --cwd <项目路径> --intent "<目标>" --acceptance "<验收>" --scope "."

node ./40-脚本/task.mjs 交付 --task-id <编号> `
  --task-check-file <检查.json> `
  --spec-impact none|updated|decision-required

node ./40-脚本/task.mjs 验收 --task-id <编号> --decision 通过|退回
```

Controlled、Structural 或严格行为保持任务还需要 Change Rationale，将真实 ChangeSet 文件映射到 Goal 或 Acceptance。

### 并行 Worktree

```powershell
git worktree add --detach <新路径> <起点>

node ./40-脚本/task.mjs 准备 --cwd <新路径> --intent "<目标>" `
  --acceptance "<验收>" --scope "." --integration-target main

# Worktree 中完成修改并提交后执行交付
node ./40-脚本/task.mjs 交付 --task-id <编号> --spec-impact none

# 由目标工作区的单一集成者完成 merge/cherry-pick 后
node ./40-脚本/task.mjs 集成 --task-id <编号> --cwd <目标工作区>
```

目标 HEAD 后续变化时运行：

```powershell
node ./40-脚本/task.mjs 重验集成 --task-id <编号> --cwd <目标工作区>
```

### 状态与预算

```powershell
node ./40-脚本/task.mjs 列表
node ./40-脚本/task.mjs 查看 --task-id <编号>
node ./40-脚本/task.mjs 诊断状态
node ./40-脚本/task.mjs 保存 --task-id <编号>
node ./40-脚本/task.mjs 恢复 --task-id <编号>
node ./40-脚本/task.mjs 继续验证 --task-id <编号> `
  --additional-budget-ms 120000 --reason "用户批准继续"
```

## 按需能力

以下能力保留，但不会进入所有任务的默认路径：

- `.ai/spec-map.json`：代码、规格、测试和 Decision 的确定性映射；
- `specImpact=updated|decision-required`：规格与架构决策门禁；
- `.ai/workstations/`：长期业务领域工作站；
- 严格 Preservation：明确要求保持全部行为或参考实现等价时启用；
- Review Package：只有用户或项目显式要求 Review 时生成；
- Experience Candidate：只能从已验收 Task 按需整理，不自动晋升规则；
- Browser smoke：仅在可观察浏览器行为确实需要时执行，并受 4 条核心链路和硬超时限制。

系统不建设常驻验证器、密码学签名、企业审批流、通用沙箱或自动 Agent 编排平台。新机制必须由真实返工、误解、错误证明或状态失真驱动，并证明净收益。

## 验证

```powershell
node ./40-脚本/check-system.mjs
node ./40-脚本/verify-system.mjs --profile tests
node ./40-脚本/verify-system.mjs --profile baseline
node ./40-脚本/verify-system.mjs --profile release
```

CI 在 Windows/Linux 的 Node.js 20 和 22 上运行。发布清单不静态宣称技术门禁永久通过，每次发布仍需执行当前源码对应的验证命令。

## 目录导航

```text
00-大模型接入/   宿主接入与模型入口
10-注册表/       项目与模板身份
20-能力模块/     按需能力 Contract、Skill 与样板
30-知识库/       中央知识路由
40-脚本/         上下文、Task、验证和诊断工具
60-测试/         Core、Integration、Scenarios 测试
70-文档/         架构、可信门禁、兼容、Decision 与评估
80-运行记录/     本机 Task、Evidence 和发布运行产物
```

## 当前状态

当前版本定位为 `runnable-baseline`，不是长期 `stable`。是否升级由真实项目中的首轮验收率、返工、门禁误报、集成后回归和上下文浪费决定，而不是由规则、文件或测试数量决定。
