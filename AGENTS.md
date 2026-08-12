# AI 研发操作系统 V2.2.1 大模型入口与可信执行规则

本文件是支持本地文件和终端执行的大模型宿主（ChatGPT Code、Codex、Claude Code 等）进入 AI 研发操作系统的全局入口。

## 一、先判断对话类型

### 1. 普通对话

适用：通用知识问答、写作、翻译、头脑风暴，且答案不依赖本地仓库事实。

处理：直接回答，不创建 Task，不运行工程脚本。

### 2. 只读工程分析

适用：解释代码、分析架构、查找实现、评审但不修改仓库。

处理：先运行：

```powershell
node "$env:AI_RD_OS_ROOT\40-脚本\build-context.mjs" --cwd "<项目路径>" --intent "<用户目标>"
```

读取轻量输出中的 `executionTarget`、`classification` 与 `filesToRead` 后再分析。只有身份或路由需要诊断时才追加 `--full`；不得修改仓库。

### 3. 仓库写任务

适用：修改代码或文档、修复 Bug、新增功能、重构、调整配置或测试。

在任何编辑前必须运行：

```powershell
node "$env:AI_RD_OS_ROOT\40-脚本\task.mjs" 准备 --cwd "<项目路径>" --intent "<目标>" --acceptance "<验收>" --scope "<授权路径>"
```

保存轻量回执中的 `taskId`，读取 `filesToRead` 和授权 Scope，再自主分析和实现。完整 Task 已写入 `recordPath`；只有诊断或审计时才追加 `--full`。

修改后必须运行：

```powershell
node "$env:AI_RD_OS_ROOT\40-脚本\task.mjs" 交付 --task-id "<taskId>"
```

只有返回状态为 `waiting_acceptance` 时，才可以向用户说明已完成工程交付并请求验收。模型不得替用户运行“验收通过”。

### 4. 外部写入或高风险动作

适用：Push、发布、部署、迁移、远程删除、生产数据修改、外部系统写入。

处理：必须单独获得用户明确授权；准备 Task 不等于获得外部动作授权。没有授权时只制定方案或停在执行前。

安全、认证、授权、隐私、数据迁移、不可逆操作、生产和发布还必须覆盖拒绝路径、数据前后、失败停止条件与可执行回滚。自动检查不得伪装成部署、重启、迁移或其他外部副作用。

## 二、权威顺序

1. 用户本次明确目标、验收和授权；
2. 当前运行结果、代码、配置、Manifest 和 Git 状态；
3. 用户确认后的模块活规格；
4. 项目 Contract 与 Active Canonical；
5. 绑定底座；
6. 中央 Contract、Canonical 和经验；
7. 普通历史代码。

代码说明当前实现，模块规格说明确认后的目标业务；二者冲突时不得静默选择。

## 三、specImpact

写任务在准备或交付时必须按实际情况声明：

- `none`：实现变化，不改变确认后的业务规则；
- `updated`：业务规则或模块规格发生变化，ChangeSet 必须包含对应规格更新；
- `decision-required`：重大业务或架构取舍，ChangeSet 必须包含 Decision。

示例：

```powershell
node "$env:AI_RD_OS_ROOT\40-脚本\task.mjs" 交付 --task-id "<taskId>" `
  --spec-impact updated `
  --spec-impact-reason "新增订单退款状态" `
  --spec-id "BR-ORD-004,TR-ORD-006"
```

如果项目存在 `.ai/spec-map.json`，系统会将 Changed Files 映射到 BR/TR/SC/EX ID，并在交付时执行规格一致性检查。

## 四、Experience Candidate

只有用户已经验收通过的 Task 才能生成 Experience Candidate：

```powershell
node "$env:AI_RD_OS_ROOT\40-脚本\task.mjs" 整理经验 --task-id "<accepted-task-id>" `
  --root-cause "<已确认根因>" `
  --action "<以后应采取的动作>" `
  --boundary "<适用边界>" `
  --keyword "<关键词1>,<关键词2>"
```

系统生成 Markdown 候选并执行精确指纹查重；不会自动评分，也不会自动升级 Contract、Canonical、Skill、Prompt、模板或中央经验。

## 五、不可绕过规则

- 不猜项目、Scope、权限和外部动作授权。
- 保持满足目标的最小必要 ChangeSet。
- 交付前根据真实 ChangeSet 重新评估风险和 specImpact。
- Evidence 必须绑定当前 Task、ChangeSet、输入周期、Acceptance 和 Covers。
- 相同输入失败不机械重跑；检查改变工作区后旧 Evidence 失效。
- 自检不能伪装成独立审查。
- 只有用户可以最终验收。
- 不因自定义指令存在而假设宿主具备本地文件、终端或部署权限。
