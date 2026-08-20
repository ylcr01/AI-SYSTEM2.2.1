---
id: DEC-REMOVE-PROJECT-WORKSTATIONS-002
status: accepted
affects:
  - ARCH-PROJECT-WORKSTATIONS
sourceTaskId: task-20260820073530908-6e2b9e13
supersedes:
  - DEC-PROJECT-WORKSTATIONS-001
---

# 删除项目业务工作站中央能力

## 背景

项目业务工作站把长期领域身份、项目知识档案、上下文路由和并行执行建议组合成一套中央能力。实际任务记录中没有形成已验收的显式工作站使用结果，现有项目档案也已落后于项目事实。继续自动路由会增加入口、上下文和维护成本，并与按任务建立 Context、Task 和临时执行资源的现有机制重叠。

## 决定

- 删除中央工作站 Skill、Contract、模板、命令、运行时库和专属测试。
- `build-context` 和 `task.mjs` 不再公开或传播 `--workstation`，也不再自动读取 `.ai/workstations/`。
- 从能力 Manifest、发布入口、项目入口模板、README 和架构说明中删除工作站的活跃声明。
- 项目中已有的 `.ai/workstations/` 不迁移、不删除，可由项目自行作为普通文档保留和维护。
- 领域拆分、临时子 Agent 和并行 Worktree 继续按具体任务需要决定，不再绑定长期工作站身份。

## 影响

- 中央源码、测试和宿主接入面减少，普通任务不会因历史工作站档案增加上下文。
- 依赖 `--workstation` 的旧调用需要改为直接提供任务目标、项目路径和必要资料。
- 历史工作站资料不会再自动失效检查，是否继续使用由所属项目自行决定。

## 未改变

Task、Scope、Git Baseline、Evidence、Review、规格一致性、Worktree 隔离、单一集成者和用户最终验收门禁保持不变。普通项目入口、Manifest、Contract、规格映射和任务相关资料仍由 `build-context` 按需加载。

## 验证

- 系统检查不再要求工作站文件和入口。
- CLI 帮助不再暴露 `--workstation`。
- 测试证明遗留 `.ai/workstations/` 不进入上下文结果，普通上下文与 Task 流程仍通过。

## 回滚

只有后续真实任务证明长期工作站在准确率、交付效率或并行维护上有可重复净收益时，才以新的 Decision 和独立能力重新引入；不得仅恢复旧自动路由。
