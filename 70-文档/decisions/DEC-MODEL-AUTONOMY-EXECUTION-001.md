---
id: DEC-MODEL-AUTONOMY-EXECUTION-001
status: accepted
affects:
  - ARCH-AGENT-INTEGRATION
  - MOD-AIRD-QUALITY-STATE
sourceTaskId: task-20260901084223958-1049eb3e
supersedes:
  - DEC-RISK-PROPORTIONAL-WRITE-ROUTING-003
  - DEC-OUTCOME-ROUNDS-AND-LOCAL-COMMIT-004
  - DEC-AGENT-INTEGRATION-001
  - DEC-AUTOMATIC-SERIAL-INTEGRATION-001
  - DEC-INTEGRATION-FRESHNESS-001
  - DEC-TRUTH-FIRST-CONTROL-SHRINK-001
  - DEC-WORKTREE-DEFAULT-002
  - DEC-WORKTREE-FIRST-001
---

# 研发职责完整交还模型

## 背景

真实 POC 本地调试任务只需要在一个现有文件中修改约十行代码。系统却因 `src/api/pid.js` 路径命中 `public-contract` 风险模式，把普通修改升级成正式 Task；模型随后新增测试，触发 Scope 重建、两个 Worktree、重复验证和集成清理。第一次正式 Task 运行约 9 分钟后取消，第二次从准备到集成约 2 分 32 秒，而记录的正式检查执行仅 397 毫秒。用户明确退回该交付，认为流程降低模型判断能力、隐藏业务 Diff 并制造不相称成本。

这不是单个分类器误报，而是中央系统替模型决定需求、范围、验证和交付生命周期。继续增加 Scope 类型、未验证状态、任务扩展或 Evidence 复用只会让系统更重。

## 决定

- 模型自主决定需求理解、上下文、范围、文件、实现、测试、构建、异常路径、Worktree、架构、规格、证明方式、交付时机和继续探索。
- 系统只提供事实与工具并守住目标仓库身份、用户已有改动、真实并发、用户明确范围、外部/不可逆动作授权、默认不 Push 和结果真实性。
- 中央 Task、Goal Card、Scope、Evidence、Rationale、Check Manifest、自动检查、结果账本、提交与集成状态机退出当前架构；旧运行记录只作历史证据。
- Context、Contract、规格、经验、样板和项目命令全部按需，由模型自主选择，不通过关键词、路径、文件类型、风险等级或 artifact kind 自动加载。
- 中央硬约束只有在模型无法可靠确认、失败后果难以恢复、触发条件又可被机器客观判断时才成立；保护一次危险动作不得接管整项研发任务。

## 影响与边界

本决定不是给旧流程增加例外，而是删除中央研发生命周期。Codex 对话、Git、项目测试和宿主授权已提供研发所需能力，系统不再重复建设。

## 证据状态

本次用户退回和运行记录直接证明旧路径在该任务上的净收益为负；现有数据没有证明中央生命周期提高了真实首轮交付结果。用户明确要求按第一性原则删除，而不是继续修补。长期效果仍需从后续真实任务观察，不能由静态测试宣称。

## 验证与停止条件

- 后续观察总耗时、实际 ChangeSet、返工、遗漏、用户已有改动和外部影响。
- 若出现用户改动丢失、未经授权外部写入或结果失真，只修复对应客观边界，不恢复语义分类或任务状态机。
- 重新引入任何中央生命周期必须有新的真实结果证据，并证明模型自主判断和现有宿主能力无法以更低成本解决。
