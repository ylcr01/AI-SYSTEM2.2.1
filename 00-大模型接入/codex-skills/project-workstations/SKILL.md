---
name: project-workstations
description: 分析真实软件项目的业务能力、当前架构、依赖与未来方向，设计、初始化或维护可直接对话的长期业务领域成员工作站。Use when the user asks to establish project/domain/member workstations, split a project among independent AI members, route maintenance tasks by business domain, reduce multi-Agent merge conflicts, or refresh an existing `.ai/workstations` system. Do not use merely to spawn temporary subagents for one task.
---

# 项目业务工作站

解析 `AI_RD_OS_ROOT`；若环境变量不可用，使用宿主已配置的 AI 研发操作系统回退路径。完整读取中央 `AGENTS.md` 和 `20-能力模块/project-workstations/SKILL.md` 后执行，不复制或改写中央流程。

中央系统保存通用方法、模板和命令；目标项目的业务知识只写入该项目 `.ai/workstations/`。所有仓库写入继续遵守中央 Task、Scope、Evidence、集成与用户验收门禁。

只有用户明确要求时才创建可直接对话的顶层成员任务。对话过长时使用 `$handoff-chat`，不要用 Fork 把完整重上下文复制到新工作站。
