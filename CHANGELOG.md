# CHANGELOG

## V2.3.0

### 模型自主架构（当前）

- 中央系统收缩为事实与安全层；需求、上下文、范围、文件、实现、测试、构建、异常路径、Worktree、架构、规格和交付时机由模型自主判断。
- 删除中央 Context Builder、Task、Goal Card、Scope、Evidence、Rationale、Check Manifest、自动检查、结果账本、提交与集成状态机；旧运行记录只作历史证据。
- 保留目标仓库身份、用户已有改动、真实并发、用户明确范围、外部/不可逆动作授权、默认不 Push 和结果真实性边界。
- 以下 V2.3.0 小节记录本次收缩前的历史实现，不再描述当前架构。

### 中央真实性收敛（长期收益待真实任务验证）

- Context 路由显式区分 `read|write|external-write`：只读意图不再因内容风险进入写 Task，外部写入始终进入正式路由，计划 Scope/路径在实施前参与风险分类。
- `local-direct` 和干净隔离 Worktree 的轻量修改在完成后执行无状态终检；必须原样回传预检 HEAD、branch/detached、`gitRoot` 和 `gitCommonDir`，任一身份、占用、Scope、Manifest 或最终风险变化均失败关闭。
- Quality 配置改为边界内、文件级和 fail closed；显式无效 JSON/shape/Profile/参考不再静默回退。导入结果只作辅证，文档/Contract/Visual 直接证明必须绑定 Git Root 内 artifact、当前哈希和系统执行来源。
- Browser Check 强制一 Check 一 flow、最多 4 条、单条 15 秒、整批 120 秒、外层 180 秒和首败熔断。当前同步 Runner 尚未实现 30 秒心跳/无输出终止，运行回执明确标记 `unimplemented`，不声称已执行。
- `ready_to_integrate` 继续持有源 Worktree 占用；退回使旧 Evidence/Review/Handoff/Rationale/Check Manifest 失效，相同 ChangeSet 未重新对齐时禁止再交付；集成预算续期后仍保持待集成。
- `诊断状态` 分开 `storageIntegrity` 与 `acceptanceEligibility`。Task 列表/评估按 `gitCommonDir` 识别逻辑项目，验收 unknown 只统计已交付样本；新 Task 保存系统版本与低敏感执行画像，交付尝试、真实检查执行和阶段耗时分开计录。
- 本轮技术定点验证不代表长期净收益已成立；结论保持 `unknown/experiment`，后续按 12 个受控任务与 20～30 个可比真实任务评估。

### 对话驱动交付闭环

- 将公开交付状态从 `ready_for_acceptance` 调整为 `delivered`：工程门禁通过即可说明“本轮已交付”，不再要求用户为每轮修改形式化确认。
- 新增精确 continuation 和五类轻量后续事件；相关询问保持已交付，缺陷退回进入返工，范围扩展、非正式肯定或话题推进形成 `closed`，而 `accepted` 仍只能由用户显式产生。
- Task Schema 升级到 V10，分别统计显式验收、对话自然收口和单轮闭环；不保存消息正文，不扫描最新 Task，不因后续提问重跑测试，也不推断首次修复成功。

### 内核减重与可信性修复

- 仓库写入按风险分路：合格 `ephemeral` 任务可在干净 Local 或已隔离 Worktree 轻量直达；正式写 Task 一律使用任务专属 Worktree。`WORKTREE_REQUIRED` / `WORKTREE_CONFLICT` 和 managed → detached fallback 保留，工作树占用不得转述为用户阻塞或静默降级。
- 删除项目业务工作站的中央能力、自动上下文路由、CLI、模板和宿主 Skill；项目中已有的 `.ai/workstations/` 可继续作为普通文档保留。
- 删除 10 个未注册、不可由宿主发现的内部 `SKILL.md`，将实际能力明确为 Quality Profile → Contract/Canonical 路由；新增 `--quality-profile`，旧 `--skill` 仅作兼容别名。
- 新增状态迁移的 dry-run / 显式 `--apply` 流程：仅升级受支持的非终态旧 Schema 和目录错位，写前备份，冲突 fail closed，不推断用户决定。
- 修复重新对齐沿用旧交付结果、任务级标签误分每条 Acceptance Evidence，以及指标隐藏未知验收和返工计数边界的问题。
- 普通写任务默认在专属 Worktree 中准备；低风险任务交付后由串行集成器在隔离候选上重放检查并 fast-forward 目标分支，成功后安全清理任务分支和 Worktree，冲突、脏目标、检查失败或高风险状态均保留成果并停止集成。

## V2.2.2

### Friction Reduction

- 默认 Task 回执和列表只展示四种用户状态、目标结果、变更、缺口和下一步；内部状态、指纹、Alignment、Rationale 与 Verification 仅在 `--full` 中返回。
- Task Schema 升级到 V9，自动记录首次交付、交付次数、验证耗时、用户决定、返工、首轮验收和退回原因；V6/V7/V8 保守兼容且旧指标不参与统计。
- 新增只读 `评估摘要`，报告样本量、首轮验收率、返工、用户决定、验证耗时和退回原因，并对小样本、旧记录和缺少可比基线明确告警。
- 快速开始不再要求用户操作 Goal Card、Change Rationale 或 Task Check 文件；完整宿主协议移动到 `帮助 --full`。
- 产品定位统一为面向个人开发者和强 Coding Agent 的轻量 AI 研发增强层。

### 可信闭环修复

- Git Baseline、ChangeSet 和集成关键路径改为 fail closed，Git 状态无法确认时不再返回空结果。
- Handoff 失效和已有改动重叠改为按当前事实重算的派生阻塞，恢复后不会遗留永久 Blocker。
- 验证预算全部改为有限值，新增必须说明原因的 `继续验证` 有界续期命令。
- 集成确认后目标分支 HEAD 发生变化会阻止验收；新增 `重验集成`，在干净目标工作区重新执行必要检查并绑定新的目标 HEAD。
- 增加上述边界的反例测试，以及 Windows、Linux 上 Node 22 的轻量 CI。

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
