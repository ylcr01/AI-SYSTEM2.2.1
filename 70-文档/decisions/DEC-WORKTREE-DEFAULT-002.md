---
id: DEC-WORKTREE-DEFAULT-002
status: accepted
affects:
  - ARCH-AGENT-INTEGRATION
sourceTaskId: task-20260825071747201-032e7b26
adoptedByTaskId: task-20260826034633068-92d6b9bb
supersedes:
  - DEC-AGENT-INTEGRATION-001
  - DEC-WORKTREE-FIRST-001
---

# 所有仓库写任务默认使用任务专属 Worktree

## 背景

“第一个写任务可进入 Local、第二个任务再切 Worktree”的旧规则能保护同一工作树不被并行修改，但把并行性判断推迟到了第二个任务。模型容易把 `当前 Git 工作树已有活动写 Task` 转述为用户需要处理的占用，也可能等待前一任务、重复准备或在 Local 继续，导致任务无法自然并行。

## 决定

- 所有仓库写任务在准备和编辑前进入任务专属 Worktree；不再为第一个写任务提供 Local 特例。
- Codex 桌面端优先使用任务专属 managed Worktree。若宿主创建未落地、不可用或仓库识别失败，执行模型立即使用 `git worktree add --detach <新路径> <起点>` 创建确定性 fallback，不向用户报告占用，也不降级到 Local。
- Local/主工作区只承担只读分析和单一集成者的串行集成，不承载任务实现。
- 每个 Worktree 准备 Task 时显式声明 `integrationTarget`，形成独立提交并进入 `ready_to_integrate`。
- Task 保存 `baseCommit`、`resultCommit`、目标分支和公共 Git 目录，并用 `refs/ai/pending/<taskId>` 保活尚未集成的 detached commit。
- 单一集成者基于目标分支最新 HEAD 集成 `resultCommit`。后提交的任务负责处理其集成时出现的兼容和冲突，随后在真实目标提交上重验。
- Task 入口对 Local 返回稳定的 `WORKTREE_REQUIRED`，同一 Worktree 的第二个写 Task 返回 `WORKTREE_CONFLICT`。二者都是执行模型的内部路由信号，不是用户阻塞。
- 模型宿主指令由中央生成器产生最小路由触发；项目 `AGENTS.md` 只保存项目特有事实，不复制或重定义中央 Worktree 门禁。

## 影响

- 多个写任务从启动时就隔离文件、Git index、HEAD、依赖副作用和 Task Baseline，不再根据“是否已经出现第二个任务”改变策略。
- 所有写任务都需要提交和串行集成，增加少量 Git 与磁盘成本，但提交顺序、冲突责任和最终目标 HEAD 变为确定事实。
- Worktree 不隔离端口、数据库、设备和外部服务；这些共享资源仍需按项目配置独立实例或串行验证。

## 未改变

不扩大 Push、发布、部署或其他外部写入授权；不替用户验收；不允许自动忽略冲突、覆盖用户已有改动或跳过集成后验证。

## 验证

测试覆盖 Local Baseline 失败关闭、错误码与确定性 fallback 指令、detached Worktree 识别、生成式模型入口、同 Worktree 冲突提示，以及既有独立提交、pending ref、最新目标 HEAD 集成与重验路径。

## 回滚

若真实任务数据证明所有写任务 Worktree 的净成本不可接受，必须以新 Decision 显式取代本决定，并保留同工作树单写、独立提交、串行集成、目标 HEAD 重验和用户最终验收门禁；不得静默恢复 Local 首任务特例。
