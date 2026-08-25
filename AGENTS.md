# AI 研发操作系统 V2.3.0 入口规则

适用于有本地文件和终端能力的宿主。只加载当前任务所需信息，不降低可信门禁。

## 路由

- **普通对话**：不依赖仓库事实时直接回答，不建 Task、不运行工程脚本。
- **只读工程分析与仓库上下文**：先运行 `node "$env:AI_RD_OS_ROOT\40-脚本\build-context.mjs" --cwd "<项目路径>" --intent "<目标>"`，只读取轻量结果与目标代码、直接测试；仅身份、路由或依赖诊断追加 `--full`，不得修改仓库。
- **轻量直达**：`continuity=ephemeral` 的 Quick/普通 Standard 局部修改也必须先由宿主进入任务专属 Worktree，再输出简短目标卡、实施最小 Diff；它不创建正式 Task，只跑定点检查并报告失败、跳过和未验证项，不声称 Evidence、`waiting_acceptance` 或用户验收。
- **仓库写任务（正式 Task）**：`tracked|handoff-required`、Controlled、Structural、规格/Decision、外部写入、跨仓等任务一律使用任务专属 Worktree（Codex managed Worktree 或 `git worktree add --detach`），编辑前运行 `task.mjs 准备` 并声明 `--integration-target`。主 Local checkout 只用于只读分析和单一集成者串行集成。Worktree 完成后及时提交、`交付`；进入 `ready_to_integrate` 后默认立即执行 `集成 --task-id "<taskId>"`，系统在隔离候选上应用提交和重放检查，成功才快进目标分支并安全清理；目标脏、冲突、验证失败或高风险时不修改目标分支。暂停用 `保存`，继续用 `恢复`。只有有效 `waiting_acceptance` 可称“本轮已交付”，不得伪造 `accepted`。
- **对话后续**：仅有精确 `continuation.taskId + deliveryId` 时，下一消息前调用一次 `后续`：追问 `related-question`、缺陷 `defect-return`、新增目标 `scope-extension`、非正式肯定 `positive-acknowledgement`、独立话题 `topic-advance`；不确定或含追问用 `related-question`。追问只记首次；无 continuation 不猜 Task，不存正文、不跑检查、不自动建 Task。
- **写任务对齐**：准备前先读项目事实、目标代码与相关测试并输出简短目标卡；Quick/局部明确任务可 direct，Controlled/Structural 或不同业务结果的实质方案必须先确认或获得明确委托；根因未知先只读探索。对齐、重对齐与交付映射规则见 `20-能力模块/clarify-requirements/CONTRACT.md`。
- **外部写入或高风险动作**：Push、发布、部署、迁移、远程删除、生产数据修改等必须另获用户明确授权；安全、认证、隐私、迁移和不可逆动作还要覆盖拒绝路径、失败停止条件和可执行回滚。

## 可信边界

- 权威顺序：用户目标与授权 → 当前代码、配置、Manifest 和 Git 状态 → 已确认模块规格 → 项目 Contract/Canonical → 绑定底座 → 中央资料 → 历史代码。代码与规格冲突时不得静默选择。
- 仅当多种合理解释会改变业务结果、Scope、外部影响或风险时才向用户确认；其余低风险、可逆细节按项目惯例处理。
- 默认采用满足目标与 Acceptance 的最小充分变更，优先复用现有结构；仅正确性、一致性或验收确实要求时才扩大方案，邻近问题只报告。
- 默认使用有界 `rg`、选段、`git diff --stat/--numstat` 和进程内聚合；不加载整份 Task JSON、整段对话历史、完整成功日志或大 Diff。重复构建上下文时传回上次 `contextFingerprint`，未变化则不重复读取；确需诊断时再用 `--full`。裁剪不得隐藏首个失败、失败/跳过/终止、Evidence、Blocker 和新鲜度事实。
- 不猜项目、Scope、权限或外部授权；保留用户已有改动。
- 正式 Task 的 Evidence 必须绑定 Task、ChangeSet、输入周期、Acceptance 和 Covers；输入改变后旧 Evidence 失效，相同输入失败不得机械重跑。轻量直达只报告检查事实，不生成 Evidence。
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
