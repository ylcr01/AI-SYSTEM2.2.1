---
id: clarify-requirements
version: 4
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

## 默认结构：Goal Card First

默认先用 Goal Card 对齐目标：`originalRequest` → 一句 Goal → 1~4 条可观察 Expected Outcome → 与变更邻近的 Protected Behavior → 可判断 Acceptance → 仅在易膨胀时写 Non-goal → 低风险 Assumptions。

只有复杂 Product / Requirement 任务才展开完整结构：

```text
背景与问题 → 用户与结果 → 范围/非目标 → 主流程 → 异常/状态 → 数据/权限/依赖 → 验收 → 开放问题
```

## 偏离

Quick 或单一可观察结果的局部任务不需要 Goal Card 文件；小型机械修改只形成一句目标和一个验收，不要求完整文档。

## Goal Card 生成协议

1. `originalRequest` 原样保存用户原话。
2. Goal 一句话表达用户最终想改变的结果，不写“修改 xx 文件 / 增加 xx 函数”。
3. Expected Outcomes 写 1~4 条用户可观察或工程可验证的结果。
4. Protected Behaviors 只加入与本次变更邻近、确实可能被破坏的行为，来源优先：用户明确要求 > 现有测试 > 直接调用方 > 项目事实 > Spec/Contract，禁止凭空发明。
5. 每条 Acceptance 必须可判断、可验证、与 Goal 直接相关；不写“代码优雅 / 质量高 / 性能好”等不可判定句，代码质量由质量基线处理。
6. Acceptance 只描述目标结果，不写测试命令、检查名称、静态完整性或“系统全量门禁通过”；只有用户目标本身就是验证工具或发布门禁时，检查结果才可作为 Outcome。验证方法记录在 Task Check / Check Manifest，不得覆盖 Goal Card 的结果语义。
7. Non-goals 只有容易发生 Scope 膨胀时才写。
8. Assumptions 只允许低风险、可逆、不改变业务语义的假设。
9. 只有存在两种以上合理解释，且会改变最终业务结果、数据、权限、兼容、Scope 或外部影响时才问用户，其他情况模型自行处理。

### Goal Card 的严格 Preservation 扩展

基础 Goal Card 保持轻量，不放入 preservation；只有用户明确要求全部可观察行为保持（`preserve-all-observable`）或以旧实现为行为基线（`reference-equivalent`）时，才在 Goal Card 中追加：

```json
{
  "preservation": {
    "mode": "preserve-all-observable",
    "constraints": ["已有业务功能不能遗漏"],
    "referenceRoots": ["src"],
    "behaviors": [
      { "id": "R1", "category": "business", "description": "创建订单", "sourceFiles": ["src/a.js"] }
    ],
    "excludedFiles": [{ "path": "src/types.js", "reason": "仅类型定义" }],
    "allowedDifferences": []
  }
}
```

所有 tracked Reference 文件必须归入 `behaviors` 或 `excludedFiles`；每个 Reference Behavior 自动成为一条 Acceptance；存在 `allowedDifferences` 时不得使用 direct Alignment。

## 验证
核对 Goal、Non-goal、主流程、异常、权限、数据、依赖和 Acceptance 是否一致；普通内部实现细节不要求用户决定。

## Context Ladder

上下文逐层加载，只有上层无法可靠决定时才向下：

```text
L0：用户目标 + 项目身份
→ L1：目标代码 + 直接相关测试
→ L2：直接调用方 / 数据流 / 依赖
→ L3：项目 Contract / Workstation
→ L4：Spec / Canonical / Experience
```

代码任务搜索顺序：

1. 先读 build-context 给出的入口和资料；
2. 找目标实现；
3. 找与目标行为直接相关的测试；
4. 找直接调用方；
5. 仍存在结构或业务不确定时才加载 Contract / Workstation；
6. 涉及规格影响时才加载 Spec；
7. 明显命中时才加载 Experience。

AI-SYSTEM 内核不做全库语义搜索，只提醒加载顺序与已有 Context 的原因；目标代码由宿主模型用 ripgrep、IDE Search、Git 与调用方搜索自行定位。

## 目标对齐

- 区分四类事实：用户原话（`originalRequest`，原样保留）、项目事实、已确认决定（`confirmedDecisions`）、低风险假设（`assumptions`，可被事实推翻，不是硬约束）。
- Goal 用一句话表达；Expected Outcome 必须可观察；普通 Protected Behavior 是实现与 Quality Pass 的约束，不自动扩展为独立 Acceptance。只有严格 Preservation 中已盘点的 Reference Behavior 自动成为 Acceptance 并要求逐项 Evidence。准备前在进度中输出 3～5 行简短目标卡，只固定“做成什么、不破坏什么、怎样算完成”，不展开详细实现步骤。
- `direct`：目标清楚、Scope 局部、Acceptance 可从需求与项目事实直接形成、无项目事实冲突、无需用户实质决定；Controlled/Structural 任务禁止 direct；reasonCodes 可选，仅作内部诊断，不强求凑齐固定依据。使用 direct 前反向检查是否存在另一种同样合理但会产生不同用户结果的解释，存在则转为 confirmed。初始分类已经是 Structural，或是非纯文档的 Controlled 任务时，缺少 confirmed/delegated Goal Card 必须在 `准备` 阶段直接拒绝，不能先创建 Task、实施完成后再要求对齐；初始低风险任务只有在真实 ChangeSet 升级风险时才进入交付阶段重新对齐。
- `confirmed`：用户确认了 Goal、最终效果或关键方案，必须记录 `decisionNote`；`delegated`：用户明确委托，必须记录 `delegatedTopics` 与边界，不能绕过现有 Scope、外部写入、数据迁移与不可逆动作门禁。
- 执行中只有 Goal、Outcome、Acceptance、Scope、已确认决定或风险发生实质变化时才暂停重新对齐；普通实现变化、假设被低风险推翻不触发。
- 交付时 Controlled/Structural 或严格行为保持任务必须提供 Change Rationale，把所有 ChangeSet 文件映射到 Goal 或 Acceptance；未知文件、未知 Acceptance、空 reason 与旧指纹被机器拒绝，未映射文件不能进入等待验收。普通 Standard 任务可选提供，提供时校验，缺失不阻止交付。
- `goal-card-file` / `rationale-file` / `task-check-file` 是系统与宿主模型之间的机器交换产物：由模型自动生成，存放于 OS 临时目录或明确忽略的临时目录，不要求用户手工填写，不提交到业务仓库；旧 `alignment-file` 仅作兼容别名。
- `重新对齐` 命令允许在 Codex 进度中修订目标后继续同一 Task：仅 confirmed/delegated，必须记录 decisionNote 与原因；修订号加一，清空旧 Evidence/Review/Handoff/Change Rationale 并回到 implementing；不改变 Scope、外部授权、集成目标与用户已有改动授权；已 ready_to_integrate 或结束的任务应创建新 Task。

## 行为保持

- `--intent` 保存当前有效用户请求原文；Alignment 的 `originalRequest` 必须与其一致，`重新对齐` 不得替换 initial originalRequest。
- 普通重构、优化、内部实现替换和升级默认仍为 `preserve-unrequested`，但必须主动识别与本次变更相关的 Protected Behavior，优先通过现有测试、调用方、规格和项目事实确认。
- 只有用户明确要求全部可观察行为严格保持时，才使用 `preserve-all-observable`。
- 只有用户明确指定旧实现/参考实现为行为基线时，才使用 `reference-equivalent`，旧实现是行为基线而非代码模板；Bug Fix 与 Feature 为 `preserve-unrequested`。
- 行为保持型任务必须完整查看 Reference Root：所有 tracked Reference 文件必须归入 Reference Behavior 或 excludedFiles；每个 Reference Behavior 自动成为一条 Acceptance，并需要行为 Evidence 证明。
- 未经用户批准的 `allowedDifferences` 默认是缺陷，且存在 allowedDifferences 时不得使用 direct Alignment。
- 不确定旧行为先查代码、调用方、测试、规格/Contract、Reference 与项目事实；只有无法解决且会改变业务结果时才问用户，多个问题尽量一次确认；行为等价范围内的内部实现优化无需询问。
- 具体 Acceptance 用系统执行的 `--task-check-file` 明确证明；新 Task Check 的每个 case 必须绑定 Acceptance、Cover、测试文件和精确用例名，零命中、skip/todo 或无法解析的用例结果不能形成证明。每个 case 只能贡献自身声明的 `Acceptance × Cover`，不得把同一 Check 内其他 case 的 Acceptance 与 Cover 合并成交叉归因；宽泛全量 Check 不自动绑定多个 Acceptance。Schema 1 的退出码协议可继续用于不绑定 Acceptance 的全局检查，但显式绑定 Acceptance 的旧 Manifest 或 Evidence 必须失败关闭并重新交付。
- 自动验证先要求 Task Check 完整覆盖当前缺失的 `Acceptance × Cover`；映射不完整时只返回缺口，不先执行通用命令。映射完整后，通用检查只补真实 ChangeSet 尚未覆盖的 Required Covers；任一检查失败时整批不产生部分成功 Evidence，不为此新增检查类型。
- 验证分三层：第一层是绑定具体 `Acceptance × Cover` 的定点 Task Check；第二层是只补真实 ChangeSet 所缺 Cover 的静态完整性或局部工程检查；第三层是全量历史回归。普通交付默认只运行前两层的最小充分集合；第三层必须拆为独立回归 Task 并获得用户明确授权。Planner 尚未生成真实计划前，进度只能写“生成并执行最小验证计划”，不得预告“系统全量门禁”。
