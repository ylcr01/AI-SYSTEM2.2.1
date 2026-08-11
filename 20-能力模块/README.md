# Skill、Contract 与 Canonical

- `SKILL.md`：短方法入口，只说明何时使用和读取什么。
- `CONTRACT.md`：领域工程不变量、默认职责、偏离边界和验证维度。
- `样板/*.md`：可读取的 Canonical 内容。
- `manifest.json`：能力与样板的唯一中央索引；人工登记，程序自动路由。

同一能力只有一个稳定范式时直接维护当前样板。只有出现两个以上经真实项目验证、适用条件不同且需要自动选择的范式时，才向该能力的 `exemplars` 数组追加登记；无需改变加载器或目录结构。

默认路由：

```text
none/local      → 项目事实 + 目标代码，不加载 Canonical
structural      → 一个最相关 Contract + 最多一个 Active Canonical
```

质量权威顺序：项目 → 绑定底座 → 中央。普通历史代码只用于认识现实，不自动成为范式。
