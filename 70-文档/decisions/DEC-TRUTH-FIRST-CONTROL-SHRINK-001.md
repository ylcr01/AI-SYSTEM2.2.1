---
id: DEC-TRUTH-FIRST-CONTROL-SHRINK-001
status: accepted
affects:
  - MOD-AIRD-QUALITY-STATE
  - ARCH-PROBLEM-DRIVEN-EVOLUTION
sourceTaskId: task-20260831041548215-6b53d57a
supersedes: []
---

# 以真实性修复收缩中央控制面

## 背景

当前系统的主要风险不是缺少流程，而是少数中央机制在边界上产生了错误事实：只读意图可被写入风险词触发正式 Task，`local-direct` 只在实施前判定，无效 Quality 配置可被忽略，导入结果或无产物身份的检查可被误当直接证明，待集成任务可提前释放占用，退回后旧证明可沿用，而评估指标会把 Worktree 当不同项目或把未交付样本当成验收未知。

这些失真会同时增加流程成本和错误信心。因此本轮不新建第二套控制平台，而是在现有 Context、Task、Evidence、Worktree 和指标内核中修正真实性边界。

## 决定

- 上下文分类显式接受 `operation=read|write|external-write`。`read` 只保留内容风险与结构判断，执行路由始终为只读；`external-write` 强制进入正式高风险路由。计划 Scope/路径参与实施前路由，真实 ChangeSet 在交付前复核。
- `local-direct` 只是实施前候选；同一无状态路径也可用于干净、已隔离的 `current-worktree`。预检返回完整 `directBaseline`：HEAD、branch 或 detached 标识、`gitRoot` 和 `gitCommonDir`。轻量写入后必须原样回传这套身份，终检同时重验当前占用、精确 Scope、Manifest 真实差异和最终风险；终检生成的不含 HEAD 的语义变更指纹必须与随后形成的单父本地提交一致，防止“验证 A、记录 B”。即使提交/分支相同，其他 clone、路径身份变化或切换分支也必须失败关闭。
- 显式存在但无效、越界、指向目录或引用不受支持的 Quality 配置失败关闭；不再回退为“没有配置”。仅实际可读且在授权根内的文件可进入 Context。
- 导入的外部结果只是辅证，不直接闭合 Acceptance。`documentation|contract|visual` 的直接证明必须同时绑定 Git Root 内的 artifact、当前内容哈希和系统执行来源；否则降级为辅证或失败。
- Browser 用例固化为一个 Check 一条 flow，最多 4 条、单条 15 秒、整批 120 秒、含前置检查的外层 180 秒，首个失败或超时立即熔断并如实报告未执行数。当前同步 Runner 尚不能在子进程运行期间实现 30 秒心跳和无有效输出终止；必须将此缺口结构化报告为 `unimplemented`，不得声称已执行。
- `ready_to_integrate` 仍是写作占用态。用户退回或对话缺陷退回先持久化并清空旧 Evidence、Review、Handoff、Rationale 和 Check Manifest，提升输入周期；已集成任务安全恢复专属返工 Worktree，失败时保留 blocked 事实与诊断。同一内容语义指纹且未重新对齐时不得再交付，空提交不算输入变化。集成验证预算耗尽后仍保持待集成，有界续期只恢复集成资格，不转成已交付或返工。
- `诊断状态` 分开返回 `storageIntegrity` 和 `acceptanceEligibility`，轻量结果事件账本也属于存储完整性范围；存储完整不等于当前待验收 Task 仍满足门禁。
- 评估按 `gitCommonDir` 识别逻辑项目，只将已进入可验收交付的样本计入验收 `unknown`。Task 保存当时系统版本/Commit/脏状态、Runtime 和宿主显式传入的模型、推理强度、执行环境；交付尝试与真实检查执行次数/耗时、阶段耗时分开统计。

## 影响与边界

本轮预期减少误路由、无效 Context、错误证明、并发占用失真和指标污染，不增加新 Task 类型、审批流或持久化平台。代价是轻量直达增加一次无状态终检，无效 Quality 配置将更早暴露，退回后必须产生新输入事实。

正确性与技术定点测试只能证明本 ChangeSet 可交付。本机制的长期净收益仍为 `unknown`，不因 Decision 已接受或测试通过而改写为已验证优势。

已知边界：集成退回后如果正式重新对齐使目标分支现状已经满足新目标且 ChangeSet 为空，当前流程仍要求新的 `resultCommit`；本轮不引入空 Diff 快速通道。

## 验证与晋升

- 本 ChangeSet 定点测试覆盖 operation 路由、直达终检、Quality 失败关闭、Evidence/artifact 身份、Browser 硬限制和缺口报告、Task 状态/退回/预算续期、诊断和指标。
- 按 `../60-真实任务验证计划.md` 先完成 12 个受控可比任务，再累计 20～30 个真实交付样本；对比首轮验收、返工/遗漏、错路由、上下文成本、验证执行耗时和状态债务。
- 只有硬约束未退化且可比样本显示至少一项核心结果改善时，才可将结论从 `experiment/observe` 提升为 `keep`。

## 停止与回滚

如果终检频繁误拦截合法轻量修改、Quality 失败关闭导致无法定位的普遍阻塞、证据收紧造成已验证结果大量误拒，或状态/指标调整产生数据丢失，立即停止扩大默认路径，回滚对应实现或缩小触发范围。回滚不得恢复已证明的错误事实，也不得用新增检查、重试或状态掩盖根因。
