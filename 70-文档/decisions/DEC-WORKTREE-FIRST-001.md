---
id: DEC-WORKTREE-FIRST-001
status: accepted
affects:
  - ARCH-AGENT-INTEGRATION
  - ARCH-PROJECT-WORKSTATIONS
sourceTaskId: task-20260814092526757-caabc12d
supersedes: []
---

# 并行写任务在准备前使用独立 Worktree

## 背景

同一项目的多个 Codex 任务若先进入 Local/主工作区，中央 Task 会因同一 Git 工作树已有活动写任务而拒绝准备。该拒绝保护了未提交改动和 Task Baseline，但在占用发生后才临时创建 Worktree，会浪费任务启动时间，并让 `needs_rework` 等长时间写状态持续占用 Local。

## 决定

- 同一项目只有一个写任务时可使用 Local/主工作区；出现并行写时，每个任务必须在准备前进入独立 Worktree。
- Codex 桌面端优先使用任务专属 managed Worktree；其他宿主使用 detached worktree。长期业务工作站不永久绑定 Worktree。
- Local/目标分支工作区只保留一个写 Task 或执行串行集成；不允许多个并行写任务共享 Local 或永久 Worktree。
- linked/detached worktree 继续显式声明 `integrationTarget`，形成提交后进入 `ready_to_integrate`，由单一集成者进入目标分支。
- `needs_rework` 继续视为活动写状态；暂不继续时通过 `保存` 显式释放工作树，`恢复` 时重新检查写冲突。
- 中央系统只提供确定性冲突保护、状态提示和集成门禁，不自动创建、移动或删除 Worktree。

## 影响

- 并行任务在启动时完成文件、Git index、HEAD 和 Task Baseline 隔离，不再先占用 Local 后补建 Worktree。
- 同文件冲突不会消失，但集中到单一集成入口显式解决，不会在共享工作目录中静默覆盖。
- Worktree 会增加磁盘、依赖安装和运行环境隔离成本；端口、数据库和单实例设备仍需按任务分配或串行验证。

## 未改变

不强迫没有并行写的普通任务创建 Worktree 或提交，不改变同一工作树单写保护、Evidence、Review、规格一致性、外部写入授权和用户最终验收门禁。

## 验证

测试覆盖同工作树冲突提示、Codex managed Worktree 与 CLI fallback 引导、`needs_rework` 保存释放和恢复重检；既有 detached worktree 提交、待集成引用与集成确认测试继续通过。

## 回滚

可撤销 Worktree 优先入口与提示，恢复为发生冲突后手工创建 detached worktree；回滚不得移除同一工作树单写保护，也不得跳过尚未集成 Task 的 `ready_to_integrate` 门禁。
