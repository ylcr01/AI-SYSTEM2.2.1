---
id: DEC-SELECTIVE-AGENT-SKILLS-ADOPTION-001
status: accepted
affects:
  - ARCH-PROBLEM-DRIVEN-EVOLUTION
  - ARCH-CORE-SLIMMING
sourceTaskId: task-20260901011054511-371165d0
adoptedByTaskId: task-20260901033909373-93fab8fd
supersedes: []
---

# 只按明确净正向选择性吸收外部 Agent Skills 设计

## 背景与证据边界

本决定评估 [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills) 在 `2026-09-01` 的 `main@d2c37ef6225dd8726cdd369a8030307f48592d26`，重点包括 Scope Discipline、Incremental Implementation、Cost-aware Verification、Context Engineering、Anti-rationalization、When NOT to Use、Fresh-context Review、Source-driven Development、Constraint Ratchet 和 Code Simplification。

外部仓库的 Skill、命令、评测和文档证明这些设计已经被具体表达和技术检查，但没有提供与 AI-SYSTEM 当前版本、项目、模型和完成轮次口径可比的真实任务结果。本系统当前新版可比样本也不足以支撑长期因果结论。因此本决定只确认选择标准和当前边界，不宣称任何尚未接入的外部机制已经改善交付。

## 当前决定

不照搬外部 Skill Pack、生命周期命令或默认门禁。当前只正式采纳窄触发 Source-driven、条件式 Constraint Weakening Detection，以及新增机制治理中的 When NOT to Apply；三者分别独立实施和验证。Anti-rationalization 与 Code Simplification 只允许在后续维护现有 Quality Pass 时以等长或更短文字替换重复表述，Incremental 与 Fresh-context Review 保持受控试验候选。

| 候选 | 决定 | 明确净正向部分 | 不吸收的重实现 |
|---|---|---|---|
| Scope Discipline | `keep` | 现有精确路径、ChangeSet 和用户改动隔离已经机器执行；继续保留 Goal-fit 和最小 ChangeSet 自检 | 不新增 Scope 阶段、清单、状态或每 Slice 审批；语义理由只作为 Anti-rationalization 的精简候选 |
| Cost-aware Verification | `keep` | 现有 Planner 已按 Acceptance、缺失 Cover、成本、超时和同批执行身份选择、排序与复用检查，已经覆盖“成本决定检查位置”和“相同执行不重复” | 不采用每 Slice 全量 test/build，也不建立第二套验证流程 |
| Context Engineering | `keep` | 保留最小读取计划、授权根、Profile/Canonical 上限、指纹和未变化抑制；Source-driven 获取的外部资料沿用现有权威顺序并作为不可信 transient data | 不新增全局 Project Map、Brain Dump、常驻 MCP 或整份规格加载 |
| Incremental Implementation | `experiment` | 只在多文件、高耦合、根因仍在收敛且能冻结对照时试验“一个可验证逻辑结果”切片，并统计返工、检查次数和总耗时 | 当前不实现 Slice 状态机、不强制每片 commit、不按文件数触发、不跑每片全量套件 |
| When NOT to Apply | `adopted` | 已写入中央新增机制评估的“适用与不适用边界”；对容易误触发的 Profile/Contract，用更短的不适用条件替换模糊触发文字，只在该资料被加载时产生 Token 成本 | 不要求所有 Contract 机械增加同名章节，不把显而易见任务写成长流程 |
| Anti-rationalization | `shrink / observe` | 后续维护现有 Quality Pass/Profile 时，最多用 3 个与已观察失败面相关的理由→反证替换抽象或重复文字，并保持默认 Token 持平或下降 | 当前不创建独立 Skill、不新增默认文字，不用负向提示替代读代码和比较方案 |
| Code Simplification Heuristics | `shrink / observe` | 后续维护现有 Quality Pass 时，可用“单调用者抽象、无语义透传 wrapper、为未来需求设计、不了解职责不删除”替换现有重复判断 | 当前不新增 Simplify 阶段、独立状态或第二轮全量验证，不以 LOC 下降代表质量 |
| Source-driven Development | `adopted`（第一个独立实施变量） | 遇到框架、SDK、数据库驱动、CLI 参数或 migration 的版本相关行为时，先从 Manifest/锁文件确认实际版本，再读取对应官方页面；找不到权威依据时标记 `UNVERIFIED`。这是对训练记忆过期这一明确事实缺口的直接修复 | 不对纯逻辑、重命名或版本无关代码查资料，不把整站文档放进 Context，不要求每行框架代码都加引用 |
| Fresh-context Adversarial Review | `experiment` | 只有已有任务显式要求 independent Review 且能记录 Finding、误报、调用和等待成本时，才试验最小 Artifact + Contract 的 adversarial 首轮 | 当前不扩大 Review 触发率、不新增状态机、不在每轮询问 cross-model review、不让子 Reviewer 再派 Reviewer |
| Constraint Weakening Detection | `adopted`（条件信号） | ChangeSet 涉及检查配置、测试或 suppression 时，显式检查新增 skip/ignore、删除测试或 assertion、降低阈值、移除检查；合法变化必须说明原因，不能把降低标准当修复 | 不把所有文本匹配直接设为阻塞，不为每个项目发明统一阈值 |
| Baseline Ratchet | `observe / project-local` | 只有项目已有确定性度量、可信当前基线、明确容差和回滚时，才另行评估 must-not-decrease 试验 | 当前不中央默认 coverage/performance 数字，不跨项目共享基线，不让噪声指标锁死交付 |

这里的 `adopted` 只采纳表中“明确净正向部分”，并要求 Source-driven 与 Constraint Weakening 分成不同 Task、不同提交和不同系统版本实施；它不授权复制外部 Skill 全文。`keep` 表示现有能力已经满足目标；`shrink / observe` 只有替换、不增加默认成本时才可进入现有机制；`experiment` 和 `observe / project-local` 不进入中央默认路径。长期完成轮次和返工影响仍按 [`../55-系统演进准入.md`](../55-系统演进准入.md) 继续观察，若负向成本出现则收缩或删除。

## 为什么最小融入而不照搬

- AI-SYSTEM 的目标是以更低总成本正确交付真实用户目标，不是覆盖完整软件生命周期或拥有更多 Skill。
- Scope、验证和 Context 三个重点问题已有更强的机器执行路径，因此只补语义 Scope 和外部资料信任边界，不复制平行机制。
- Source-driven 和 Constraint Weakening 分别封闭版本事实与降低标准过门禁的具体缺口；When NOT 已作为治理边界写入，不需要运行时。三者的触发和结果都能直接核验，因此进入最小采纳。
- Incremental 和 Fresh Review 同时可能增加检查、调用、等待与流程成本，必须先试验；Anti-rationalization 与 Simplification 已与现有 Quality Pass 重叠，只允许以后等价替换；Ratchet 依赖项目指标稳定性，保持项目级观察。
- 一次性引入多个机制会同时改变 Context、模型行为、调用和验证成本，后续无法归因哪一项产生收益。
- 现有真实任务计划已经提供 6 对、12 个任务的受控比较入口；证据出现后应一次只冻结一个候选变量。

## 核心诉求影响

| 维度 | 本决定的直接影响 | 证据状态 |
|---|---|---|
| 模型能力 | 不用外部固定流程替代强模型的合理切片、验证和方案判断 | 文档边界可直接核验，长期影响未知 |
| 准确 | 增加版本敏感官方来源、语义 Scope 和降低质量标准信号，补当前可定位缺口 | 机制选择可核验，长期任务结果待观察 |
| 质量 | 防止测试、assertion、suppression 或阈值被静默改弱；其他质量候选不提前进入默认路径 | 机制边界可核验，长期行为收益待观察 |
| 效率 | 不新增默认 Agent 调用、阶段、Slice、Simplify 或全量检查，只增加窄触发资料获取和条件信号 | 本 Decision 边界可直接核验 |
| 优雅 | 候选优先进入已有 Quality Pass、Context、Review 或项目配置，避免平行机制 | 本 ChangeSet 可直接核验 |
| 清晰 | 每个候选明确写出吸收的最小部分与拒绝的重实现 | 本 ChangeSet 可直接核验 |

本决定正式采纳“选择性吸收、默认不新增”，并确认 Source-driven、Constraint Weakening 与 When NOT 的最小形态进入后续独立实现；其他候选保持精简、观察或试验，不能由此宣称外部 Skill 全文或长期任务结果已经被证明有效。

## 晋升、停止与回滚

- 候选需按 [`../60-真实任务验证计划.md`](../60-真实任务验证计划.md) 冻结系统版本、模型、项目、任务类型和结果口径；中央机制通常还需至少 3 个真实任务、2 个项目中的重复问题。
- 受控试验一次只改变一个候选机制，比较完成轮次、返工、遗漏/Regression、Context 与验证耗时、额外调用和状态债务。
- 若试验增加默认 Context、检查执行、Agent 调用、等待、误报或用户交互，而没有改善真实结果，立即停止并删除候选实现。
- 若机制压制模型读取真实代码、比较方案或处理简单任务，缩小触发范围；仍无独立收益时移除。
- 回滚本决定时可删除本文件及两份权威文档中的新增准入表述，但不得借回滚把任何未经验证的候选直接加入默认路径；已有 Scope、验证和 Context 真实性保护继续保留。
