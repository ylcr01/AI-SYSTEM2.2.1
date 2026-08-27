---
id: DEC-AUTOMATIC-SERIAL-INTEGRATION-001
status: accepted
affects:
  - ARCH-AGENT-INTEGRATION
sourceTaskId: task-20260825014558132-3eab3e38
adoptedByTaskId: task-20260826034633068-92d6b9bb
supersedes:
  - DEC-AGENT-INTEGRATION-001
  - DEC-WORKTREE-FIRST-001
---

# 普通写任务默认 Worktree 隔离并串行自动集成

## 背景

分支只隔离已提交历史，不隔离同一目录里的未提交文件。多个任务共享主 checkout 时，会互相看到并覆盖工作区状态；若只要求任务形成分支但不及时集成和清理，又会持续积累含义不清的遗留分支。

## 决定

- 主 Local checkout 只持有目标分支并承担串行集成；所有写任务必须在任务专属 Worktree 中准备，不提供 Local 写入例外。
- Worktree 任务形成独立 `resultCommit` 并通过交付门禁后进入 `ready_to_integrate`。低风险任务由单一集成者默认立即执行 `task.mjs 集成`，不再等待一次重复确认。
- 集成按 Git Common Dir 与目标分支加锁，在系统专属临时 Worktree 中把任务提交应用到最新目标 HEAD，并重放固化的 Check Manifest。只有候选干净、检查通过且目标 HEAD 未变化时，才以 fast-forward 推进目标分支。
- 成功后删除 pending ref，并仅在源 Worktree 干净、HEAD 仍等于 `resultCommit` 且不是当前进程目录时删除源 Worktree；任务分支仅在引用仍精确指向 `resultCommit` 时删除。
- 目标 checkout 脏、冲突未解决或未提交、检查失败、目标 HEAD 竞态变化、Controlled/Structural、规格待决策或存在残余风险时 fail closed。目标分支保持不变，任务保存原因、提交、冲突文件和可恢复的集成 Worktree。
- `集成 --confirm-only` 保留原有“外部先 merge/cherry-pick，再确认”的兼容路径。Push、发布、部署和用户最终验收仍是独立授权或事件。

## 影响

- 先完成的任务可以独立提交并安全进入目标分支；后完成的任务总是在最新目标 HEAD 上重放，冲突集中在隔离集成 Worktree 中解决。
- 成功路径不再积累任务分支和 Worktree；失败路径保留可恢复成果，不用清理换取表面整洁。
- 普通任务多一次临时 Worktree 创建与定点检查，换取目标分支原子推进和可验证的串行顺序。

## 未改变

不自动解决语义冲突，不绕过 Scope、Evidence、Review、规格、验证预算或用户最终验收门禁，也不授权任何远程写入和部署动作。

## 验证

测试覆盖主 checkout 默认拒绝、低风险自动集成与清理、目标 checkout 脏时停下、残余风险暂停、集成检查失败不推进目标分支，以及冲突解决并提交后的恢复集成。

## 回滚

可将 `集成` 恢复为只确认模式并停止自动清理，但回滚前必须保留所有 `ready_to_integrate` Task、pending ref 和冲突 Worktree；不得恢复多个写任务共享主 checkout。
