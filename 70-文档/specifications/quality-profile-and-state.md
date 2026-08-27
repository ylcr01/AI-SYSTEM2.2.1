---
moduleId: MOD-AIRD-QUALITY-STATE
title: 质量资料路由与 Task 真实性
status: active
lastVerifiedTaskId: task-20260827011139813-97e8e394
lastVerifiedCommit: null
---

# 质量资料路由与 Task 真实性活规格

## 1. 目标与范围

- 负责：将局部低风险修改路由为轻量直达、将高风险或结构性工作路由为正式 Task；选择需要的质量 Contract/Canonical；安全迁移旧非终态记录；保证证据、对话收口、输出和结果指标不失真。
- 不负责：注册宿主 Skill；替用户作出验收或取消决定；自动关联独立修复 Task；自动迁移历史账本。
- 上游边界：宿主先提供项目事实、角色、任务意图、结构影响和可选显式 Profile。
- 下游边界：Context 只返回实际可读文件；状态迁移只写入本地 `stateRoot`。

## 2. 术语

| 名称 | 含义 |
|---|---|
| Quality Profile | 系统内部的质量资料路由配置，不是 Codex 或其他宿主可调用 Skill |
| Contract | 领域工程不变量和验证边界 |
| Canonical | 经登记且处于 Active 生命周期的结构样板 |
| dry-run | 只报告迁移动作和冲突，不创建备份、不改写或移动记录 |
| 写入预检 | 在 Goal Card、Context 和 Baseline 之前只读检查 Git 工作树占用、干净状态和工作树类型；不创建 Task，并返回 `local-direct`、`current-worktree` 或 `new-worktree` 推荐路由；正式 Task 的最终原子复核仍保留 |
| 精确 Scope 并集 | 通过重复 `--scope` 声明的文件或目录集合；每个 ChangeSet 文件必须位于至少一个 Scope 内 |
| 定点 / 静态 / 回归 | 分别指绑定 Acceptance 的 Task Check、补缺失 Cover 的局部完整性检查、需独立授权的全量历史测试 |
| 决定覆盖率 | 有明确用户首轮验收结论的已跟踪 Task 数除以全部已跟踪 Task 数；未知样本不得进入通过率分母 |
| 本轮已交付 | 当前 ChangeSet 已通过工程门禁并进入 `waiting_acceptance`；不等于用户显式验收 |
| 对话自然收口 | 后续为范围扩展、非正式肯定或独立话题推进，Task 进入 `closed`；不写入用户验收结论 |
| 单轮闭环 | 当前交付的首次后续就是收口类事件；首次后续为相关询问或缺陷退回时为 false，缺少后续时为 unknown |
| 轻量直达 | `continuity=ephemeral` 的 Quick/普通 Standard 局部任务；在干净、可用且没有已知并发写入的 Local 或已经隔离的当前 Worktree 实施最小 Diff，只运行一次定点检查并报告事实，不建立持久化 Task 或自动集成流程 |

## 3. 业务规则与不变量

| ID | 规则 | 风险 | 备注 |
|---|---|---|---|
| BR-AIRD-QUALITY-001 | 内部 Profile 不得声明或加载 `20-能力模块/*/SKILL.md`；宿主 Skill 以宿主安装和可发现清单为准 | 把普通文档误判为可调用能力 | `check-system` 必须拒绝残留内部 `SKILL.md` |
| BR-AIRD-QUALITY-002 | 自动 `local/none` 不加载 Contract/Canonical；显式 Profile 最多加载一个 Contract；`structural` 最多加载一个主要 Contract 和一个 Active Canonical。轻量回执为读取文件提供内容指纹；调用方传回相同 `contextFingerprint` 时返回空读取计划，任一相关事实变化后恢复完整计划 | 上下文膨胀、重复读取或缺少结构约束 | 权威顺序为项目 → 模板 → 中央；`--full` 不受重复读取抑制 |
| BR-AIRD-QUALITY-003 | 新配置使用 `profiles` / `--quality-profile`；旧 `skills` / `--skill` 仅作输入兼容，输出不得再声明 `skills` 或 `methods`，也不得读取 `SKILL.md` | 外部调用方突发失效或伪能力继续传播 | 兼容别名与新参数应产生相同文件计划 |
| BR-AIRD-ROUTE-001 | Context 将 Quick/普通 Standard 局部任务标为 `ephemeral`；Controlled、Structural、显式跟踪或 Handoff 标为正式闭环。预检推荐 `local-direct` 时轻量直达不创建 Worktree、Task、Evidence、`waiting_acceptance`、自动集成或重复重验；当前已在隔离 Worktree 时可直接实施 | 普通修改承担完整控制面成本，或高风险任务绕过可信门禁 | 所有正式 `准备` 命令仍创建 tracked Task；路由发生在是否调用 Task 之前 |
| BR-AIRD-OUTPUT-001 | 默认 Context、Task、直接检查、诊断和迁移回执必须限量展开动态内容；成功检查不返回 stdout/stderr，失败必须返回首个失败、截断和 case 事实；只有显式 `--full` 可读取完整结构 | 大 ChangeSet、成功日志或旧状态列表占满会话上下文 | 默认最多 20 个改动、10 个其他动态项；完整日志仍可按需读取 |
| BR-AIRD-STATE-001 | 状态迁移默认 dry-run；只有显式 `--apply` 才写入，且必须先原样备份、校验源指纹和目标冲突 | 静默损坏运行账本 | 仅处理当前内核支持读取的 V6/V7/V8/V9 非终态记录与目录错位 |
| BR-AIRD-STATE-002 | 成功交付必须生成本轮唯一的 `taskId + deliveryId` continuation；后续写入还必须携带幂等 `observationId` 和封闭 `kind`。相关询问保持 `waiting_acceptance`，缺陷退回进入 `needs_rework`，范围扩展、非正式肯定或话题推进进入 `closed`；`accepted` 仍只接受用户显式验收事件 | 扫描或猜测错误 Task、把追问误判为返工、把沉默或换话题伪造成用户验收 | 再交付轮换 `deliveryId` 并拒绝旧标识；不保存消息正文、不重跑工程检查、不自动创建扩展 Task |
| BR-AIRD-STATE-003 | 未显式指定状态根时，任务状态必须优先解析到 `AI_RD_OS_STATE_ROOT`，其次解析到 `AI_RD_OS_ROOT/80-运行记录`；Worktree 脚本不得因自身物理路径不同而分裂运行账本 | 任务在源 Worktree 已交付，但主工作区集成器找不到状态，导致结果长期滞留 | 显式 `stateRoot` 仍具有最高优先级；环境均缺失时才回退到脚本所属系统根 |
| BR-AIRD-REALIGN-001 | 重新对齐必须使旧 `deliveryDecision`、ChangeSet、Evidence、Acceptance Gap、Review、规格校验和旧风险失效；新 Acceptance 在当前输入重新验证前只能是 pending 或 unverified | 旧结果冒充新目标已经完成 | 重新对齐不改变 Scope、外部授权或集成目标 |
| BR-AIRD-ALIGN-001 | 初始分类为 Structural，或 Intent、Acceptance、显式 Scope 命中非纯文档 Controlled 风险时，缺少 confirmed/delegated Goal Card 必须在 `准备` 阶段拒绝；初始低风险任务只有在真实 ChangeSet 升级风险时才进入重新对齐 | 高风险实现先完成、交付时才发现目标未确认，造成无效修改和状态污染 | 纯文档权限说明不因关键词误触发代码级门禁；Standard/Quick 保持原路径 |
| BR-AIRD-EVIDENCE-001 | Evidence 要求按每条 Acceptance 的业务语义推断；纯文档、运行行为、用户界面、数据迁移、拒绝/失败处理路径和目标环境分别路由，显式 `requiredCovers` 不得被任务级分类覆盖 | 文档检查误证业务行为、负向结果只用正向测试证明，或无关浏览器流程被强制执行 | `product`/`requirements` 标签本身不等于 documentation；未授权、拒绝、无效，或异常/失败的处理与回滚语义要求 `negative-path` |
| BR-AIRD-EVIDENCE-002 | 新建 Task Check 使用用例级 Schema 2，每个 case 绑定 Acceptance、Cover、测试文件和精确 Node 测试名；零命中、skip/todo 或不可解析结果失败关闭。验证先完整覆盖缺失的 `Acceptance × Cover`，缺失时零命令；完整后通用检查只补真实 ChangeSet 缺口。同批规范化命令、参数、Runner、配置、测试声明、副作用和超时完全相同时只执行一次并复用结果；任一执行身份变化必须分别运行 | 退出码误证、宽泛回归或相同底层命令重复运行、较早成功掩盖同批失败 | Task Check 优先；复用限于同一 cwd 和同一执行批次，跨 ChangeSet Evidence 仍按原规则失效 |
| BR-AIRD-METRICS-001 | 首轮显式验收摘要必须同时报告 decided、unknown、rate 和 coverage；对话摘要必须分开报告 tracked、implicit closures、single-turn 和各类 follow-up；交付迭代必须报告多次交付 Task、额外交付次数和首交付后的真实重对齐。返工只计同一 Task 内显式用户退回，对话缺陷退回不得改写旧验收指标；旧记录缺少对话事实时保持 unknown | 小量已决定样本被表达成整体稳定结果，或自然换话题被伪造成显式验收/首次修复成功 | 小样本和无可比基线仍需保留警告；系统不生成 `firstPassResolved` |
| BR-AIRD-WORKSPACE-001 | 写入预检在加载 Goal Card 和工程 Context 前返回推荐路由：Local 只有在 Git 状态干净、分支明确、同一工作树无活动写 Task 且执行模型没有已知并发写入时才可 `local-direct`；脏、占用、并发、detached 主区或状态不确定时使用新 Worktree。正式 Task 始终独占 Worktree，创建和任何非写态重新进入写态时仍在工作树原子锁内复核 | 普通任务固定承担 Worktree 成本，或并发/用户已有改动被覆盖 | 预检不写状态、不创建或删除 Worktree；正式 `准备` 在 Local 仍返回 `WORKTREE_REQUIRED` |
| BR-AIRD-SCOPE-001 | 重复 `--scope` 形成精确授权并集，逗号拼接和 glob 仍拒绝；ChangeSet 只要落在任一 Scope 内即合法，全部 Scope 外的文件必须失败关闭 | 为授权少数文件被迫扩大到共同父目录，或多 Scope 绕过路径逃逸保护 | 每个 Scope 独立执行 Git Root、真实路径和符号链接边界检查；单 Scope 保持兼容 |
| BR-AIRD-RISK-001 | `package.json` 路径本身只是风险候选；真实差异仅涉及约定元数据字段或为语义无变化时不升级，新增/删除、不可读或 scripts、依赖及其他顶层运行/构建字段变化时升级为 build-contract 并要求 package 完整性 | 版本号更新误触发 Controlled，或真实依赖/脚本变化漏过门禁 | 基线已有脏 Manifest 时无法可靠重建差异，必须保守升级 |
| BR-AIRD-VERIFY-001 | Acceptance 只表达结果，不包含命令、通用检查或“系统全量门禁”；Planner 基于真实 ChangeSet 先选定点 Task Check，再只补缺失 Cover 的静态/局部检查。全量历史回归不在普通交付执行，必须拆为独立 Task 并获得明确授权 | 验证手段覆盖真实 Goal、局部任务被伪装成系统级检查，或无关全量回归拖慢交付 | 计划生成前只能表述“生成并执行最小验证计划”；检查名称必须反映真实层级 |

## 4. 状态迁移

| ID | 当前状态 | 动作 | 前置条件 | 目标状态 | 副作用 | 拒绝结果 |
|---|---|---|---|---|---|---|
| TR-AIRD-STATE-001 | V6/V7/V8/V9 或目录错位的非终态记录 | `迁移状态 --apply` | dry-run 无 blocker；源指纹未变化；目标不存在 | 相同业务状态的 V10 记录位于正确目录 | 在 `迁移备份/<migrationId>/` 保存原始文件 | 任一前置条件失败则不开始迁移 |
| TR-AIRD-CONVERSATION-001 | `waiting_acceptance` | `后续` | `taskId`、当前 `deliveryId`、`observationId` 和 `kind` 有效 | 按 kind 保持 `waiting_acceptance`、进入 `needs_rework` 或归档为 `closed` | 只写最小分类、时间、计数和首个/终止观察；重复 observation 幂等 | 标识缺失、过期、冲突或 kind 非法时不写入 |
| TR-AIRD-REALIGN-001 | 任一未结束 Task | `重新对齐` | Goal Card 为 confirmed/delegated 且说明原因 | `implementing` | 验收修订号与输入周期递增，旧交付和验证产物失效 | 已结束任务、direct 或缺少确认说明时拒绝 |

## 5. 异常与补偿

### EX-AIRD-STATE-001 冲突或迁移失败

- 触发条件：重复 Task、无效 Schema/JSON、终态错放、文件名不一致、目标已存在、源指纹变化、备份目录冲突，或后续 continuation 不精确。
- 幂等与重试：先修复 blocker 或确认输入变化，再生成新的 dry-run；不得机械使用相同 migrationId 重跑。
- 补偿：写入前的原始记录位于专属备份目录；不得通过迁移命令推断 accepted/cancelled 来消除冲突。
- 审计：报告 planned、applied、blockers、migrationId 和 backupRoot。

## 6. 测试追踪矩阵

| 规格 ID | 风险 | 测试层级 | 自动测试 | 状态 |
|---|---|---|---|---|
| BR-AIRD-QUALITY-001 | 伪 Skill 残留 | Integration/Scenario | `60-测试/integration/context-quality.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-QUALITY-002 | 路由过载或缺失 | Integration | `60-测试/integration/context-quality.test.mjs` | covered |
| BR-AIRD-QUALITY-003 | 兼容失效 | Integration/Scenario | `60-测试/integration/context-quality.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-ROUTE-001 | 普通任务过重或高风险绕过门禁 | Core/Integration | `60-测试/core/task-policy.test.mjs`; `60-测试/integration/context-quality.test.mjs` | covered |
| BR-AIRD-OUTPUT-001 | 大回执占满上下文 | Scenario | `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-STATE-001 | 非授权写入 | Unit/Scenario | `60-测试/core/state-manager.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-STATE-003 | Worktree 与集成器读取不同账本 | Unit | `60-测试/core/state-manager.test.mjs` | covered |
| BR-AIRD-STATE-002 / TR-AIRD-CONVERSATION-001 | 后续误关联、误返工或伪造验收 | Core/Integration/Scenario | `60-测试/core/state-manager.test.mjs`; `60-测试/integration/task-runner.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| TR-AIRD-STATE-001 | 状态或目录被改变 | Unit/Scenario | `60-测试/core/state-manager.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| EX-AIRD-STATE-001 | 冲突被覆盖 | Unit | `60-测试/core/state-manager.test.mjs` | covered |
| BR-AIRD-REALIGN-001 / TR-AIRD-REALIGN-001 | 旧交付误证新目标 | Integration/Scenario | `60-测试/integration/alignment-realign.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-EVIDENCE-001 | 任务级标签误分每条验收 | Integration | `60-测试/integration/task-runner.test.mjs` | covered |
| BR-AIRD-EVIDENCE-002 | 零命中、skip/todo、错选或结果协议失真被误判为通过 | Core/Integration/Scenario | `60-测试/core/check-planner.test.mjs`; `60-测试/integration/check-planner.test.mjs`; `60-测试/integration/task-runner.test.mjs`; `60-测试/scenarios/cli.test.mjs`; `60-测试/scenarios/trust-gates.test.mjs` | covered |
| BR-AIRD-METRICS-001 | 未知验收或返工边界被隐藏 | Unit/Scenario | `60-测试/core/outcome-metrics.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-WORKSPACE-001 | Local 路由错误、占用检查迟到或正式 Task 原子复核丢失 | Core/Integration/Scenario | `60-测试/core/worktree-routing.test.mjs`; `60-测试/core/state-manager.test.mjs`; `60-测试/integration/task-runner.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-SCOPE-001 | 精确授权被扩大或越界未拒绝 | Core/Integration/Scenario | `60-测试/core/alignment.test.mjs`; `60-测试/integration/git-state.test.mjs`; `60-测试/integration/task-runner.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-RISK-001 | Manifest 元数据误升级或运行契约漏升级 | Core/Integration | `60-测试/core/task-policy.test.mjs`; `60-测试/integration/git-state.test.mjs`; `60-测试/integration/task-runner.test.mjs` | covered |
| BR-AIRD-VERIFY-001 | Acceptance 被验证手段覆盖或普通交付运行全量回归 | Core/Integration | `60-测试/core/instruction-entry.test.mjs`; `60-测试/core/task-policy.test.mjs`; `60-测试/integration/task-runner.test.mjs` | covered |
