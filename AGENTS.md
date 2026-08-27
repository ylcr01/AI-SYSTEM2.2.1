# AI 研发操作系统 V2.3.0 入口规则

## 路由

- **普通对话**：不依赖仓库事实时直接回答，不建 Task、不运行工程脚本。
- **只读工程分析**：先运行只读 `task.mjs 预检 --cwd "<项目路径>"`，再运行 `build-context.mjs --cwd "<项目路径>" --intent "<目标>"`；身份、路由或依赖诊断才追加 `--full`。
- **写入路由**：任何仓库写入先预检，再构建轻量 Context。`recommended=local-direct` 只表示当前 Local 干净、可用且没有已知并发写 Task；脏、占用、并发或状态不确定时立即进入 managed Worktree，宿主未落地时执行 `git worktree add --detach <路径> <起点>`，不得等待或要求用户处理占用。正式 Task 仍在原子创建时复核。
- **轻量直达**：`continuity=ephemeral` 的 Quick/普通 Standard 在 `local-direct` 或已经隔离的当前 Worktree 中实施最小 Diff 和一次受影响的定点检查，不创建 Task、Evidence、`waiting_acceptance` 或自动集成流程；如实报告失败、跳过和未验证项。
- **正式仓库写任务**：`tracked|handoff-required`、Controlled、Structural、规格/Decision、外部写入或跨仓任务在专属 Worktree 中 `准备 --integration-target`，重复 `--scope` 授权精确路径，再提交、`交付`并立即`集成`。重验通过才快进并清理；脏目标、冲突、验证失败或高风险时不推进。暂停/继续用`保存`/`恢复`；仅有效 `waiting_acceptance` 可称“本轮已交付”，不得伪造 `accepted`。
- **对话后续**：仅有精确 `continuation.taskId + deliveryId` 时，下一消息前调用一次 `后续`；不确定或含追问用 `related-question`。追问只记首次；无 continuation 不猜 Task、不存正文、不跑检查、不建 Task。
- **写任务对齐**：先预检，再读目标代码和直接测试并输出目标卡；Quick/局部任务可 direct，Controlled/Structural 或改变业务结果的方案须确认或明确委托；根因未知先只读探索。详见 `20-能力模块/clarify-requirements/CONTRACT.md`。
- **外部/高风险写入**：Push、发布、部署、迁移、远程删除、生产数据修改须另获授权；不可逆动作还须明确拒绝路径、停止条件和回滚。

## 可信边界

- 权威顺序：用户目标与授权 → 代码、配置、Manifest、Git 状态 → 已确认规格 → Contract/Canonical → 底座 → 中央资料 → 历史代码；冲突不得静默选择。
- 仅当合理解释会改变业务结果、Scope、外部影响或风险时确认；其余低风险可逆细节按项目惯例处理。
- 采用满足目标与 Acceptance 的最小充分变更；仅正确性、一致性或验收要求时扩大方案，邻近问题只报告。
- Acceptance 只写结果，不写命令、通用检查或全量门禁；Planner 前只写“生成并执行最小验证计划”。普通交付仅跑定点检查和缺失 Cover；全量回归须独立 Task 和明确授权。
- `package.json` 不按路径升级；元数据变更不升级，新增/删除、未知差异或其他字段按 build-contract 升级。
- 默认使用有界 `rg`、选段、`git diff --stat/--numstat` 和进程内聚合；不加载整份 Task JSON、对话历史、成功日志或大 Diff。重复构建上下文传回 `contextFingerprint`，未变化不重读；诊断才用 `--full`。裁剪不得隐藏首个失败、跳过、终止、Evidence、Blocker 和新鲜度。
- 不猜项目、Scope、权限或外部授权；保留用户已有改动。
- 正式 Evidence 必须绑定 Task、ChangeSet、输入周期、Acceptance 和 Covers；输入改变后失效，相同输入失败不得机械重跑。轻量直达不生成 Evidence。
- 自检不能冒充独立审查；`accepted` 只能由用户显式产生，`closed` 只表示对话收口。
- 交付前按真实 ChangeSet 声明 `specImpact=none|updated|decision-required`；后两者须满足规格或 Decision 门禁。

## 浏览器验证硬门禁

- 普通冒烟最多 4 条核心链路；单条最长 15 秒，整批预算 2 分钟，外层硬超时 3 分钟且不可放宽；首个失败或超时立即停止，不自动重试，固定等待不超过 1 秒。
- 连续 30 秒无有效输出即终止；每 30 秒报告完成、失败和阻塞。超过 4 条、预计超 2 分钟或全量历史用例属回归，须拆为独立任务并先获用户明确授权。
- 如实报告终止、失败、未执行和熔断；其他检查不能替代浏览器验证。仓库有浏览器配置时，Runner 或外层命令也须固化上述超时和熔断。

## 按需规则

仅规格变化、Decision 或用户要求整理经验时读取 `70-文档/25-按需任务规则.md`。行为保持触发见 `20-能力模块/clarify-requirements/CONTRACT.md`；普通优化/重构不自动进入严格 Preservation。
