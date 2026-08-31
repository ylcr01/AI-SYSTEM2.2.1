# AI 研发操作系统 V2.3.0 入口规则

## 路由

- **普通对话**：不依赖仓库事实时直接回答，不建 Task、不运行工程脚本。
- **只读工程分析**：只读`预检`后以 `build-context.mjs --operation read` 读最小事实；仅身份、路由或依赖诊断加 `--full`。
- **仓库写任务**：任何仓库写入先预检，再用 `--operation write`（外写用 `external-write`）构建 Context。`recommended=local-direct` 只是候选；脏、占用、并发或状态不确定时进入 managed/detached Worktree，不等用户处理占用。正式 Task 仍在原子创建时复核。
- **轻量直达**：`continuity=ephemeral` 可在合格 Local/干净隔离 Worktree 做最小 Diff/定点检查；原样回传 `directBaseline` 做`复核直达`，身份/占用/Scope/风险变化即失败。回执以 baseline identity + HEAD-free semantic fingerprint 绑定最终单一本地提交，记录时原样回传；不建正式 Task/Evidence/自动集成，失败或未验证不记成功。
- **正式写任务**：Tracked、Controlled/Structural、规格/Decision、外部/跨仓写入在专属 Worktree `准备 --integration-target`，重复 `--scope` 授权精确路径；验证后默认本地提交、`交付`、`集成`。`ready_to_integrate` 仍占用，预算续期仍待集成；`waiting_acceptance` 即已交付，`accepted` 只记显式通过。
- **对话后续**：有精确 `continuation.taskId + deliveryId` 才调用`后续`；每个不同 `observationId` 的相关追问/缺陷都增加轮次。无 continuation 不猜 Task、不存正文、不跑检查。
- **结果统计**：一问题一样本；完成轮次=首次交付+追问/缺陷/退回。静默 7 天无后续计一次；按 `problemType` 分组，旧口径、问答和只读退出分母。
- **写任务对齐**：先预检，读目标代码/测试并输出目标卡；Controlled/Structural 或业务结果变更须确认/委托，根因未知先只读探索。详见 `20-能力模块/clarify-requirements/CONTRACT.md`。
- **外部/高风险写入**：默认不得 Push；Push、发布、部署、迁移、远程删除和生产数据修改须另获授权，不可逆动作还须明确停止与回滚。

## 可信边界

- 权威顺序：用户目标/授权 → 代码/配置/Manifest/Git → 已确认规格 → Contract/Canonical → 其他资料；冲突不静默选择。
- 仅在业务结果、Scope、外部影响或风险会变化时确认；实施最小充分变更。
- Acceptance 只写结果，不写命令、通用检查或全量门禁；Planner 前只写“生成并执行最小验证计划”。普通交付仅跑定点检查和缺失 Cover；全量回归须独立 Task 和明确授权。
- `package.json` 不按路径升级；元数据不升级，新增/删除、未知差异或其他字段按 build-contract 升级。
- 默认用有界 `rg`、选段、`git diff --stat/--numstat` 和进程内聚合；不加载整份 Task JSON、对话历史、成功日志或大 Diff。裁剪不得隐藏首个失败、跳过、终止、Evidence、Blocker 和新鲜度。
- 不猜项目、Scope、权限/外部授权；保留用户改动。
- 显式 Quality 的 JSON/shape/路径/文件无效时 fail closed；Context 只返回授权根内可读文件。
- Evidence 绑定 Task/ChangeSet/输入周期/Acceptance/Covers。导入仅辅证；文档/contract/visual 直接证明须有 artifact、哈希和系统来源。退回使旧证明失效；相同语义指纹（空提交不算变化）未重新对齐不得再交付。
- 自检非独立审查；`accepted` 只由用户显式产生，`closed` 只表示对话收口。
- `诊断状态` 分报 `storageIntegrity`/`acceptanceEligibility`。项目身份按 `gitCommonDir`；仅已交付样本可计验收 unknown；交付尝试与检查执行分计。
- 交付前按 ChangeSet 声明 `specImpact=none|updated|decision-required`；后两者须过规格/Decision 门禁。

## 浏览器验证硬门禁

- 普通冒烟最多 4 条核心链路，一 Check 一 flow；单条最长 15 秒，整批预算 2 分钟，外层硬超时 3 分钟且不可放宽；首个失败或超时立即停止，不自动重试，固定等待不超过 1 秒。
- 连续 30 秒无有效输出即终止、每 30 秒报告；当前同步 Runner 尚未实现，必须报告 `unimplemented`，不得伪装已执行。超过 4 条、2 分钟或全量历史用例属回归，须拆为独立任务并先获用户明确授权。
- 如实报告终止、失败、未执行和熔断；其他检查不能替代浏览器验证。Runner 或外层命令也须固化上述超时和熔断。

## 按需规则

规格/Decision/经验读 `70-文档/25-按需任务规则.md`；中央机制增删改读 `70-文档/10-架构与原则.md`、`70-文档/55-系统演进准入.md`，仅净正向进入默认路径；其余不加载。行为保持见 `20-能力模块/clarify-requirements/CONTRACT.md`，普通优化/重构不自动严格保持。
