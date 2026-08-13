---
name: project-workstations
description: 分析真实项目的业务能力、架构与依赖，提出并维护可直接对话的长期成员工作站；项目档案按领域渐进加载，任务可独立执行并按需使用临时子 Agent 或 detached worktree。
---

# project-workstations

解析 `AI_RD_OS_ROOT` 后使用 `40-脚本/workstations.mjs`。先运行 `分析 --cwd <项目>` 并读取项目入口、Manifest、目录、规格、关键依赖与当前 Git 事实。按业务能力划分工作站，不按 `api/components/utils` 等技术目录机械拆分。

向用户提交领域名称、摘要、职责、非目标、关键词、不变量、代码入口、依赖、共享热点、建议验证方式和未来方向，并区分当前事实、推断和规划。用户确认后，基于 `.ai/templates/workstations/plan.example.json` 填写方案；只在目标项目已准备的写 Task 中运行 `初始化 --cwd <项目> --plan <方案> --confirm-plan`。不得把未确认推断写成稳定业务事实，不得覆盖已有 `.ai/workstations`。

任务上下文按 `index.json → shared.md → 单个 profile.md → 写任务 runbook.md → 当前代码` 渐进加载。领域是默认专业归属而非路径权限：允许完成真实任务所需的跨域分析和最小修改。

每个工作站是用户可直接派发任务的长期身份，不依赖主 Agent 串行分配。它可以自行分析、实现、验证和提交，并按任务复杂度启动临时子 Agent。Worktree 只服务并行写隔离，不作为工作站永久目录；并行提交继续走单一集成入口。

只有用户明确要求创建 Codex 任务时，才为每个领域创建独立顶层任务。使用新任务而不是从重对话 Fork，初始提示仅引用项目根、工作站 ID 和档案路径。标题使用 `(进行中) <项目>-<领域>-S01`；需要显式路由时给 `build-context` 或 `task.mjs 准备` 传入 `--workstation <id>`。

稳定知识写回项目档案；完整对话、临时日志、个人任务 ID 和密钥不得进入档案。使用 `检查 --cwd <项目>` 校验，全部档案基于当前提交复核后才运行 `刷新 --confirm-reviewed`。对话过长时使用 `$handoff-chat` 接续，旧任务确认快照已保存后归档。
