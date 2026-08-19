---
id: clarify-requirements
version: 3
status: active
artifactKinds: [requirements, product]
---

# 需求确认 Contract

## 适用范围
新功能、行为变更、范围存在歧义、权限/数据/兼容决策和正式验收定义。

## 强制边界
- 明确问题、用户可观察结果、范围和非目标。
- 只向用户确认会改变业务、数据、权限、兼容或验收的事项。
- 已确认、合理推断和开放问题必须区分。
- 验收必须可观察、可判断，不以“代码已修改”代替。

## 默认结构
背景与问题 → 用户与结果 → 范围/非目标 → 主流程 → 异常/状态 → 数据/权限/依赖 → 验收 → 开放问题。

## 偏离
小型机械修改可以只形成一句目标和一个验收，不要求完整文档。

## 验证
核对 Goal、Non-goal、主流程、异常、权限、数据、依赖和 Acceptance 是否一致；普通内部实现细节不要求用户决定。

## 目标对齐

- 区分四类事实：用户原话（`originalRequest`，原样保留）、项目事实、已确认决定（`confirmedDecisions`）、低风险假设（`assumptions`，可被事实推翻，不是硬约束）。
- Goal 用一句话表达；Expected Outcome 必须可观察；Protected Behavior 是不得破坏的现有行为，准备时自动转为 Acceptance 并标记来源，没有 Evidence 的保护行为不能视为已保持。
- `direct`：目标清楚、Scope 局部、Acceptance 可从需求与项目事实直接形成、无项目事实冲突、无需用户实质决定；Controlled/Structural 任务禁止 direct；reasonCodes 可选，仅作内部诊断，不强求凑齐固定依据。
- `confirmed`：用户确认了 Goal、最终效果或关键方案，必须记录 `decisionNote`；`delegated`：用户明确委托，必须记录 `delegatedTopics` 与边界，不能绕过现有 Scope、外部写入与不可逆动作门禁。
- 执行中只有 Goal、Outcome、Acceptance、Scope、已确认决定或风险发生实质变化时才暂停重新对齐；普通实现变化、假设被低风险推翻不触发。
- 交付时 Controlled/Structural 或严格行为保持任务必须提供 Change Rationale，把所有 ChangeSet 文件映射到 Goal 或 Acceptance；未知文件、未知 Acceptance、空 reason 与旧指纹被机器拒绝，未映射文件不能进入等待验收。普通 Standard 任务可选提供，提供时校验，缺失不阻止交付。
- `alignment-file` / `rationale-file` / `task-check-file` 是系统与宿主模型之间的机器交换产物：由模型自动生成，存放于 OS 临时目录或明确忽略的临时目录，不要求用户手工填写，不提交到业务仓库。
- `重新对齐` 命令允许在 Codex 进度中修订目标后继续同一 Task：仅 confirmed/delegated，必须记录 decisionNote 与原因；修订号加一，清空旧 Evidence/Review/Handoff/Change Rationale 并回到 implementing；不改变 Scope、外部授权、集成目标与用户已有改动授权；已 ready_to_integrate 或结束的任务应创建新 Task。

## 行为保持

- `--intent` 保存当前有效用户请求原文；Alignment 的 `originalRequest` 必须与其一致，`重新对齐` 不得替换 initial originalRequest。
- 普通重构、优化、内部实现替换和升级默认仍为 `preserve-unrequested`，但必须主动识别与本次变更相关的 Protected Behavior，优先通过现有测试、调用方、规格和项目事实确认。
- 只有用户明确要求全部可观察行为严格保持时，才使用 `preserve-all-observable`。
- 只有用户明确指定旧实现/参考实现为行为基线时，才使用 `reference-equivalent`，旧实现是行为基线而非代码模板；Bug Fix 与 Feature 为 `preserve-unrequested`。
- 行为保持型任务必须完整查看 Reference Root：所有 tracked Reference 文件必须归入 Reference Behavior 或 excludedFiles；每个 Reference Behavior 自动成为一条 Acceptance，并需要行为 Evidence 证明。
- 未经用户批准的 `allowedDifferences` 默认是缺陷，且存在 allowedDifferences 时不得使用 direct Alignment。
- 不确定旧行为先查代码、调用方、测试、规格/Contract、Reference 与项目事实；只有无法解决且会改变业务结果时才问用户，多个问题尽量一次确认；行为等价范围内的内部实现优化无需询问。
- 具体 Acceptance 用系统执行的 `--task-check-file` 明确证明；宽泛全量 Check 不自动绑定多个 Acceptance。
