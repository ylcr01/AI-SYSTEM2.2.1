# Skill、Contract、Verification 与 Canonical

- `SKILL.md`：短方法入口，只说明何时使用和读取什么。
- `CONTRACT.md`：领域工程不变量、默认职责和偏离边界。
- `VERIFICATION.md`：可能需要证明的行为和质量维度。
- `样板/索引.json`：可验证的 Canonical 索引。

默认路由：

```text
none/local      → 项目事实 + 目标代码，不加载 Canonical
structural      → 一个最相关 Contract + 最多一个 Active Canonical
```

质量权威顺序：项目 → 绑定底座 → 中央。普通历史代码只用于认识现实，不自动成为范式。
