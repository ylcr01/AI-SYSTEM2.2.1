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
- `direct`：目标清楚、Scope 局部、Acceptance 可从需求与项目事实直接形成、无项目事实冲突、无需用户实质决定；Controlled/Structural 任务禁止 direct。
- `confirmed`：用户确认了 Goal、最终效果或关键方案，必须记录 `decisionNote`；`delegated`：用户明确委托，必须记录 `delegatedTopics` 与边界，不能绕过现有 Scope、外部写入与不可逆动作门禁。
- 执行中只有 Goal、Outcome、Acceptance、Scope、已确认决定或风险发生实质变化时才暂停重新对齐；普通实现变化、假设被低风险推翻不触发。
- 交付时 Standard/Controlled 对齐任务必须提供 Change Rationale，把所有 ChangeSet 文件映射到 Goal 或 Acceptance；未知文件、未知 Acceptance、空 reason 与旧指纹被机器拒绝，未映射文件不能进入等待验收。`重新对齐` 命令仍属后续阶段，未启用前沿用现有停止/重新准备流程。
