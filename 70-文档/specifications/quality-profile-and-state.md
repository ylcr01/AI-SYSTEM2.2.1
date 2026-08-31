---
moduleId: MOD-AIRD-QUALITY-STATE
title: 质量资料路由与 Task 真实性
status: active
lastVerifiedTaskId: task-20260831021629923-44ebf286
lastVerifiedCommit: null
---

# 质量资料路由与 Task 真实性活规格

## 1. 目标与范围

- 负责：按显式 operation 将只读、局部低风险写入、正式 Task 和外部写入分路；选择实际可读的 Contract/Canonical；保证直达终检、Evidence、Browser 执行、默认本地提交、Worktree 占用、诊断、对话收口和完成轮次指标不失真；安全迁移旧非终态记录。
- 不负责：注册宿主 Skill；替用户作出验收或取消决定；猜测无精确 continuation 的独立修复 Task；自动迁移或删除历史账本；自动 Push 或执行其他外部写入。
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
| operation | 调用方对本次工作的显式操作声明：`read`、`write` 或 `external-write`；内容风险不能覆盖 `read` 的只读执行路由 |
| 精确 Scope 并集 | 通过重复 `--scope` 声明的文件或目录集合；每个 ChangeSet 文件必须位于至少一个 Scope 内 |
| 定点 / 静态 / 回归 | 分别指绑定 Acceptance 的 Task Check、补缺失 Cover 的局部完整性检查、需独立授权的全量历史测试 |
| 本轮已交付 | 当前 ChangeSet 已通过工程门禁并进入 `waiting_acceptance`；不等于用户显式验收 |
| 对话自然收口 | 后续为范围扩展、非正式肯定或独立话题推进，Task 进入 `closed`；不写入用户验收结论 |
| 完成轮次 | 同一问题的首次有效交付加相关询问、缺陷返回或显式退回次数；一个问题始终只形成一个样本 |
| 静默观察 | 没有明确收口事件时，交付后默认等待 7 天；期间无相关后续才纳入一次完成分母 |
| 问题类型 | 由 Intent 自动推断的 `bugfix|feature|refactor|migration|integration|documentation|maintenance|external-operation|unknown`；报告可按类型筛选 |
| 轻量直达 | `continuity=ephemeral` 的局部任务；在干净、可用且无已知并发写入的 Local 或隔离 Worktree 实施最小 Diff、一次定点检查、本地提交和轻量结果记录，不建立正式 Task、Evidence 或自动集成流程 |
| 直达终检 | 轻量写入后的无状态复核；原样重验 Baseline HEAD、branch/detached、`gitRoot`、`gitCommonDir`、占用、Scope、Manifest 差异和最终风险，不生成 Task 或 Evidence |
| 辅证 | 可帮助人或模型理解结果，但不能直接闭合 `Acceptance × Cover` 的导入或缺少可验证身份的证据 |

## 3. 业务规则与不变量

| ID | 规则 | 风险 | 备注 |
|---|---|---|---|
| BR-AIRD-QUALITY-001 | 内部 Profile 不得声明或加载 `20-能力模块/*/SKILL.md`；宿主 Skill 以宿主安装和可发现清单为准 | 把普通文档误判为可调用能力 | `check-system` 必须拒绝残留内部 `SKILL.md` |
| BR-AIRD-QUALITY-002 | 自动 `local/none` 不加载 Contract/Canonical；显式 Profile 最多加载一个 Contract；`structural` 最多加载一个主要 Contract 和一个 Active Canonical。显式 Quality 配置必须是可解析的受支持 shape，配置、Contract 和 Canonical 只能指向各自授权根内实际可读文件；无效 JSON/shape、目录、越界或空读取结果失败关闭。轻量回执绑定内容指纹，相同 `contextFingerprint` 返回空读取计划，事实变化后恢复 | 上下文膨胀、重复读取、缺少结构约束，或错误/越界质量资料被静默忽略 | 权威顺序为项目 → 模板 → 中央；`--full` 不受重复读取抑制 |
| BR-AIRD-QUALITY-003 | 新配置使用 `profiles` / `--quality-profile`；旧 `skills` / `--skill` 仅作输入兼容，输出不得再声明 `skills` 或 `methods`，也不得读取 `SKILL.md`。未知或无可读 Contract 的显式 Profile 失败关闭，不回退为自动或无配置 | 外部调用方失效、伪能力传播或显式无效选择被静默忽略 | 兼容别名与新参数应产生相同文件计划；自动 Profile 未命中仍是合法的不加载 |
| BR-AIRD-ROUTE-001 | Context/CLI 显式接受 `operation=read|write|external-write`。`read` 保留内容/结构风险判断但始终只读且 `ephemeral`；`external-write` 始终为 Controlled/tracked 正式路由；`write` 将 Quick/普通 Standard 局部任务标为轻量直达候选，Controlled、Structural、计划 Scope/路径风险、显式跟踪或 Handoff 标为正式闭环。合格 Local 或干净隔离 `current-worktree` 的轻量直达完成后必须执行无状态终检；验证通过后默认形成授权 Scope 的本地提交并追加轻量结果事件，不创建额外 Worktree、正式 Task、Evidence、`waiting_acceptance` 或自动集成 | 只读误进写路由、普通修改承担完整控制面成本、高风险/最终 Diff 绕过门禁，或轻量任务无法进入结果统计 | 所有正式 `准备` 命令仍创建 tracked Task；轻量账本不是第二套 Task 状态机；`package.json` 计划路径只是候选，仍按真实差异复核 |
| BR-AIRD-OUTPUT-001 | 默认 Context、Task、直接检查、诊断和迁移回执必须限量展开动态内容；成功检查不返回 stdout/stderr，失败必须返回首个失败、截断和 case 事实；只有显式 `--full` 可读取完整结构 | 大 ChangeSet、成功日志或旧状态列表占满会话上下文 | 默认最多 20 个改动、10 个其他动态项；完整日志仍可按需读取 |
| BR-AIRD-STATE-001 | 状态迁移默认 dry-run；只有显式 `--apply` 才写入，且必须先原样备份、校验源指纹和目标冲突 | 静默损坏运行账本 | 仅处理当前内核支持读取的 V6/V7/V8/V9 非终态记录与目录错位 |
| BR-AIRD-STATE-002 | 成功交付生成本轮唯一 `taskId + deliveryId`；后续写入还必须携带幂等 `observationId` 和封闭 `kind`。所有不同相关询问保持 `waiting_acceptance` 并累计完成轮次。缺陷/用户退回必须先持久化退回事实，清空旧 Evidence、Review、Handoff、Rationale 和 Check Manifest，并提升输入周期；未集成任务进入 `needs_rework`，已集成任务先进入 `blocked`，再基于最新目标 HEAD 安全恢复专属返工 Worktree，成功后进入 `verifying`，失败保持 `blocked` 并记录诊断且允许 `恢复` 重试。相同内容语义指纹且未重新对齐时禁止再交付，空提交不算输入变化。范围扩展、非正式肯定或话题推进进入 `closed`；`accepted` 只接受用户显式事件。`ready_to_integrate` 仍属写作占用态，直到成功集成才释放 | 后续误关联、漏计多轮沟通、恢复失败吞掉退回事实、伪验收、旧证明复活，或待集成任务与其他写入并发 | 再交付轮换 `deliveryId`；保留的源 Worktree 含脏内容时不得 reset 或覆盖；不保存消息正文、不因后续自动重跑检查或创建扩展 Task |
| BR-AIRD-STATE-003 | 未显式指定状态根时，任务状态必须优先解析到 `AI_RD_OS_STATE_ROOT`，其次解析到 `AI_RD_OS_ROOT/80-运行记录`；Worktree 脚本不得因自身物理路径不同而分裂运行账本 | 任务在源 Worktree 已交付，但主工作区集成器找不到状态，导致结果长期滞留 | 显式 `stateRoot` 仍具有最高优先级；环境均缺失时才回退到脚本所属系统根 |
| BR-AIRD-REALIGN-001 | 重新对齐必须使旧 `deliveryDecision`、ChangeSet、Evidence、Acceptance Gap、Review、规格校验和旧风险失效；新 Acceptance 在当前输入重新验证前只能是 pending 或 unverified | 旧结果冒充新目标已经完成 | 重新对齐不改变 Scope、外部授权或集成目标 |
| BR-AIRD-ALIGN-001 | 初始分类为 Structural，或 Intent、Acceptance、显式 Scope 命中非纯文档 Controlled 风险时，缺少 confirmed/delegated Goal Card 必须在 `准备` 阶段拒绝；初始低风险任务只有在真实 ChangeSet 升级风险时才进入重新对齐 | 高风险实现先完成、交付时才发现目标未确认，造成无效修改和状态污染 | 纯文档权限说明不因关键词误触发代码级门禁；Standard/Quick 保持原路径 |
| BR-AIRD-EVIDENCE-001 | Evidence 要求按每条 Acceptance 的业务语义推断；纯文档、运行行为、用户界面、数据迁移、拒绝/失败处理路径和目标环境分别路由，显式 `requiredCovers` 不得被任务级分类覆盖 | 文档检查误证业务行为、负向结果只用正向测试证明，或无关浏览器流程被强制执行 | `product`/`requirements` 标签本身不等于 documentation；未授权、拒绝、无效，或异常/失败的处理与回滚语义要求 `negative-path` |
| BR-AIRD-EVIDENCE-002 | 新建 Task Check 使用用例级 Schema 2，每个 case 绑定 Acceptance、Cover、测试文件和精确 Node 测试名；零命中、skip/todo 或不可解析结果失败关闭。导入 Evidence/外部结果只作辅证，不直接满足 Acceptance；`documentation|contract|visual` 直接证明必须来自系统执行用例，并绑定 Git Root 内存在的 artifact 及当前 SHA-256。验证先完整覆盖缺失的 `Acceptance × Cover`，缺失时不先运行通用命令；完整后通用检查只补真实 ChangeSet 缺口。同批规范化命令、参数、Runner、配置、测试声明、副作用和超时完全相同时只执行一次并复用结果；任一执行身份变化必须分别运行 | 退出码、导入论断或无产物身份的检查误证 Acceptance，宽泛回归/重复执行增加成本，或同批失败被较早成功掩盖 | artifact 执行后重算哈希，越界/不存在/非文件失败；Task Check 优先；复用限于同 cwd 同批次，跨 ChangeSet 仍失效 |
| BR-AIRD-BROWSER-001 | Browser 证明只接受用例级 `node-test` Runner，一个 Check 一条 flow，最多 4 条、单条最多 15 秒、Browser 整批最多 120 秒、包含前置检查的外层最多 180 秒；首个失败或超时立即熔断并报告 completed/failed/timedOut/blocked。当前同步 Runner 无法在子进程运行期间实施 30 秒心跳和无有效输出终止，必须结构化报告为 `unimplemented` 而非伪装已执行 | 超时继续、后续 flow 未熔断、未执行用例被隐藏或把规则文字冒充执行能力 | 全量历史 Browser 回归仍需独立 Task 和明确授权 |
| BR-AIRD-METRICS-001 | `completion-rounds-v1` 一个问题只形成一个样本；主报告展示一次、二次、三次、四次以上完成占比和精确轮次，并按 `problemType` 分组。明确收口立即完成；无后续样本静默观察 7 天后入分母。旧测量版本、问答、只读、未知类型或显式排除项保留但默认退出分母；显式验收仅为次要事实，不生成或恢复 `firstPassResolved` | 形式确认覆盖不足导致核心指标不可用，或不同类型、旧口径和观察中样本混入分母 | 少于 10 个完成样本只观察方向；20～30 个可比任务和明确基线才支持趋势判断 |
| BR-AIRD-COMMIT-001 | 仓库修改验证通过后默认形成只包含本次授权 Scope 的单一本地 Git 提交；轻量结果记录必须回传终检的 baseline HEAD/`gitRoot`/`gitCommonDir` 与不含 HEAD 的语义变更指纹，使回执、最终提交和预检身份一致，不能只校验 clean HEAD/Scope。任何交付流程都不得自动 Push，外部写入仍须单独授权 | 修改完成后等待用户重复要求提交，或伪造终检后替换变更、自动提交混入用户改动、误触远程写入 | 验证失败、跳过、Scope 不明、身份/指纹不符或工作树不干净时不得记录成功结果 |
| BR-AIRD-WORKSPACE-001 | 写入预检在加载 Goal Card/Context 前返回推荐路由：Local 只有在 Git 干净、分支明确、无活动写 Task 且无已知并发写入时才可 `local-direct`；脏、占用、并发、detached 主区或状态不确定时使用新 Worktree。预检为合格 Local 和干净隔离 `current-worktree` 返回含 HEAD、branch/detached、`gitRoot`、`gitCommonDir` 的完整 `directBaseline`；终检必须原样回传并拒绝任一仓库/路径身份、占用、精确 Scope、Manifest 差异或最终风险变化。正式 Task 始终独占 Worktree，创建和非写态重入写态时原子复核 | 普通任务固定承担 Worktree 成本，同提交/分支的其他 clone 被误认为同一直达上下文，或并发/用户已有改动被覆盖 | 预检/终检不写持久化状态；正式 `准备` 在 Local 仍返回 `WORKTREE_REQUIRED` |
| BR-AIRD-SCOPE-001 | 重复 `--scope` 形成精确授权并集，逗号拼接和 glob 仍拒绝；ChangeSet 只要落在任一 Scope 内即合法，全部 Scope 外的文件必须失败关闭 | 为授权少数文件被迫扩大到共同父目录，或多 Scope 绕过路径逃逸保护 | 每个 Scope 独立执行 Git Root、真实路径和符号链接边界检查；单 Scope 保持兼容 |
| BR-AIRD-RISK-001 | `package.json` 路径本身只是风险候选；真实差异仅涉及约定元数据字段或为语义无变化时不升级，新增/删除、不可读或 scripts、依赖及其他顶层运行/构建字段变化时升级为 build-contract 并要求 package 完整性 | 版本号更新误触发 Controlled，或真实依赖/脚本变化漏过门禁 | 基线已有脏 Manifest 时无法可靠重建差异，必须保守升级 |
| BR-AIRD-VERIFY-001 | Acceptance 只表达结果，不包含命令、通用检查或“系统全量门禁”；Planner 基于真实 ChangeSet 先选定点 Task Check，再只补缺失 Cover 的静态/局部检查。集成验证预算耗尽后 Task 保持 `ready_to_integrate`；显式有界续期只追加预算并恢复 integration ready，不重算 ChangeSet、不生成交付 Evidence。全量历史回归不在普通交付执行 | 验证手段覆盖真实 Goal、预算停止被误当返工/已交付，或无关全量回归拖慢交付 | 续期不改变单项超时和 Browser 硬限制；计划生成前只表述“生成并执行最小验证计划” |
| BR-AIRD-DIAGNOSE-001 | `诊断状态` 保持只读，并分开返回 `storageIntegrity` 与 `acceptanceEligibility`；只有存储完整时才逐条重验待验收 Task 的当前资格，存储失败时明确跳过资格诊断 | “JSON/目录正常”被误表达为“仍可验收” | 资格诊断报告 checked/eligible/ineligible 和 Task 级原因，不改写 Task |
| BR-AIRD-METRICS-IDENTITY-001 | 列表与评估优先按 `gitCommonDir` 将 linked Worktree 归并为同一逻辑项目，而工作树写锁仍按 `gitRoot`。验收 `unknown` 只统计已进入可验收交付的样本。新 Task 保存当时系统版本/Commit/脏状态、Node/平台/架构，以及宿主显式传入的模型、推理强度和执行环境；交付尝试、真实检查执行次数/耗时与阶段时间分开计录 | Worktree 重复计数、未交付样本污染验收未知率，或用整段交付墙钟时间冒充检查执行耗时 | 旧记录缺少身份或执行事实时保留 legacy/unknown，不反向推断 |

## 4. 状态迁移

| ID | 当前状态 | 动作 | 前置条件 | 目标状态 | 副作用 | 拒绝结果 |
|---|---|---|---|---|---|---|
| TR-AIRD-STATE-001 | V6/V7/V8/V9 或目录错位的非终态记录 | `迁移状态 --apply` | dry-run 无 blocker；源指纹未变化；目标不存在 | 相同业务状态的 V10 记录位于正确目录 | 在 `迁移备份/<migrationId>/` 保存原始文件 | 任一前置条件失败则不开始迁移 |
| TR-AIRD-CONVERSATION-001 | `waiting_acceptance` | `后续` | `taskId`、当前 `deliveryId`、`observationId` 和 `kind` 有效 | 按 kind 保持 `waiting_acceptance`、进入返工流或归档为 `closed`；已集成退回在 Worktree 恢复前为 `blocked` | 只写最小分类、时间、计数和 observation 标识；所有不同相关 observation 计轮次，重复值幂等；`defect-return` 先持久化并使旧交付证明失效，再基于最新目标 HEAD 尝试恢复返工 Worktree | 标识缺失、过期、冲突或 kind 非法时不写入；恢复失败保留 `blocked`、退回事实和诊断，允许 `恢复` 重试且不覆盖脏内容 |
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
| BR-AIRD-QUALITY-002 | 路由过载、无效/越界/非文件 Quality 资料被静默忽略 | Integration | `60-测试/integration/context-quality.test.mjs` | covered |
| BR-AIRD-QUALITY-003 | 兼容失效或显式无效 Profile 被回退 | Integration/Scenario | `60-测试/integration/context-quality.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-ROUTE-001 | 只读误进写路由、普通任务过重、高风险绕过门禁或轻量结果丢失 | Core/Integration/Scenario | `60-测试/core/task-policy.test.mjs`; `60-测试/core/worktree-routing.test.mjs`; `60-测试/core/outcome-ledger.test.mjs`; `60-测试/integration/context-quality.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-OUTPUT-001 | 大回执占满上下文 | Scenario | `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-STATE-001 | 非授权写入 | Unit/Scenario | `60-测试/core/state-manager.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-STATE-003 | Worktree 与集成器读取不同账本 | Unit | `60-测试/core/state-manager.test.mjs` | covered |
| BR-AIRD-STATE-002 / TR-AIRD-CONVERSATION-001 | 后续误关联、退回旧证明复活、待集成提前释放或伪验收 | Core/Integration/Scenario | `60-测试/core/state-manager.test.mjs`; `60-测试/integration/task-runner.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| TR-AIRD-STATE-001 | 状态或目录被改变 | Unit/Scenario | `60-测试/core/state-manager.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| EX-AIRD-STATE-001 | 冲突被覆盖 | Unit | `60-测试/core/state-manager.test.mjs` | covered |
| BR-AIRD-REALIGN-001 / TR-AIRD-REALIGN-001 | 旧交付误证新目标 | Integration/Scenario | `60-测试/integration/alignment-realign.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-EVIDENCE-001 | 任务级标签误分每条验收 | Integration | `60-测试/integration/task-runner.test.mjs` | covered |
| BR-AIRD-EVIDENCE-002 | 零命中、skip/todo、导入辅证或无产物身份的检查冒充直接证明 | Core/Integration/Scenario | `60-测试/core/evidence.test.mjs`; `60-测试/core/check-planner.test.mjs`; `60-测试/integration/check-planner.test.mjs`; `60-测试/integration/task-runner.test.mjs`; `60-测试/scenarios/cli.test.mjs`; `60-测试/scenarios/trust-gates.test.mjs` | covered |
| BR-AIRD-BROWSER-001 | Browser 上限/熔断失效或未实现心跳被伪装为已执行 | Core/Integration | `60-测试/core/check-planner.test.mjs`; `60-测试/integration/check-planner.test.mjs` | covered-with-declared-gap |
| BR-AIRD-METRICS-001 / BR-AIRD-COMMIT-001 | 完成轮次、样本边界或本地提交失真 | Unit/Scenario | `60-测试/core/outcome-metrics.test.mjs`; `60-测试/core/outcome-ledger.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-METRICS-IDENTITY-001 | 逻辑项目、已交付样本、执行次数或耗时被失真统计 | Unit/Integration/Scenario | `60-测试/core/outcome-metrics.test.mjs`; `60-测试/core/state-manager.test.mjs`; `60-测试/integration/task-runner.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-DIAGNOSE-001 | 存储完整被误当验收资格 | Scenario | `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-WORKSPACE-001 | Local 路由错误、直达终检缺失、占用迟到或正式 Task 原子复核丢失 | Core/Integration/Scenario | `60-测试/core/worktree-routing.test.mjs`; `60-测试/core/state-manager.test.mjs`; `60-测试/integration/task-runner.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-SCOPE-001 | 精确授权被扩大或越界未拒绝 | Core/Integration/Scenario | `60-测试/core/alignment.test.mjs`; `60-测试/integration/git-state.test.mjs`; `60-测试/integration/task-runner.test.mjs`; `60-测试/scenarios/cli.test.mjs` | covered |
| BR-AIRD-RISK-001 | Manifest 元数据误升级或运行契约漏升级 | Core/Integration | `60-测试/core/task-policy.test.mjs`; `60-测试/integration/git-state.test.mjs`; `60-测试/integration/task-runner.test.mjs` | covered |
| BR-AIRD-VERIFY-001 | Acceptance 被验证手段覆盖、集成预算续期跳态或普通交付运行全量回归 | Core/Integration | `60-测试/core/instruction-entry.test.mjs`; `60-测试/core/task-policy.test.mjs`; `60-测试/integration/task-runner.test.mjs` | covered |
