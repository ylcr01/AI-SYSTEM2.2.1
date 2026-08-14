# CHANGELOG

## V2.2.1

### 内核减重

- 删除静态 SHA 清单、入库发布 Inventory、原始验证日志、升级基线和一次性改名工具；发布 Inventory 改为按需生成。
- 删除人工权重的实施保真度层，发布档只运行系统自检、行为测试和发布清单。
- 中央能力将 Verification 合并进 Contract，样板统一登记在可扩展 Manifest。
- 规格追踪保留为按需能力：有项目映射或显式规格影响时启用。
- Experience Candidate 改为已验收来源的 Markdown 草稿、必填内容和精确查重。
- 删除成功检查缓存，保留验证预算、超时与失败重试保护。
- Review Package 改为显式审查时懒生成；当前内核停止迁移 V3/V4/V5 Task。

### 修复

- 修复 Markdown 经验解析中的无效正则，正式 Markdown 经验现在参与去重。
- 修复规格和测试 Glob 只用于分类、不能展开读取的问题。
- 修复 Evidence `kind` / `source.type` 未封闭枚举的绕过。
- 修复 Artifact 可越出仓库且不绑定内容哈希的问题。
- 修复检查规划只按全局 Cover 去重、忽略 Acceptance 绑定的问题。

### 增强

- 增加项目业务工作站能力：中央控制层、项目内领域档案、渐进上下文路由和非覆盖初始化。
- 工作站支持用户直接派发任务、软领域归属、临时子 Agent 与按任务 detached worktree，继续复用单一集成门禁。
- 并行写任务改为 Worktree 优先：Codex managed Worktree 或 detached worktree 按任务隔离，Local/目标分支工作区只保留单写或串行集成，并明确返工任务的保存释放与恢复重检。
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
