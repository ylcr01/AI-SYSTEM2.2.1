# AI 研发操作系统 V2.2.1 入口规则

适用于具备本地文件和终端能力的模型宿主。只加载当前任务需要的信息，不降低 Scope、Evidence、状态真实性和用户验收门禁。

## 路由

- **普通对话**：不依赖仓库事实时直接回答，不建 Task、不运行工程脚本。
- **只读工程分析**：先运行 `node "$env:AI_RD_OS_ROOT\40-脚本\build-context.mjs" --cwd "<项目路径>" --intent "<目标>"`，读取轻量结果的 `executionTarget`、`classification`、配置摘要和 `filesToRead`；仅在身份、路由或依赖诊断时追加 `--full`，不得修改仓库。
- **业务工作站**：项目存在 `.ai/workstations/index.json` 时先读索引；使用 `--workstation <id>` 显式进入领域，或只加载任务关键词唯一命中的单个领域档案。工作站是用户可直接对话的软领域归属，不是路径权限；写任务仍走下述可信门禁。
- **仓库写任务**：编辑前运行 `node "$env:AI_RD_OS_ROOT\40-脚本\task.mjs" 准备 --cwd "<项目路径>" --intent "<目标>" --acceptance "<验收>" --scope "<授权路径>"`；linked/detached worktree 还必须传入 `--integration-target "<目标分支>"`。保存 `taskId`，读取回执中的 Scope 与 `filesToRead`，实施最小 ChangeSet；worktree 任务先提交再运行 `交付`，其状态进入 `ready_to_integrate` 后，由单一集成者将 `resultCommit` 集成到目标分支并运行 `集成 --task-id "<taskId>" --cwd "<目标工作区>"`。只有状态为 `waiting_acceptance` 才能说明已完成工程交付，模型不得替用户验收。
- **外部写入或高风险动作**：Push、发布、部署、迁移、远程删除、生产数据修改等必须另获用户明确授权；安全、认证、隐私、迁移和不可逆动作还要覆盖拒绝路径、失败停止条件和可执行回滚。

## 可信边界

- 权威顺序：本次用户目标与授权 → 当前代码、配置、Manifest 和 Git 状态 → 已确认模块规格 → 项目 Contract/Canonical → 绑定底座 → 中央资料 → 普通历史代码。代码与规格冲突时不得静默选择。
- 不猜项目、Scope、权限或外部授权；保留用户已有改动，只做满足目标的最小修改。
- Evidence 必须绑定当前 Task、ChangeSet、输入周期、Acceptance 和 Covers；检查改变输入后旧 Evidence 失效，相同输入失败不得机械重跑。
- 自检不能冒充独立审查，只有用户可以最终验收。
- 交付前按真实 ChangeSet 声明 `specImpact=none|updated|decision-required`；后两者必须满足规格或 Decision 门禁。

## 按需规则

只有任务涉及规格变化、Decision 或用户要求整理经验时，才读取 `70-文档/25-按需任务规则.md`。其他任务不要加载该文档。
