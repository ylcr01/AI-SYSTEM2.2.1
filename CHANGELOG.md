# CHANGELOG

## V2.2.1

### 修复

- 修复 Markdown 经验解析中的无效正则，正式 Markdown 经验现在参与去重。
- 修复规格和测试 Glob 只用于分类、不能展开读取的问题。
- 修复 Evidence `kind` / `source.type` 未封闭枚举的绕过。
- 修复 Artifact 可越出仓库且不绑定内容哈希的问题。
- 修复检查规划只按全局 Cover 去重、忽略 Acceptance 绑定的问题。

### 增强

- 所有 spec-map 路径强制限制在 Git Root 内。
- Decision 门禁校验 `id/status/affects/sourceTaskId/supersededBy`。
- `insufficient` Experience Candidate 默认不落盘。
- 规格编排拆分到独立 `spec-service.mjs`，降低 Task Runner 责任。
- 增加针对以上边界的回归与反例测试。

## V2.2.0

### 新增

- 增加基于 `AI_RD_OS_ROOT`、根 `AGENTS.md` 和宿主自定义指令的大模型接入层。
- 增加入口生成、检查和轻量项目 `AGENTS.md` 初始化命令。
- 增加 `.ai/spec-map.json` 确定性文件到规格 ID 映射。
- 增加源码显式 BR/TR/SC/EX ID 提取和测试追踪。
- 增加 `spec-consistency` 平衡模式门禁及可配置策略。
- Task Schema 升级为 V6，保存 `specTraceability` 与 `specConsistency`。
- `specImpact` 可在交付阶段重新声明，记录是否为显式声明。
- Experience Candidate 仅允许来自已验收 Task，并增加透明评分和相似度去重。
- 增加模块活规格、规格映射、规格策略和项目入口模板。

### 保持不变

- 不增加常驻 Host Adapter、MCP 网关或自动 Agent 编排。
- 普通对话不建立 Task。
- 最终验收只能由用户产生。
- 不自动升级 Contract、Canonical、Skill、Prompt、模板或中央经验。

## V2.1.2

- 增加 `specImpact` 基础字段。
- 增加模块规格模板。
- 增加 Experience Candidate 基础生成能力。
