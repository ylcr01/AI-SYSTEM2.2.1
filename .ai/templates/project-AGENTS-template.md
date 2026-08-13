# Project AI Entry

- 先解析 `AI_RD_OS_ROOT` 并读取其 `AGENTS.md`。
- 普通问答不建立 Task；只读分析构建 Context；仓库写任务先准备、后交付。
- 模块规格位于 `docs/modules/`（存在时按目标模块读取）。
- 规格映射位于 `.ai/spec-map.json`，规格策略位于 `.ai/spec-policy.json`。
- 项目经验位于 `.ai/30-经验/`，只读取当前任务相关条目。
- 业务工作站索引位于 `.ai/workstations/index.json`；存在时先读索引，只加载显式指定或任务唯一命中的单个领域档案。领域是默认专业归属，不是路径权限。
- 代码与规格冲突时不得静默选择；最终验收只能由用户执行。
