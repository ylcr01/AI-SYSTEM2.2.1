# AI-SYSTEM

**面向个人开发者和强 Coding Agent 的轻量 AI 研发增强层。**

当前版本：`V2.2.2`。

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
主工作区写任务  → 正在处理 → 等待你验收 → 已结束
并行 Worktree   → 正在处理（含集成与目标 HEAD 重验）→ 等待你验收 → 已结束
外部写入        → 完整闭环 + 单独明确授权
```

可信内核只硬控可以机器确认的事实：Goal、项目身份、Scope、用户已有改动、ChangeSet、Evidence、检查输入、Worktree 集成新鲜度和用户最终验收。模型仍负责理解、设计、实现和代码质量。

## 当前可信边界

- Acceptance 只有被定点检查显式绑定时才算被证明；通用检查和外部导入结果不能自动冒充验收证据。
- Task Check 只接受受控 Runner 和测试文件，Check Manifest 绑定 Runner 版本与输入哈希。
- Task 写作态、待验收和历史记录分层保存；默认回执只展示四种用户状态，最终验收只能由用户产生。
- 相同输入失败不能机械重跑；只有真实 ChangeSet、正式重新对齐或受限诊断重试能改变验证路径。
- 并行任务独占 Worktree；集成和目标 HEAD 变化后必须在真实目标提交上重放交付检查。
- Goal Card、Change Rationale 和 Task Check 由宿主自动处理，用户不维护内部 JSON 文件。

详细规则以 [`AGENTS.md`](AGENTS.md)、[`20-能力模块/clarify-requirements/CONTRACT.md`](20-能力模块/clarify-requirements/CONTRACT.md) 和 [`70-文档/20-可信门禁.md`](70-文档/20-可信门禁.md) 为准；维护者可运行 `task.mjs --help --full` 查看机器协议。

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

node ./40-脚本/task.mjs 交付 --task-id <编号>

node ./40-脚本/task.mjs 验收 --task-id <编号> --decision 通过|退回
```

宿主会在需要时自动生成 Goal Card、Change Rationale 和定点检查。用户只确认会改变业务结果、Scope、权限或外部影响的事项，不操作内部 JSON 文件。

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
node ./40-脚本/task.mjs 评估摘要 --from 2026-08-01 --to 2026-08-31
```

新 Task 自动记录首次交付、交付次数、验证耗时、用户决定、返工和首轮验收结果。用户退回时，宿主可按目标误解、Scope、验证缺口、代码质量、回归或非必要改动记录原因。`评估摘要` 只读汇总这些事实；少于 10 个样本只能观察方向，形成稳定结论仍需 20～30 个可比真实任务和明确基线。

## 按需能力

以下能力保留，但不会进入所有任务的默认路径：

- `.ai/spec-map.json`：代码、规格、测试和 Decision 的确定性映射；
- `specImpact=updated|decision-required`：规格与架构决策门禁；
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
