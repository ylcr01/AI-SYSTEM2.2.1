# AI 研发操作系统 V2.2.1

面向强推理模型的轻量可信软件生产内核。系统通过宿主自定义指令和根 `AGENTS.md` 接入 Codex、ChatGPT Code、Claude Code 等具备本地文件与终端能力的模型，不引入常驻服务。

## 核心闭环

```text
普通对话 → 直接回答
只读工程分析 → build-context
主工作区写任务 → 准备 → 模型实现 → 验证与交付 → waiting_acceptance → 用户验收
并行 worktree → 准备（声明目标分支）→ 提交 → ready_to_integrate → 单一集成者 → waiting_acceptance → 用户验收
外部写入 → 完整闭环 + 单独授权
```

可信内核硬控项目身份、Scope、用户已有改动、ChangeSet、Evidence、显式 Review、按需规格一致性、Handoff 和用户最终验收；模型仍自主理解、设计和实现。

## 可信边界

AI-SYSTEM 的可信目标是防止模型误判、状态失真、Evidence 过期、Scope 越界、覆盖用户改动等工程错误，并把系统亲自执行产生的 Evidence 与外部导入 Evidence 分开计算可信等级。当前无常驻 Host Adapter 的架构不把宿主模型视为恶意攻击者；“用户验收只能由用户产生”由宿主协议与 Task 状态门禁共同保证，本版本不提供密码学意义上的 Human Identity Attestation。

## 轻量边界

- `build-context` 与 Task CLI 默认只返回当前执行所需的轻量视图；完整 Context、Task 账本和 Evidence 不删减，诊断或审计时使用 `--full`。
- `task.mjs 列表` 默认只看当前 Git 项目并返回最近更新的 10 条；使用 `--limit <数量>` 调整数量，`--limit 0` 查看全部，`--all-projects` 显式查看所有项目。
- 中央能力 `SKILL.md` 默认只参与能力识别，不进入 `filesToRead`；只有显式传入 `--skill <名称>` 时才加载正文。
- `build-context` 默认返回已解析的 Manifest/机器配置摘要；原始机器配置仅在目标明确相关或使用 `--full` 诊断时展开，宿主已加载的系统入口不再重复读取。
- 系统验证默认聚合成功结果，失败诊断保持完整；需要逐条成功明细时使用 `verify-system.mjs ... --full`。
- 普通任务不生成 Review Package，只有显式要求或提供 Review 时才启用。
- 没有 `.ai/spec-map.json` 且 `specImpact=none` 时，详细规格追踪不进入 Task 主路径。
- 有规格映射或声明 `updated/decision-required` 时，规格与 Decision 门禁自动启用。
- 检查每次基于当前输入重新执行，不维护成功缓存；总验证预算和失败重试保护仍保留。
- 所有验证预算均为有限值；预算耗尽后只能由用户说明原因并追加明确的毫秒数，不存在无限继续开关。
- Experience Candidate 只从已验收 Task 生成 Markdown 草稿，仅做精确指纹查重，由用户人工决定是否晋升。
- 发布 Inventory 按需生成到 `80-运行记录/release/`，不作为源码提交。

## 大模型入口

```powershell
node ./40-脚本/configure-model-entry.mjs 生成
node ./40-脚本/configure-model-entry.mjs 检查
```

具体宿主和权限边界见 `00-大模型接入/接入说明.md`。

## 任务命令

```powershell
node ./40-脚本/task.mjs 准备 --cwd <项目> --intent "<目标>" --acceptance "<验收>" --scope "."
node ./40-脚本/task.mjs 交付 --task-id <编号> --spec-impact none|updated|decision-required
node ./40-脚本/task.mjs 集成 --task-id <编号> --cwd <目标工作区>
node ./40-脚本/task.mjs 重验集成 --task-id <编号> --cwd <目标工作区>
node ./40-脚本/task.mjs 继续验证 --task-id <编号> --additional-budget-ms 120000 --reason "用户批准继续"
node ./40-脚本/task.mjs 验收 --task-id <编号> --decision 通过
```

## 并行写隔离

同一项目只有一个写任务时可直接使用 Local/主工作区。存在两个及以上并行写任务时，每个任务必须在准备前分配独立 Worktree；Local/目标分支工作区只保留一个写任务或负责串行集成。工作站是长期业务身份，Worktree 是单次写任务的临时执行环境，不能让多个并行写任务共享永久 Worktree。

Codex 桌面端优先在新建任务时选择“Worktree”，使用任务专属 managed Worktree；Codex 默认以 detached HEAD 创建这类工作树。其他宿主使用 `git worktree add --detach`，不提前创建功能分支。Codex 的当前操作方式见 [Git worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)。

```powershell
git worktree add --detach <新路径> <起点>
node ./40-脚本/task.mjs 准备 --cwd <新路径> --intent "<目标>" --acceptance "<验收>" --scope "." --integration-target main
```

worktree 内的任务必须先提交。可信交付会记录 `baseCommit`、`resultCommit` 和集成目标，并用 `refs/ai/pending/<taskId>` 保活待集成提交。中央工作区完成 merge 或 cherry-pick 后运行 `集成`：merge 必须使原提交可达；cherry-pick 必须能证明从 `baseCommit` 到 `resultCommit` 的每个补丁都有等价提交。用户验收要求目标分支 HEAD 与已确认提交完全一致；若目标 HEAD 后续变化，必须在干净的目标工作区运行“重验集成”，重新执行必要检查并生成绑定新 HEAD 的 Integration Evidence，之后才能验收。

`needs_rework` 仍属于活动写状态，避免失败后的未提交改动被其他任务覆盖。若暂不继续，运行 `task.mjs 保存 --task-id <taskId>` 显式释放该工作树；`恢复` 时系统重新检查是否已有其他写 Task 占用。系统不自动创建、移动或删除命令行 worktree。

以上命令默认输出轻量回执；需要检查完整 Task 时追加 `--full`。只读分析同样可用 `node ./40-脚本/build-context.mjs ... --full` 查看完整上下文。

项目可按需配置：

- `.ai/spec-map.json`：文件、规格、测试和 Decision 的确定性映射；
- `.ai/spec-policy.json`：规格一致性策略；
- `docs/modules/`：模块活规格；
- `.ai/30-经验/`：正式经验与候选草稿；
- `.ai/quality.json`：项目级 Contract 和 Canonical。

## 项目业务工作站

中央系统保存工作站方法、模板与命令；每个项目将自身的领域索引、业务档案和运行手册保存在 `.ai/workstations/`。工作站是用户可直接对话的长期业务身份，不是目录权限，也不永久绑定对话、分支或 Worktree。

```powershell
node ./40-脚本/workstations.mjs 分析 --cwd <项目>
node ./40-脚本/workstations.mjs 初始化 --cwd <项目> --plan <已确认方案.json> --confirm-plan
node ./40-脚本/workstations.mjs 检查 --cwd <项目>
node ./40-脚本/workstations.mjs 路由 --cwd <项目> --intent "修复订单退款问题"
```

上下文按“索引 → 共享规则 → 唯一命中的领域档案 → 写任务运行手册 → 当前代码”加载；多领域同分时使用 `--workstation <id>` 显式选择。初始化拒绝覆盖已有目录，档案全部按当前提交复核后才可运行 `刷新 --confirm-reviewed`。

整理经验：

```powershell
node ./40-脚本/task.mjs 整理经验 --task-id <已验收编号> `
  --root-cause "<根因>" --action "<动作>" --boundary "<边界>" `
  --keyword "关键词1,关键词2"
```

## 模板与真实项目

注册表只保存身份和本机路径，不复制外部源码。项目模块通过 `templateId` 绑定整项目底座，上下文按“项目 → 底座 → 中央”读取最少相关资料。

```powershell
node ./40-脚本/manage-registry.mjs list
node ./40-脚本/manage-registry.mjs validate
```

中央能力的样板统一登记在 `20-能力模块/manifest.json`。新增样板由维护者人工确认并登记，系统按任务和关键词自动路由；只有同一能力出现多个稳定且适用条件不同的真实范式时才扩展。

## 验证

```powershell
node ./40-脚本/check-system.mjs
node ./40-脚本/verify-system.mjs --profile tests
node ./40-脚本/verify-system.mjs --profile release
```

当前状态仍为 `runnable-baseline`。是否升级为长期 `stable`，以真实项目中的退回、返工、门禁误报和接续效果为依据。
