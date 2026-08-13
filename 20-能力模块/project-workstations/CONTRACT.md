---
id: project-workstations
version: 1
status: active
artifactKinds: [documentation, knowledge]
---

# 项目业务工作站 Contract

## 适用范围

多业务模块项目的领域划分、长期成员工作站初始化、工作站档案维护、任务路由和并行执行边界。

## 强制边界

- 中央系统只保存通用协议、模板和工具；业务知识保存在对应项目的 `.ai/workstations/`。
- 工作站是软领域归属，不是目录级写权限，也不阻止真实任务需要的跨域变更。
- 项目代码、配置、Manifest、Git 状态和已确认规格高于历史档案；冲突时停止沿用旧结论并修订档案。
- 自动路由最多选择一个领域；多领域同分时要求显式选择，不批量加载全部领域资料。
- 初始化必须基于用户确认的方案并拒绝覆盖已有工作站目录。
- 工作站可由用户直接派发任务并自治提交；仓库写入、Evidence、集成和用户验收继续遵守项目入口规则。
- 工作站不永久绑定 Chat、分支、Worktree 或临时子 Agent。

## 最小项目产物

`.ai/workstations/index.json`、共享规则，以及每个领域的 `profile.md` 和 `runbook.md`。

## 验证

检查 Schema、唯一 ID、仓库内相对路径、资料文件存在性、自动路由唯一性、非覆盖初始化和档案核实提交是否滞后。
