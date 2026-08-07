# Codex 接入说明

1. 设置环境变量：

```powershell
$env:AI_RD_OS_ROOT = "D:\你的路径\AI-SYSTEM-V2.2.1"
```

需要长期保存时，在 Windows 用户环境变量中创建同名变量。

2. 运行入口检查：

```powershell
node "$env:AI_RD_OS_ROOT\40-脚本\configure-model-entry.mjs" 检查
```

3. 运行 `生成` 命令，将输出粘贴到 Codex/ChatGPT Code 的自定义指令。

4. 在具体项目中可选运行：

```powershell
node "$env:AI_RD_OS_ROOT\40-脚本\configure-model-entry.mjs" 初始化项目 --cwd "D:\项目路径"
```

这只创建一个短 `AGENTS.md` 导航文件，不会生成完整文档脚手架。

## 行为预期

- “解释这段代码”属于只读分析，模型应调用 `build-context.mjs`。
- “修复这个 Bug”属于写任务，模型应先调用 `task.mjs 准备`。
- 交付后模型只能报告 `waiting_acceptance` 并请求用户验收，不能替用户执行“通过”。
