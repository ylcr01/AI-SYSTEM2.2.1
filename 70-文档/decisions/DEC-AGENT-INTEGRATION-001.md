---
id: DEC-AGENT-INTEGRATION-001
status: accepted
affects:
  - ARCH-AGENT-INTEGRATION
sourceTaskId: task-20260812095713070-9975ae49
supersedes: []
---

# 并行 Agent 使用 detached worktree 与单一集成者

## 背景

原流程禁止同一工作树并行写，并要求人工通过 `git worktree add -b` 为每个并行任务创建分支。Task 只记录 ChangeSet 是否具备交付证据，不记录成果是否已进入目标分支，因此会出现分支被 worktree 占用、遗留分支增多，以及任务完成后忘记集成的问题。

## 决定

- 主工作区继续持有目标分支，并作为唯一集成入口；普通单工作树任务保持原流程。
- linked 或 detached worktree 的写任务必须声明 `integrationTarget`，不得依赖模型猜测目标分支。
- 并行 Agent 在 detached worktree 中形成提交，证据与 Review 满足后进入 `ready_to_integrate`，不能直接进入 `waiting_acceptance`。
- Task 保存 `baseCommit`、`resultCommit`、目标分支和公共 Git 目录，并通过 `refs/ai/pending/<taskId>` 保活尚未集成的 detached commit。
- 单一集成者完成 merge 或 cherry-pick 后显式运行集成确认。merge 通过祖先可达性验证；cherry-pick 通过任务提交区间的补丁等价性验证。
- 确认集成后记录目标提交并删除 pending ref；用户验收前仍确认该目标提交可从目标分支到达。

## 影响

- 并行 Agent 不再需要预先创建功能分支，也不会占用主分支。
- “实现完成”和“已经集成”成为两个机器可判定的状态，未集成成果会持续出现在 Task 列表中。
- 系统不自动执行 merge、cherry-pick、创建或删除 worktree；冲突处理与最终集成仍由一个明确的执行者串行完成。
- Task Schema 升级为 V7；活动 V6 Task 在读取时兼容升级，历史记录无需批量改写。

## 未改变

不改变用户最终验收门禁，不扩大 Push 或其他外部写入授权，不允许多个工作树同时持有同一分支，也不强迫主工作区内的普通任务创建提交。

## 验证

系统测试覆盖未提交成果被拒绝、待集成引用保活、未合并时确认失败、cherry-pick 等价确认、源 worktree 清理以及集成后用户验收。

## 回滚

若该流程造成不可接受的维护成本，可停止为新 Task 创建 integration 记录，并恢复 V6 的直接交付转换；回滚前必须先处理所有 `ready_to_integrate` Task 及其 `refs/ai/pending/*`，避免丢失尚未集成的提交。
