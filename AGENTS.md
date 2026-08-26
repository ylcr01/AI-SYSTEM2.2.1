# AI 研发操作系统 V2.3.0 入口规则

适用于具备本地文件和终端能力的模型宿主。只加载当前任务需要的信息，不降低 Scope、Evidence、状态真实性和用户验收门禁。

## 路由

- **普通对话**：不依赖仓库事实时直接回答，不建 Task、不运行工程脚本。
- **只读工程分析**：先运行 `node "$env:AI_RD_OS_ROOT\40-脚本\build-context.mjs" --cwd "<项目路径>" --intent "<目标>"`，读取轻量结果的 `executionTarget`、`classification`、配置摘要和 `filesToRead`；仅在身份、路由或依赖诊断时追加 `--full`，不得修改仓库。
- **仓库写任务**：编辑前运行 `node "$env:AI_RD_OS_ROOT\40-脚本\task.mjs" 准备 --cwd "<项目路径>" --intent "<目标>" --acceptance "<验收>" --scope "<授权路径>"`。主工作区只允许一个写 Task；并行写各自独占 Worktree（Codex managed，其他宿主 detached），linked/detached 必须传 `--integration-target`。按回执 Scope 与 `filesToRead` 实施最小 ChangeSet。Worktree 先提交再交付；`ready_to_integrate` 由单一集成者集成 `resultCommit` 并运行 `集成`。`needs_rework` 暂停用 `保存`，继续用 `恢复` 重新竞争写锁。仅 `waiting_acceptance` 且门禁有效时可称“本轮已交付”；这不是用户显式验收，不得伪造 `accepted`。
- **对话后续**：仅有精确 `continuation.taskId + deliveryId` 时，下一消息前调用一次 `后续`：追问 `related-question`、缺陷 `defect-return`、新增目标 `scope-extension`、非正式肯定 `positive-acknowledgement`、独立话题 `topic-advance`；不确定或含追问用 `related-question`。追问只记首次；无 continuation 不猜 Task，不存正文、不跑检查、不自动建 Task。
- **写任务对齐**：准备前先读项目事实、目标代码与相关测试并输出简短目标卡；Quick/局部明确任务可 direct，Controlled/Structural 或不同业务结果的实质方案必须先确认或获得明确委托；根因未知先只读探索。对齐、重对齐与交付映射规则见 `20-能力模块/clarify-requirements/CONTRACT.md`。
- **外部写入或高风险动作**：Push、发布、部署、迁移、远程删除、生产数据修改等必须另获用户明确授权；安全、认证、隐私、迁移和不可逆动作还要覆盖拒绝路径、失败停止条件和可执行回滚。

## 可信边界

- 权威顺序：用户目标与授权 → 当前代码、配置、Manifest 和 Git 状态 → 已确认模块规格 → 项目 Contract/Canonical → 绑定底座 → 中央资料 → 历史代码。代码与规格冲突时不得静默选择。
- 模型先按上述权威顺序消除不确定性；仅当未确认事项的多种合理解释会改变业务结果、授权 Scope、外部影响或风险等级时才向用户确认，其余低风险、可逆、不改变业务语义的细节按项目惯例自主处理。
- 默认采用满足目标与 Acceptance 的最小充分变更，优先复用现有结构；仅正确性、一致性或验收确实要求时才扩大方案，邻近问题只报告。
- 默认使用有界 `rg`、选段、`git diff --stat/--numstat` 和进程内聚合；不加载整份 Task JSON、整段对话历史、完整成功日志或大 Diff。确需诊断时再升级；裁剪不得隐藏首个失败、失败/跳过/终止、Evidence、Blocker 和新鲜度事实。
- 不猜项目、Scope、权限或外部授权；保留用户已有改动。
- Evidence 必须绑定 Task、ChangeSet、输入周期、Acceptance 和 Covers；输入改变后旧 Evidence 失效，相同输入失败不得机械重跑。
- 自检不能冒充独立审查；`accepted` 只有用户显式通过才能产生，`closed` 只表示对话自然收口。
- 交付前按真实 ChangeSet 声明 `specImpact=none|updated|decision-required`；后两者必须满足规格或 Decision 门禁。

## 浏览器验证硬门禁

- 普通交付冒烟最多 4 条核心链路，目标 60 秒；单条最长 15 秒，整批预算 2 分钟，外层硬超时 3 分钟且不可放宽。
- 首个失败或超时立即停止并诊断；不自动重试，固定等待不超过 1 秒，只按状态或事件等待。
- 连续 30 秒无有效输出即终止；至少每 30 秒报告完成数、失败数和阻塞点。
- 超过 4 条、预计超过 2 分钟或全量历史用例即为回归测试；普通交付不运行，须拆为独立任务并先获用户明确授权。
- 如实报告终止、失败、未执行和熔断；其他检查不能替代浏览器验证。若仓库有浏览器测试配置，Runner 或外层命令也须固化上述超时和熔断。

## 按需规则

仅任务涉及规格变化、Decision 或用户要求整理经验时，才读取 `70-文档/25-按需任务规则.md`。行为保持触发见 `20-能力模块/clarify-requirements/CONTRACT.md`；普通优化/重构不自动进入严格 Preservation。
