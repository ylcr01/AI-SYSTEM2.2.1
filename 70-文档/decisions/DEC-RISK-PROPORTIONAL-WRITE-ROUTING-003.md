---
id: DEC-RISK-PROPORTIONAL-WRITE-ROUTING-003
status: superseded
supersededBy: DEC-MODEL-AUTONOMY-EXECUTION-001
affects:
  - ARCH-AGENT-INTEGRATION
sourceTaskId: task-20260827011139813-97e8e394
supersedes:
  - DEC-WORKTREE-DEFAULT-002
  - DEC-AUTOMATIC-SERIAL-INTEGRATION-001
---

# 仓库写入按风险分级路由

## 背景

所有仓库写入统一使用任务专属 Worktree，能提供文件、Index、HEAD 和集成顺序隔离，但把同一组固定成本施加给了普通局部修改：创建和清理 Worktree、提交、隔离集成以及重复定点检查。真实使用已经出现简单任务等待过长、上下文和控制面状态增长、测试重复及机制代码持续膨胀；这些成本对 `ephemeral` 任务没有对应的 Evidence 或正式验收收益。

## 决定

- 所有仓库写入先运行只读预检，再构建轻量 Context。预检只报告当前事实和推荐路由，不创建 Task、租约或新状态机。
- `continuity=ephemeral` 的 Quick/普通 Standard 在以下条件同时满足时使用 `local-direct`：当前是主 Local checkout、Git 状态干净、分支明确、同一工作树没有活动写 Task，且执行模型没有已知并发写入者。
- 合格的轻量直达只实施最小 Diff、运行一次目标测试或受影响检查并报告事实；不创建 Worktree、Task、Evidence、`waiting_acceptance`、自动集成或集成重验。
- 当前已经位于干净且未占用的任务 Worktree 时，轻量任务可在当前 Worktree 直接实施，不再创建第二个 Worktree。
- Local 脏、被占用、存在并发、主区处于 detached HEAD、Git 状态无法确认或执行模型无法确认唯一写入者时，确定性升级到 managed Worktree；宿主不可用时使用 detached Worktree fallback，不等待或要求用户处理占用。
- `tracked|handoff-required`、Controlled、Structural、规格/Decision、跨仓和外部写入仍使用专属 Worktree、正式 Task、精确 Scope、独立提交、Evidence 和串行集成重验。正式 `准备` 在 Local 继续以 `WORKTREE_REQUIRED` 失败关闭。
- 低风险的正式 Task 仍可由单一集成者立即集成；本决定只移除 `ephemeral` 普通任务的强制 Worktree 和固定重复集成，不删除 Worktree、Task 或集成能力。

## 影响

- 普通局部修改的启动、验证和交付路径缩短，控制面不再为不需要正式状态的任务制造记录。
- Worktree 从所有写入的固定前置条件变成脏状态、并发、不确定性和正式风险的升级路径。
- 预检只能发现系统已知 Task 与当前 Git 状态，不能证明所有外部进程均未写入；执行模型一旦知道存在并发或无法确认唯一写入者，必须使用 Worktree。
- Local 直达不生成正式 Evidence，也不得声称“本轮已交付”或用户已验收。

## 未改变

不改变同一工作树正式 Task 的原子单写保护、用户已有改动保护、Scope/Evidence、外部写入授权、目标 HEAD 新鲜度、高风险集成暂停和用户最终验收门禁。

## 验证

定点测试覆盖干净 Local 返回 `local-direct`、脏 Local 和已占用工作树返回 `new-worktree`、已隔离 Worktree 返回 `current-worktree`、正式 Task 继续拒绝 Local，以及生成式入口和根 `AGENTS.md` 不再声明所有写入强制 Worktree。先完成机制优化，再通过后续真实任务比较等待时间、上下文占用、重复验证与返工；不因本次技术自检直接宣称长期净收益。

## 回滚

若出现重复的 Local 并发覆盖、用户已有改动损坏或无法可靠路由，立即将 `ephemeral` 默认恢复为 managed Worktree，同时保留本决定产生的事实记录；不得通过扩大自动测试、重复集成或新增持久化状态掩盖路由问题。
