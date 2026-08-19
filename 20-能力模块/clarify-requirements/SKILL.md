---
name: clarify-requirements
description: 澄清目标、范围、业务决定和可判断验收。
---

# clarify-requirements

先读取当前项目事实、目标代码和直接调用方。`none/local` 默认不加载 Canonical；`structural` 才读取一个主要 Contract 和最多一个 Active Canonical。工程先验是保底，不是唯一答案，模型可基于更强项目事实偏离。

## 目标卡

写任务准备前在进度中输出 3～5 行目标卡：目标、可观察最终效果、保护行为、验收、执行模式。只固定“做成什么、不破坏什么、怎样算完成”，不写详细步骤、函数清单、算法或完整设计。

## 执行模式

- `direct`：目标清楚、局部、没有会产生不同用户结果的替代解释，无需再确认。
- `confirmed`：存在实质歧义或复杂方案，先给方案与取舍，用户确认后执行，必须记录 `decisionNote`。
- `delegated`：仅当用户明确授权时使用，必须记录 `delegatedTopics` 与边界，不能绕过 Scope、外部写入、数据迁移和不可逆动作门禁。

direct 前做一次反向检查：“是否存在另一种同样合理、但会产生不同用户结果的解释？”任何一项不确定就进入 `confirmed`。只有会改变业务结果、数据、权限、兼容或验收的事项才询问用户。

## 行为保持

- 仓库写任务的 `--intent` 使用当前有效用户请求原文，不用摘要代替。
- 重构/迁移/移植/重写/升级/优化默认保持未请求改变的可观察行为；明确参照旧实现时，旧实现是行为基线而不是代码模板。
- Preservation Task 必须完整查看 Reference Root，所有 tracked Reference 文件归入 Behavior 或 excludedFiles；每个 Reference Behavior 成为一条 Acceptance。
- 行为等价范围内，内部实现、命名、算法、数据结构与测试组织可以自主优化，无需询问；业务结果、用户交互、状态、权限、数据、异常/拒绝路径、外部 Contract 与兼容行为不得未经批准改变。
- 不确定旧行为先查事实；只有无法解决且会改变业务结果时才问用户，多个问题尽量一次确认。
- 具体 Acceptance 用系统执行的 `--task-check-file` 明确证明；宽泛全量 Check 不自动绑定多个 Acceptance。
