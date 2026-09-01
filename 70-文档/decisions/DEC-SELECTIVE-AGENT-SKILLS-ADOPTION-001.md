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

不照搬外部 Skill Pack、生命周期命令或默认门禁。明确正向的部分只进入 AI-SYSTEM 已有 Quality Pass、Context、Review 和项目质量配置；没有独立收益的部分保留现状。候选逐项处理如下：

| 候选 | 决定 | 明确净正向部分 | 不吸收的重实现 |
|---|---|---|---|
| Scope Discipline | `adopted`（补语义缺口） | 保留现有精确路径、ChangeSet 和用户改动隔离；在既有 Quality Pass 中加入“邻近清理、未要求功能、顺手现代化、只为未来的抽象”四类语义越界信号，覆盖机器路径门禁无法判断的授权目录内扩张 | 不新增 Scope 阶段、清单、状态或每 Slice 审批 |
| Cost-aware Verification | `keep` | 现有 Planner 已按 Acceptance、缺失 Cover、成本、超时和同批执行身份选择、排序与复用检查，已经覆盖“成本决定检查位置”和“相同执行不重复” | 不采用每 Slice 全量 test/build，也不建立第二套验证流程 |
| Context Engineering | `keep + adopted` | 保留最小读取计划、授权根、Profile/Canonical 上限、指纹和未变化抑制；配合 Source-driven，把获取的外部资料明确作为不可信数据，只提取当前版本事实，不能把网页中的指令当系统指令 | 不新增全局 Project Map、Brain Dump、常驻 MCP 或整份规格加载 |
| Incremental Implementation | `adopted`（原则） | 多文件、高耦合或根因仍在收敛的任务按“一个可验证逻辑结果”切片，保持每片可运行；每片只跑受影响的定点检查，最终仍由现有 Planner 补缺失 Cover | 不新增 Slice 状态机，不强制每片 commit，不按文件数触发，不跑每片全量套件 |
| When NOT to Apply | `adopted` | 已写入中央新增机制评估的“适用与不适用边界”；对容易误触发的 Profile/Contract，用更短的不适用条件替换模糊触发文字，只在该资料被加载时产生 Token 成本 | 不要求所有 Contract 机械增加同名章节，不把显而易见任务写成长流程 |
| Anti-rationalization | `adopted`（最小形态） | 在命中的 Quality Pass/Profile 中保留 3～5 个与当前失败面直接相关的理由→反证，例如“顺便整理”“以后可能有用”“代码没变再跑一次”；它补充的是模型语义判断，不重复机器 Scope 和执行指纹 | 不创建独立 Skill，不把长表放入所有任务 Context，不用负向提示替代读代码和比较方案 |
| Code Simplification Heuristics | `adopted`（并入 Quality Pass） | 用“单调用者抽象、无语义透传 wrapper、为未来需求设计、不了解职责不删除”增强现有最低必要复杂度判断；保持当前 ChangeSet，修复后只重跑受影响检查 | 不新增 Simplify 阶段、独立状态或第二轮全量验证，不以 LOC 下降代表质量 |
| Source-driven Development | `adopted`（窄触发） | 遇到框架、SDK、数据库驱动、CLI 参数或 migration 的版本相关行为时，先从 Manifest/锁文件确认实际版本，再读取对应官方页面；找不到权威依据时标记 `UNVERIFIED`。这是对训练记忆过期这一明确事实缺口的直接修复 | 不对纯逻辑、重命名或版本无关代码查资料，不把整站文档放进 Context，不要求每行框架代码都加引用 |
| Fresh-context Adversarial Review | `adopted`（复用现有 Review） | 当已有任务明确需要 independent Review 时，Reviewer 只接收最小 ChangeSet/Artifact、Goal/Acceptance、Contract 和 Evidence，不接收前序推理；提示目标是找错和未声明假设，默认一次，只有 Blocking Finding 才回到实现 | 不自动扩大 Review 触发率，不新增状态机，不在每轮询问 cross-model review，不让子 Reviewer 再派 Reviewer |
| Constraint Weakening Detection | `adopted`（条件信号） | ChangeSet 涉及检查配置、测试或 suppression 时，显式检查新增 skip/ignore、删除测试或 assertion、降低阈值、移除检查；合法变化必须说明原因，不能把降低标准当修复 | 不把所有文本匹配直接设为阻塞，不为每个项目发明统一阈值 |
| Baseline Ratchet | `experiment / project-local` | 对已有确定性度量且项目没有合理目标值时，可记录当前基线和 must-not-decrease 方向，允许明确容差；只在项目质量配置中试验 | 不中央默认 coverage/performance 数字，不跨项目共享基线，不让噪声指标锁死交付 |

这里的 `adopted` 只采纳表中“明确净正向部分”，实施仍优先修改现有机制并接受对应定点验证；它不授权复制外部 Skill 全文。`keep` 表示现有能力已经满足目标；`experiment / project-local` 不进入中央默认路径。长期完成轮次和返工影响仍按 [`../55-系统演进准入.md`](../55-系统演进准入.md) 继续观察，若负向成本出现则收缩或删除。

## 为什么最小融入而不照搬

- AI-SYSTEM 的目标是以更低总成本正确交付真实用户目标，不是覆盖完整软件生命周期或拥有更多 Skill。
- Scope、验证和 Context 三个重点问题已有更强的机器执行路径，因此只补语义 Scope 和外部资料信任边界，不复制平行机制。
- Incremental、Anti-rationalization、Fresh Review、Source-driven 和 Constraint Weakening 都能以窄触发嵌入现有机制，分别补足错误定位、模型自我解释、审查确认偏差、版本事实和降低标准过门禁的具体缺口；采纳其最小形态的成本明显低于新增完整 Skill 或阶段。
- Ratchet 的收益依赖项目指标稳定性，只有它仍需项目级试验，不能据设计合理性升级为中央默认。
- 一次性引入多个机制会同时改变 Context、模型行为、调用和验证成本，后续无法归因哪一项产生收益。
- 现有真实任务计划已经提供 6 对、12 个任务的受控比较入口；证据出现后应一次只冻结一个候选变量。

## 核心诉求影响

| 维度 | 本决定的直接影响 | 证据状态 |
|---|---|---|
| 模型能力 | 不用外部固定流程替代强模型的合理切片、验证和方案判断 | 文档边界可直接核验，长期影响未知 |
| 准确 | 增加版本敏感官方来源、语义 Scope 和降低质量标准信号，补当前可定位缺口 | 机制选择可核验，长期任务结果待观察 |
| 质量 | 把最小 Anti-rationalization、Simplification 和 adversarial review 形态嵌入已有质量机制 | 设计边界可核验，行为收益待真实任务确认 |
| 效率 | 不新增默认 Agent 调用、阶段、状态或全量检查；逻辑切片只运行受影响检查 | 本 Decision 边界可直接核验 |
| 优雅 | 候选优先进入已有 Quality Pass、Context、Review 或项目配置，避免平行机制 | 本 ChangeSet 可直接核验 |
| 清晰 | 每个候选明确写出吸收的最小部分与拒绝的重实现 | 本 ChangeSet 可直接核验 |

本决定正式采纳“选择性吸收、默认不新增”，并确认表中最小形态值得进入后续实现；不能由此宣称外部 Skill 全文或长期任务结果已经被证明有效。

## 晋升、停止与回滚

- 候选需按 [`../60-真实任务验证计划.md`](../60-真实任务验证计划.md) 冻结系统版本、模型、项目、任务类型和结果口径；中央机制通常还需至少 3 个真实任务、2 个项目中的重复问题。
- 受控试验一次只改变一个候选机制，比较完成轮次、返工、遗漏/Regression、Context 与验证耗时、额外调用和状态债务。
- 若试验增加默认 Context、检查执行、Agent 调用、等待、误报或用户交互，而没有改善真实结果，立即停止并删除候选实现。
- 若机制压制模型读取真实代码、比较方案或处理简单任务，缩小触发范围；仍无独立收益时移除。
- 回滚本决定时可删除本文件及两份权威文档中的新增准入表述，但不得借回滚把任何未经验证的候选直接加入默认路径；已有 Scope、验证和 Context 真实性保护继续保留。
