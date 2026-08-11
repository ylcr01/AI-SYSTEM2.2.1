# AI 研发操作系统 V2.2.1

AI 研发操作系统 V2.2.1 是面向强推理模型的轻量可信软件生产内核。它通过宿主自定义指令和根 `AGENTS.md` 接入 Codex、ChatGPT Code、Claude Code 等具备本地文件与终端能力的模型，不引入常驻 Host Adapter。

## 核心闭环

```text
普通对话 → 直接回答
只读工程分析 → build-context
仓库写任务 → 准备 → 模型实现 → 验证与交付 → waiting_acceptance → 用户验收
外部写入 → 完整闭环 + 单独授权
```

系统硬控项目身份、Scope、用户已有改动、ChangeSet、Evidence、Review、Handoff、规格一致性和用户最终验收；模型仍自主理解、设计和实现。

## V2.2.1 修复与增强

### Evidence 可信边界

- `kind` 仅允许 `tool/self/user`；`source.type` 仅允许 `command/artifact/file/human`。
- Artifact 必须位于 Git Root 或显式允许目录内，符号链接逃逸会被拒绝。
- Artifact Evidence 必须绑定 SHA-256；内容变化后 Evidence 自动失效。

### Acceptance-aware 验证规划

检查规划不再只按全局 Cover 去重，而是同时按 `Acceptance ID + Cover` 计算缺口。两个验收项即使都要求 `behavior`，若分别绑定不同检查，也会选择两项检查。

### 规格追踪与 Decision

- `.ai/spec-map.json` 的规格、测试和 Decision Glob 会展开为真实文件。
- 所有映射路径必须位于仓库内，`../`、绝对路径和符号链接逃逸会被拒绝。
- `decision-required` 除了要求 Decision 文件变化，还校验 Front Matter：`id`、`status`、`affects`、`sourceTaskId`；`superseded` 还要求 `supersededBy`。
- 规格编排已从 `task-runner.mjs` 拆入独立 `spec-service.mjs`。

Decision 示例：

```markdown
---
id: DEC-ORD-007
status: proposed
affects:
  - order-cancellation
sourceTaskId: task-20260806-xxxx
---
```

### Experience Candidate

- Markdown 正式经验会真实参与解析和去重，不再被静默忽略。
- `insufficient` 候选默认不落盘；只有显式 `--allow-low-quality` 才可保留。
- 精确或高相似重复仍默认阻止写入。

## 大模型入口

```powershell
node ./40-脚本/configure-model-entry.mjs 生成
node ./40-脚本/configure-model-entry.mjs 检查
```

将“生成”输出粘贴到支持本地文件和终端的模型宿主自定义指令中。自定义指令本身不会给普通网页聊天授予本地权限。

## 任务命令

```powershell
node ./40-脚本/task.mjs 准备 --cwd <项目> --intent "<目标>" --acceptance "<验收>" --scope "."
node ./40-脚本/task.mjs 交付 --task-id <编号> --evidence-file <evidence.json>
node ./40-脚本/task.mjs 验收 --task-id <编号> --decision 通过
```

项目可选配置：

- `.ai/spec-map.json`：文件到 BR/TR/SC/EX、测试和 Decision 的映射；
- `.ai/spec-policy.json`：advisory / balanced / strict 门禁；
- `docs/modules/`：模块活规格；
- `.ai/30-经验/`：正式经验和候选经验。

整理经验：

```powershell
node ./40-脚本/task.mjs 整理经验 --task-id <已验收编号> `
  --root-cause "<根因>" --action "<动作>" --boundary "<边界>" `
  --keyword "关键词1,关键词2" --occurrence 2 --impact high
```

## 项目与整项目底座

注册表只保存身份和本机路径，不复制外部源码。项目模块通过 `templateId` 显式绑定整项目底座；上下文按“项目 → 底座 → 中央”取事实，并且每次最多读取两份命中任务关键词的底座资料。

```powershell
node ./40-脚本/manage-registry.mjs list
node ./40-脚本/manage-registry.mjs validate
node ./40-脚本/manage-registry.mjs help
```

## 验证

```powershell
node ./40-脚本/check-system.mjs
node ./40-脚本/verify-system.mjs --profile tests
node ./40-脚本/verify-system.mjs --profile release
```

以上入口只依赖 Node.js；安装了 npm 时，仍可使用对应的 `npm run` 别名。

当前状态为 `runnable-baseline`。长期 `stable` 仍需 20～30 个真实项目任务验证。
