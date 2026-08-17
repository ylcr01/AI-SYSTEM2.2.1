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
