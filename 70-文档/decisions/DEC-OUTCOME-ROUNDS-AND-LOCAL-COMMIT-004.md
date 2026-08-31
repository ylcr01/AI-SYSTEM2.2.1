---
id: DEC-OUTCOME-ROUNDS-AND-LOCAL-COMMIT-004
status: accepted
affects:
  - ARCH-AGENT-INTEGRATION
  - BR-AIRD-ROUTE-001
  - BR-AIRD-STATE-002
  - BR-AIRD-METRICS-001
  - BR-AIRD-COMMIT-001
sourceTaskId: task-20260831023746343-4560f136
supersedes:
  - DEC-RISK-PROPORTIONAL-WRITE-ROUTING-003
---

# 以完成轮次替代形式验收，并默认形成本地提交

## 背景

现有实现把用户显式“通过”作为首轮验收率的决定事件，但正常交付后用户通常不会再执行一次没有业务增量的确认。变更前的当前月摘要有 9 条已跟踪记录、0 条明确验收结论，决定覆盖率为 0；该指标无法承担稳定性判断。同时，`deliveryAttemptCount` 会把验证失败、重新交付和集成前尝试混在一起，不能代表用户感知的“一次、二次、三次完成”。

轻量直达又刻意不创建正式 Task，因此没有最小结果事实；修改验证完成后是否本地提交依赖下一次用户指令，增加无意义往返。用户明确要求从新版口径重新开始、减少形式确认、按完成轮次和问题类型评估，并在验证后默认本地提交但绝不自动 Push。

## 决定

- 收缩显式验收的默认地位：有效 `waiting_acceptance` 已是本轮工程交付，不再要求用户追加“通过”确认。`accepted` 能力保留，只记录用户主动表达的强事实。
- 启用 `completion-rounds-v1` 试验口径：一个问题始终是一个样本；轮次等于首次有效交付加相关询问、缺陷返回或显式退回次数。多轮沟通不会拆成多条成功记录。
- 明确肯定、范围扩展或话题推进立即收口；没有后续的交付先观察，默认静默 7 天后才计为一次完成。观察中样本不进入轮次分母。
- 新记录自动标记 `problemType`，摘要可按类型筛选。旧测量版本、普通问答、纯只读分析、未知类型和显式排除项不进入新版默认分母；旧 Task 与历史账本只保留，不物理删除或改写。
- 正式 Task 继续使用现有 Worktree、Scope、Evidence、结果提交和集成门禁。轻量直达验证通过后默认形成只包含本次 Scope 的本地提交，再向 append-only 结果事件账本记录最小交付与 continuation；它不是第二套正式 Task 状态机。
- 任何仓库写路径都不得自动 Push。Push、发布、部署和其他外部写入继续需要用户对动作与目标的明确授权。

## 核心诉求影响卡

```yaml
problem:
  statement: 形式验收覆盖率为零，旧交付次数不能表达用户感知完成轮次，轻量修改缺少结果记录且本地提交需要重复指令
  evidence: 当前月摘要显示 tracked=9、explicit decided=0；用户明确反馈确认和再次提交没有业务增量
  versions: AI-SYSTEM V2.3.0 / 变更前提交 8b2fdeb
  scope: 中央交付、对话后续、结果统计和本地提交默认行为

change:
  kind: shrink + modify
  mechanism: 显式验收默认路径、完成指标、轻量结果账本、本地提交规则
  minimalApproach: 保留现有正式 Task 状态机，新增测量版本和 append-only 轻量事实，不迁移旧账本
  alternatives: 强制每次用户确认会继续增加往返；让所有轻量任务创建正式 Task 会恢复已删除的固定控制面成本

coreImpact:
  modelCapability: preserve
  accuracy: improve
  quality: preserve
  efficiency: improve
  elegance: improve
  clarity: improve

evaluation:
  expectedBenefit: 一次/二次/三次及以上完成占比可用；用户少一次形式确认和一次提交指令；轻量任务进入可比较结果样本
  negativeCost: 新增问题类型推断、7 天观察口径和轻量 append-only 账本的维护成本
  evidenceStatus: directional
  counterEvidence: 尚无 20～30 条新版可比任务；静默窗口和自动分类可能产生边界误差；本次定点测试不能证明长期净收益
  decision: experiment
  promotionCondition: 至少 20 条、建议 30 条新版可比完成样本，按问题类型复核轮次分布、分类准确性、提交混入率和额外耗时，且无 Scope/用户改动损坏
  stopCondition: 出现自动提交用户既有改动、误触 Push、同一问题被重复计样本，或轮次关联连续失真
  rollback: 停止生成新版测量记录和轻量账本，恢复显式验收辅助报告；保留既有事件供审计，不删除历史
```

## 未改变

不弱化 Goal、Scope、用户已有改动、Evidence、Review、规格一致性、Worktree 隔离、目标 HEAD 新鲜度和高风险集成暂停。失败、跳过、终止和未验证必须如实报告；技术自检不能冒充用户显式验收或长期结果证据。

## 验证

定点测试覆盖新旧测量版本隔离、问题类型过滤、静默窗口、一次到多次完成分布、多个幂等相关 observation、缺陷退回后沿用同一样本、本地提交与干净工作树约束，以及 Push 仍不在任何自动路径。完成实现只证明当前 Acceptance，不把本次测试描述为机制已经产生稳定净收益。
