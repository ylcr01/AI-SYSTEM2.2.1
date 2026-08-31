# AI-SYSTEM

**面向个人开发者和强 Coding Agent、由真实问题驱动的轻量 AI 研发增强层。**

当前版本：`V2.3.0`。

AI-SYSTEM 不替代 Codex、Claude Code 等 Coding Agent，也不试图成为 IDE、Agent Runtime、工作流平台或企业治理系统。它通过宿主自定义指令、项目 `AGENTS.md` 和本地 Node.js 工具，为真实软件任务补上少量但关键的纠偏能力：

> **理解用户目标 → 获取正确上下文 → 在授权范围内实现 → 用定点检查证明结果 → 默认本地提交 → 用真实后续衡量完成轮次。**

系统不引入常驻服务，不接管模型的分析、设计和编码过程，也不把流程数量当作研发质量。

## 为什么存在

强 Coding Agent 的常见失败通常不是“不会写代码”，而是：

- 理解错用户真正需要的业务结果；
- 读取大量无关信息，或遗漏真正重要的项目事实；
- 顺手修改 Scope 之外的文件，覆盖用户已有改动；
- 跑了很多测试，却没有证明具体 Acceptance；
- Worktree 内验证通过，但集成到目标分支后已经失真；
- AI 宣布完成，而用户要求的结果仍缺少可信证据。

AI-SYSTEM 的目标不是增加更多流程，而是减少这些失败。系统以真实研发问题和真实交付结果为反馈，在不实质降低模型理解、推理、探索、判断和创造能力的前提下，只保留能够带来净正向收益的上下文、规则、工具与门禁，使模型更高效、稳定地交付准确、高质量、优雅、清晰且可验证的结果。

这一使命的优先级、不可退化边界和问题驱动闭环见 [`70-文档/10-架构与原则.md`](70-文档/10-架构与原则.md)。中央机制的新增、修改、精简或删除须按 [`70-文档/55-系统演进准入.md`](70-文档/55-系统演进准入.md) 分析核心诉求影响；证据不足的方案只进入观察或受控试验，不得直接描述为已产生正向收益。

## 核心闭环

```text
普通对话        → 直接回答，不建立 Task
只读工程分析    → operation=read → build-context → 读取最小相关事实
局部低风险修改  → operation=write → 预检 → 干净 Local / 隔离 Worktree 直达 → 最小 Diff + 定点检查 + 无状态终检 + 本地提交 + 轻量结果
正式写 Task     → 专属 Worktree → 独立提交 → 隔离应用与重验 → 串行快进目标分支 → 本轮已交付
Local/主工作区  → 只读分析、合格轻量直达或单一集成者串行集成
外部写入        → 完整闭环 + 单独明确授权
```

低风险局部修改不进入正式 Task 状态机，只追加最小结果事实；模型负责理解、实现、最小 Diff、定点检查和本地提交。正式 Task 只硬控可以机器确认的 Goal、项目身份、Scope、用户已有改动、ChangeSet、Evidence、检查输入和 Worktree 集成新鲜度。显式验收保留为可选强事实，不是交付完成或统计的前置条件。

## 当前可信边界

- Acceptance 只有被定点检查显式绑定时才算被证明；通用检查不自动冒充验收证据，外部导入结果只是辅证。`documentation|contract|visual` 的直接证明还必须绑定 Git Root 内的 artifact、当前内容哈希和系统执行来源。
- 新 Task Check 使用用例级 Schema 2，只接受受控 Runner；每个 case 显式绑定 Acceptance、Cover、测试文件和精确用例名。Runner 必须返回真实命中、通过、失败、skip/todo 结果，Check Manifest 同时绑定用例声明、Runner 协议与输入哈希。
- 默认验证先完整映射 Acceptance，映射缺失时不执行通用命令；映射完整后，通用检查只补真实 ChangeSet 尚未覆盖的 Required Covers，同一批检查失败时不保留部分成功 Evidence。全量历史回归不属于普通交付，必须另建 Task 并明确授权。
- Task 写作态、已交付和历史记录分层保存；`ready_to_integrate` 仍占用源 Worktree，集成验证预算续期后仍是待集成，不伪装成已交付或返工。`delivered` 只表示工程门禁通过，`closed` 只表示对话收口，`accepted` 只由用户显式产生。
- 每次成功交付返回精确 `taskId + deliveryId` continuation。宿主据此记录每个不同 `observationId` 的相关询问、缺陷退回、范围扩展、非正式肯定或话题推进；不扫描“最新任务”，不保存消息正文，也不因后续提问重跑测试。
- 相同输入失败不能机械重跑；只有真实 ChangeSet、正式重新对齐或受限诊断重试能改变验证路径。
- 正式写 Task 独占 Worktree；轻量直达只有在 Local 干净、可用且没有已知并发写入，或当前已经是干净隔离 Worktree 时才可实施。终检须原样复核预检给出的 HEAD、branch/detached、`gitRoot`、`gitCommonDir`、最终 Diff、Scope、Manifest 风险和占用；正式集成和目标 HEAD 变化后必须在真实目标提交上重放交付检查。
- 显式 Quality 配置的 JSON、shape、路径或参考文件无效时失败关闭，不回退为“没有配置”；Context 只返回授权根内实际可读文件。
- 退回先落账并使上轮 Evidence、Review、Handoff、Rationale 和 Check Manifest 失效；已集成任务安全恢复专属返工 Worktree，失败则保持 blocked 与诊断。相同 ChangeSet 且未重新对齐时不能再交付。`诊断状态` 分开报告 `storageIntegrity` 和 `acceptanceEligibility`，不再用存储完整性代替当前验收资格。
- 仓库修改验证通过后默认形成仅包含本次 Scope 的本地 Git 提交；轻量直达再追加最小结果事实。Push、发布、部署和其他外部写入绝不随交付自动发生，仍须单独授权。
- Goal Card、Change Rationale 和 Task Check 由宿主自动处理，用户不维护内部 JSON 文件。
- 默认回执对 ChangeSet、缺口和诊断列表限量展开，并报告 `total`、`shown`、`truncated`；直接检查不展开成功日志，显式 `--full` 才读取完整记录。
- `build-context` 返回读取计划的内容指纹；同一输入再次调用时传入 `--known-context-fingerprint <上次指纹>`，未变化则返回空读取计划，项目事实变化后自动恢复完整计划。

详细规则以 [`AGENTS.md`](AGENTS.md)、[`70-文档/10-架构与原则.md`](70-文档/10-架构与原则.md)、[`70-文档/55-系统演进准入.md`](70-文档/55-系统演进准入.md)、[`20-能力模块/clarify-requirements/CONTRACT.md`](20-能力模块/clarify-requirements/CONTRACT.md) 和 [`70-文档/20-可信门禁.md`](70-文档/20-可信门禁.md) 为准；维护者可运行 `task.mjs --help --full` 查看机器协议。

## 快速开始

要求：Node.js 20 或 22、Git，以及具备本地文件和终端能力的 Coding Agent。

### 接入模型入口

```powershell
node ./40-脚本/configure-model-entry.mjs 生成
node ./40-脚本/configure-model-entry.mjs 检查
```

具体宿主和权限边界见 [`00-大模型接入/接入说明.md`](00-大模型接入/接入说明.md)。

### 读取项目上下文

```powershell
node ./40-脚本/build-context.mjs --operation read --cwd <项目路径> --intent "<目标>"
```

默认返回轻量上下文；只有身份、路由或依赖诊断需要完整信息时才追加 `--full`。

重复请求同一上下文时可避免再次读取未变化资料：

```powershell
node ./40-脚本/build-context.mjs --operation read --cwd <项目路径> --intent "<目标>" `
  --known-context-fingerprint <上次返回的 contextFingerprint>
```

### 执行修改

宿主先运行只读 `预检`，再以 `--operation write`（外部写入用 `external-write`）读取轻量上下文。结果为 `continuity=ephemeral` 且预检返回 `recommended=local-direct`（或干净隔离 Worktree 的 `current-worktree`）时，可实施最小 Diff 并只运行一次目标检查。Local 脏、被占用、存在已知并发或状态无法确认时，确定性升级到专属 Worktree。

轻量写入完成后必须原样回传同一次预检的完整 `directBaseline`，包括 HEAD、branch 或 detached 标识、`gitRoot` 和 `gitCommonDir`：

```powershell
node ./40-脚本/task.mjs 复核直达 --cwd <项目路径> `
  --baseline-head <预检 HEAD> --baseline-branch <预检 branch> `
  --baseline-git-root <预检 gitRoot> `
  --baseline-git-common-dir <预检 gitCommonDir> `
  --intent "<目标>" --scope <授权路径>
```

对 detached Worktree 传入 `--baseline-detached` 代替 `--baseline-branch`。终检会拒绝 HEAD/分支/detached 标识、`gitRoot`、`gitCommonDir` 或路径身份变化，因此同提交同分支的其他 clone 也不能通过；当前占用、Scope 越界、Manifest 实质风险或最终分类升级也失败关闭。它返回绑定 baseline identity 与不含 HEAD 的语义变更指纹的回执，本身不创建正式 Task、Evidence 或交付状态。

终检通过后默认形成只包含本次 Scope 的本地提交，并调用 `记录轻量交付` 写入最小结果事实；不进入正式 Task 或自动集成流程：

```powershell
git add -- <本次 Scope 内的精确文件>
git commit -m "<本次修改>"
node ./40-脚本/task.mjs 记录轻量交付 --cwd <项目路径> `
  --commit <当前 HEAD> --problem-type bugfix|feature|refactor|migration|integration|documentation|maintenance `
  --baseline-head <预检 HEAD> --baseline-git-root <预检 gitRoot> `
  --baseline-git-common-dir <预检 gitCommonDir> `
  --verified-change-fingerprint <复核直达回执中的语义指纹> `
  --scope <本次文件或目录>
```

终检回执只可绑定随后形成的单一本地提交；`记录轻量交付` 会同时复核完整 baseline identity 和语义指纹，不能只凭干净 HEAD/Scope 记成功，也不会执行 Push。若后续缺陷退回，修复并验证、提交后用回执中的原 `taskId` 再次记录，仍然只形成一个问题样本；空提交不算输入变化。

`tracked|handoff-required`、Controlled、Structural、规格/Decision、外部写入或跨仓任务才进入正式 Task：

先为每个正式写 Task 建立专属 Worktree。Codex 桌面端优先选择 managed Worktree；若宿主未能创建或识别，则使用下方 detached Worktree fallback，不能把正式 Task 改在 Local 中执行。

```powershell
node ./40-脚本/task.mjs 预检 --cwd <项目路径>

git worktree add --detach <任务路径> <起点>

node ./40-脚本/task.mjs 准备 --cwd <任务路径> --intent "<目标>" `
  --acceptance "<验收>" --scope "src" --scope "tests" --integration-target main `
  --model "<模型标签>" --reasoning-effort "<推理强度>" `
  --execution-environment "<执行环境>"

node ./40-脚本/task.mjs 交付 --task-id <编号>

# 可选：用户明确表达通过或退回时才记录强验收事实
node ./40-脚本/task.mjs 验收 --task-id <编号> --decision 通过|退回
```

`--model`、`--reasoning-effort` 和 `--execution-environment` 都是可选的低敏感评估标签；只在宿主确知时传入，未传入时保持 null，不猜测也不保存密钥或完整环境变量。

正式 Task 会在需要时自动生成 Goal Card、Change Rationale 和定点检查，并使用交付回执里的 continuation 回写每个不同的相关后续。用户只确认会改变业务结果、Scope、权限或外部影响的事项，不操作内部 JSON 文件，也不需要为正常完成再做一次形式确认。轻量直达不生成 Evidence 或正式 `waiting_acceptance`，只生成轻量结果记录。主 Local checkout 可承载合格的轻量直达和串行集成，但正式 Task 在主 checkout 准备仍会被拒绝；显式说“验收通过”才记录为 `accepted`，自然转入新话题只记录为 `closed`。

`预检` 只读且不加载工程上下文、不创建 Task；它为合格 `local-direct` 和干净 `current-worktree` 返回直达终检所需的 `directBaseline`。Local 直达还要求执行模型确认没有其他已知写入者；正式 `准备` 会在原子创建时复核。多个精确授权路径可重复传入 `--scope`。

### Worktree 交付与串行集成

```powershell
node ./40-脚本/task.mjs 准备 --cwd <任务路径> --intent "<目标>" `
  --acceptance "<验收>" --scope "." --integration-target main

# Worktree 中完成修改并提交后执行交付
node ./40-脚本/task.mjs 交付 --task-id <编号> --spec-impact none

# 单一集成者默认直接执行，无需等待用户再次确认
node ./40-脚本/task.mjs 集成 --task-id <编号>
```

`集成` 会按 Git Common Dir 和目标分支获取串行锁，在专用临时 Worktree 中把任务提交应用到最新目标 HEAD，重放交付检查，只有成功时才快进目标分支。之后清理待集成引用、任务分支以及已确认干净的任务 Worktree。若冲突，系统保留隔离集成 Worktree；解决冲突并提交后重新运行同一命令。

以下情况 fail closed 且不修改目标分支：目标 checkout 有未提交改动、冲突未解决或未提交、集成检查失败、目标 HEAD 竞态变化，以及 Controlled/Structural、规格待决策或有残余风险的任务。后一类只能在用户明确授权后使用 `--allow-risk-integration --risk-reason "<原因>"`。

为保留兼容路径，已经手工 merge/cherry-pick 的结果仍可以使用：

```powershell
node ./40-脚本/task.mjs 集成 --task-id <编号> --confirm-only --cwd <目标工作区>
```

目标 HEAD 后续变化时运行：

```powershell
node ./40-脚本/task.mjs 重验集成 --task-id <编号> --cwd <目标工作区>
```

### 状态与预算

```powershell
node ./40-脚本/task.mjs 列表
node ./40-脚本/task.mjs 查看 --task-id <编号>
node ./40-脚本/task.mjs 诊断状态
node ./40-脚本/task.mjs 保存 --task-id <编号>
node ./40-脚本/task.mjs 恢复 --task-id <编号>
node ./40-脚本/task.mjs 继续验证 --task-id <编号> `
  --additional-budget-ms 120000 --reason "用户批准继续"
node ./40-脚本/task.mjs 评估摘要 --from 2026-08-01 --to 2026-08-31 `
  --problem-type bugfix --quiet-days 7
```

新版结果口径为 `completion-rounds-v1`：一个问题只形成一个样本，完成轮次等于首次有效交付加相关追问、缺陷返回或显式退回次数。明确肯定、范围扩展或话题推进立即收口；没有后续的结果先观察，默认静默 7 天后计为一次完成。报告以一次、二次、三次和四次以上完成占比为主，按 `problemType` 分组；显式验收只作为次要可选事实。

新 Task 保存当时系统版本/Commit/脏状态、Node 运行时，以及宿主显式传入的模型、推理强度和执行环境。交付尝试、真实检查执行次数/耗时和阶段时间分开记录；列表和摘要按 `gitCommonDir` 归并 linked Worktree，只有已进入可验收交付的样本才可计入验收 unknown。显式验收是独立辅助事实，不替代完成轮次。

旧 Task 和旧结果不删除，但因缺少新版测量版本默认退出分母。普通问答和纯只读分析不创建结果样本；问题类型不明或显式排除的记录会报告排除原因。少于 10 个可比完成样本只能观察方向，形成稳定结论仍需 20～30 个真实任务和明确基线。

## 按需能力

以下能力保留，但不会进入所有任务的默认路径：

- `.ai/spec-map.json`：代码、规格、测试和 Decision 的确定性映射；
- `specImpact=updated|decision-required`：规格与架构决策门禁；
- 严格 Preservation：明确要求保持全部行为或参考实现等价时启用；
- Review Package：只有用户或项目显式要求 Review 时生成；
- Experience Candidate：只能从已验收 Task 按需整理，不自动晋升规则；
- Browser smoke：仅在可观察浏览器行为确实需要时执行；一 Check 一 flow，最多 4 条、单条 15 秒、整批 120 秒、外层 180 秒，首败熔断。当前同步 Runner 尚未实现 30 秒心跳/无输出终止，运行结果必须如实报告该 `unimplemented` 缺口。

系统不建设常驻验证器、密码学签名、企业审批流、通用沙箱或自动 Agent 编排平台。新机制必须由真实返工、误解、错误证明或状态失真驱动，并证明净收益。

## 验证

普通交付不运行下列全套档位；只执行受影响的定点检查。以下命令用于系统维护、独立回归或发布验证：

```powershell
node ./40-脚本/check-system.mjs
node ./40-脚本/verify-system.mjs --profile tests
node ./40-脚本/verify-system.mjs --profile baseline
node ./40-脚本/verify-system.mjs --profile release
```

CI 在 Windows/Linux 的 Node.js 20 和 22 上运行。发布清单不静态宣称技术门禁永久通过，每次发布仍需执行当前源码对应的验证命令。

## 目录导航

```text
00-大模型接入/   宿主接入与模型入口
10-注册表/       项目与模板身份
20-能力模块/     按需质量 Profile、Contract 与样板
30-知识库/       中央知识路由
40-脚本/         上下文、Task、验证和诊断工具
60-测试/         Core、Integration、Scenarios 测试
70-文档/         架构、可信门禁、兼容、Decision 与评估
80-运行记录/     本机 Task、Evidence 和发布运行产物
```

## 当前状态

当前版本定位为 `runnable-baseline`，不是长期 `stable`。是否升级由真实项目中的完成轮次、返工、门禁误报、集成后回归和上下文浪费决定，而不是由规则、文件或测试数量决定。
