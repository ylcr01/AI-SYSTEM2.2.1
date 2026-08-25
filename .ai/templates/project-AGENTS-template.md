# Project AI Entry

- 先解析 `AI_RD_OS_ROOT` 并读取其 `AGENTS.md`；Task、Worktree、Scope、Evidence 与验收规则只由中央入口定义，本文件不得复制或放宽。
- 本文件只登记当前项目特有的目录、规格、命名、命令与 Contract。
- 模块规格位于 `docs/modules/`（存在时按目标模块读取）。
- 规格映射位于 `.ai/spec-map.json`，规格策略位于 `.ai/spec-policy.json`。
- 项目经验位于 `.ai/30-经验/`，只读取当前任务相关条目。
- 代码任务遵循中央 lightweight quality baseline；项目自己的结构、命名和 Contract 高于中央默认。
- 代码与规格冲突时不得静默选择；最终验收只能由用户执行。
