# Claude Code 接入说明

Claude Code 可通过全局或项目级 `CLAUDE.md` 引用 AI 研发操作系统：

```markdown
Before any repository-dependent action, resolve `AI_RD_OS_ROOT` and read its `AGENTS.md`.
Follow its conversation routing and Task lifecycle. Do not edit before `准备`, and do not accept tasks for the user.
```

项目中仍可保留自己的 `CLAUDE.md`，但项目规则不得降低 Scope、Evidence、Review、状态真实性和用户验收门禁。
