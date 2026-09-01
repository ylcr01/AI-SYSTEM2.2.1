---
id: DEC-SELECTIVE-AGENT-SKILLS-ADOPTION-001
status: accepted
affects:
  - ARCH-PROBLEM-DRIVEN-EVOLUTION
  - ARCH-CORE-SLIMMING
sourceTaskId: task-20260901011054511-371165d0
supersedes: []
---

# 只按明确净正向选择性吸收外部 Agent Skills 设计

## 背景与证据边界

本决定评估 [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills) 在 `2026-09-01` 的 `main@d2c37ef6225dd8726cdd369a8030307f48592d26`，重点包括 Scope Discipline、Incremental Implementation、Cost-aware Verification、Context Engineering、Anti-rationalization、When NOT to Use、Fresh-context Review、Source-driven Development、Constraint Ratchet 和 Code Simplification。

外部仓库的 Skill、命令、评测和文档证明这些设计已经被具体表达和技术检查，但没有提供与 AI-SYSTEM 当前版本、项目、模型和完成轮次口径可比的真实任务结果。本系统当前新版可比样本也不足以支撑长期因果结论。因此本决定只确认选择标准和当前边界，不宣称任何尚未接入的外部机制已经改善交付。

## 当前决定

本轮不新增运行时、状态机、默认 Skill、Context Source、Review 调用、检查类型、Ratchet 配置、Slice 流程或验证阶段。候选逐项处理如下：

| 候选 | 决定 | 当前原因 | 何时重新评估 |
|---|---|---|---|
| Scope Discipline | `keep` | 现有精确 Scope、真实路径、ChangeSet 和用户改动隔离已经机器执行；复制外部文字流程没有独立收益 | 若授权目录内反复出现机器路径门禁无法发现的语义 Scope 扩张，先用项目局部 Contract 处理 |
| Cost-aware Verification | `keep` | 现有 Planner 已按 Acceptance、缺失 Cover、成本、超时和同批执行身份选择与复用检查；每 Slice 全量 test/build 会增加重复验证 | 只有验证遗漏或重复执行在可比任务中再次出现，才修正现有 Planner，不建立平行验证流程 |
| Context Engineering | `keep` | 已有最小读取计划、授权根、Profile/Canonical 上限、内容指纹和未变化抑制；再引入上下文层会重复 | 若真实任务持续遗漏权威文件或产生 context flooding，优先修正现有路由与上限 |
| Incremental Implementation | `observe` | 小逻辑切片有设计价值，但强制 Slice 状态、逐 Slice 全量验证或提交会压制模型判断并增加成本 | 仅当多文件任务反复因一次性大改产生返工或 Regression，且现有 Goal/Scope/Quality Pass 不能解决时设计最小试验 |
| When NOT to Apply | `observe` | 明确不适用范围可能减少误触发，但给所有 Contract 统一加段落会增加默认文本，当前没有 Profile 误触发结果证据 | 某一 Profile 出现重复误触发时，用更短的不适用条件替换其现有模糊描述，不建立全局模板负担 |
| Anti-rationalization | `observe` | 能针对模型自我解释，但也会增加 Token、负向提示和机械服从风险；当前没有可归因的重复样本 | 同类“顺手扩 Scope、未来抽象、无变化重试”等理由在至少 3 个任务、2 个项目重复后，在命中的 Profile 内以等长或更短文字试验 |
| Code Simplification Heuristics | `shrink` | “单调用者抽象、透传 wrapper、未来复杂度”等判断与现有 Quality Pass 重叠，独立 Simplify 阶段只会重复实现和验证 | 后续维护现有 Quality Pass 时只允许等价替换或删重；不得新增阶段、状态或独立复验 |
| Source-driven Development | `observe` | 版本敏感官方资料可能提升准确性，但会增加网络、来源判断和上下文成本，当前缺少本系统中的版本记忆错误样本 | 框架、SDK、数据库驱动或 CLI 版本行为在真实任务中重复造成错误后，先以单项目 transient Context 试验；文档仍是上下文而非行为 Evidence |
| Fresh-context Adversarial Review | `observe` | 独立上下文可能发现自我确认错误，但需要额外 Agent 能力、调用、等待和协调；自检不能冒充独立 Review | 高风险非机器可证明主张重复逃逸现有 Review，或发生单个安全/数据完整性事件时，限定一次 Review、复用现有 Review Package 试验 |
| Constraint Weakening Detection / Ratchet | `observe` | 可发现 suppression、skip、阈值降低，但不同项目的质量配置和噪声指标差异大，容易误报、锁死或诱发指标博弈 | 真实项目发生降低标准以过门禁时先做项目级检查；只有确定性指标、可信基线、容差和回滚明确时才试验 Ratchet |

`keep` 表示保留 AI-SYSTEM 已有能力，不复制外部实现；`shrink` 只允许在现有机制内替换或删除重复内容；`observe` 表示当前不写入系统。上述重新评估条件只允许产生候选或受控试验，仍须通过 [`../55-系统演进准入.md`](../55-系统演进准入.md)，不能自动晋升中央默认路径。

## 为什么当前不直接融入

- AI-SYSTEM 的目标是以更低总成本正确交付真实用户目标，不是覆盖完整软件生命周期或拥有更多 Skill。
- Scope、验证和 Context 三个重点问题已有更强的机器执行路径，重复吸收会增加维护与上下文成本而没有独立保护。
- Incremental、Anti-rationalization、Fresh Review、Source-driven 和 Ratchet 的收益依赖任务类型、宿主能力和项目基线，当前只有设计推理，没有本系统的可比结果。
- 一次性引入多个机制会同时改变 Context、模型行为、调用和验证成本，后续无法归因哪一项产生收益。
- 现有真实任务计划已经提供 6 对、12 个任务的受控比较入口；证据出现后应一次只冻结一个候选变量。

## 核心诉求影响

| 维度 | 本决定的直接影响 | 证据状态 |
|---|---|---|
| 模型能力 | 不用外部固定流程替代强模型的合理切片、验证和方案判断 | 文档边界可直接核验，长期影响未知 |
| 准确 | 保留现有 Scope、Acceptance/Evidence 和 Context 真实性保护 | 已实现能力，非本决定新增收益 |
| 质量 | 防止“方法更成熟”被误写为已改善真实交付 | 规则表达可直接核验 |
| 效率 | 当前不新增 Agent 调用、检查、阶段、默认 Context 和状态 | 本 ChangeSet 可直接核验 |
| 优雅 | 候选优先映射为 keep、shrink、项目局部或观察，避免平行机制 | 本 ChangeSet 可直接核验 |
| 清晰 | 每个候选给出当前决定、原因和重新评估条件 | 本 ChangeSet 可直接核验 |

本决定正式采纳“选择性吸收、默认不新增”的边界；外部候选本身的长期净收益仍为 `unknown`。

## 晋升、停止与回滚

- 候选需按 [`../60-真实任务验证计划.md`](../60-真实任务验证计划.md) 冻结系统版本、模型、项目、任务类型和结果口径；中央机制通常还需至少 3 个真实任务、2 个项目中的重复问题。
- 受控试验一次只改变一个候选机制，比较完成轮次、返工、遗漏/Regression、Context 与验证耗时、额外调用和状态债务。
- 若试验增加默认 Context、检查执行、Agent 调用、等待、误报或用户交互，而没有改善真实结果，立即停止并删除候选实现。
- 若机制压制模型读取真实代码、比较方案或处理简单任务，缩小触发范围；仍无独立收益时移除。
- 回滚本决定时可删除本文件及两份权威文档中的新增准入表述，但不得借回滚把任何未经验证的候选直接加入默认路径；已有 Scope、验证和 Context 真实性保护继续保留。
