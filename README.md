# AI 研发操作系统 V2.2.1

面向强推理模型的轻量可信软件生产内核。系统通过宿主自定义指令和根 `AGENTS.md` 接入 Codex、ChatGPT Code、Claude Code 等具备本地文件与终端能力的模型，不引入常驻服务。

## 核心闭环

```text
普通对话 → 直接回答
只读工程分析 → build-context
仓库写任务 → 准备 → 模型实现 → 验证与交付 → waiting_acceptance → 用户验收
外部写入 → 完整闭环 + 单独授权
```

可信内核硬控项目身份、Scope、用户已有改动、ChangeSet、Evidence、显式 Review、按需规格一致性、Handoff 和用户最终验收；模型仍自主理解、设计和实现。

## 轻量边界

- `build-context` 与 Task CLI 默认只返回当前执行所需的轻量视图；完整 Context、Task 账本和 Evidence 不删减，诊断或审计时使用 `--full`。
- `build-context` 默认返回已解析的 Manifest/机器配置摘要；原始机器配置仅在目标明确相关或使用 `--full` 诊断时展开，宿主已加载的系统入口不再重复读取。
- 系统验证默认聚合成功结果，失败诊断保持完整；需要逐条成功明细时使用 `verify-system.mjs ... --full`。
- 普通任务不生成 Review Package，只有显式要求或提供 Review 时才启用。
- 没有 `.ai/spec-map.json` 且 `specImpact=none` 时，详细规格追踪不进入 Task 主路径。
- 有规格映射或声明 `updated/decision-required` 时，规格与 Decision 门禁自动启用。
- 检查每次基于当前输入重新执行，不维护成功缓存；总验证预算和失败重试保护仍保留。
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
node ./40-脚本/task.mjs 验收 --task-id <编号> --decision 通过
```

以上命令默认输出轻量回执；需要检查完整 Task 时追加 `--full`。只读分析同样可用 `node ./40-脚本/build-context.mjs ... --full` 查看完整上下文。

项目可按需配置：

- `.ai/spec-map.json`：文件、规格、测试和 Decision 的确定性映射；
- `.ai/spec-policy.json`：规格一致性策略；
- `docs/modules/`：模块活规格；
- `.ai/30-经验/`：正式经验与候选草稿；
- `.ai/quality.json`：项目级 Contract 和 Canonical。

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
