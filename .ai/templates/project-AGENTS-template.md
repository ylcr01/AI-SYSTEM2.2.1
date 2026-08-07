# Project AI Entry

- 先解析 `AI_RD_OS_ROOT` 并读取其 `AGENTS.md`。
- 普通问答不建立 Task；只读分析构建 Context；仓库写任务先准备、后交付。
- 模块规格位于 `docs/modules/`（存在时按目标模块读取）。
- 规格映射位于 `.ai/spec-map.json`，规格策略位于 `.ai/spec-policy.json`。
- 项目经验位于 `.ai/30-经验/`，只读取当前任务相关条目。
- 代码与规格冲突时不得静默选择；最终验收只能由用户执行。
