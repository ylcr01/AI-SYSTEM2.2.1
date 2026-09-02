# AI 研发操作系统 V3.0.0

面向强 Coding Agent 的轻量事实与安全层。系统不替代模型、Codex、Git 或项目自己的工程体系。

## 第一原则

> 系统负责提供事实和守住不可越过的边界；模型负责研发。

模型自主决定需求理解、上下文、文件与范围、实现方式、测试和构建、异常路径、Worktree、架构与规格影响、交付时机及是否继续探索。中央系统不得通过语义分类把这些判断转换成 Task、Scope、Evidence、自动检查、提交或集成流程。

系统仅保留：

- 仓库和写入目标事实；
- 用户已有改动与真实并发保护；
- 用户明确文件边界；
- 外部、生产和不可逆操作授权；
- Git Diff 与验证结果真实性；
- 默认不 Push。

## 工作方式

```text
用户目标 + 项目事实
        ↓
    模型自主研发
        ↓
真实 ChangeSet + 如实验证说明
```

普通任务没有中央预检、Context Builder、Task、Goal Card、Scope、Evidence、Rationale、Check Manifest、结果账本或集成状态机。模型可以直接使用 Git、搜索、项目命令和宿主工具；是否使用由模型结合当前目标判断。

## 可选事实工具

```powershell
# 生成宿主 bootstrap 或初始化轻量项目入口
node ./40-脚本/configure-model-entry.mjs 生成
node ./40-脚本/configure-model-entry.mjs 初始化项目 --cwd <项目路径>

# 维护本机项目/模板注册表
node ./40-脚本/manage-registry.mjs --help

# 在模型认为需要时显式映射或检查规格
node ./40-脚本/spec-map.mjs --cwd <项目路径> --changed-file <相对路径>
node ./40-脚本/spec-consistency.mjs --cwd <项目路径> --changed-file <相对路径> --spec-impact <none|updated|decision-required>
```

这些工具只返回事实或执行显式请求，不决定研发流程。

## 资料

- [架构与原则](70-文档/10-架构与原则.md)
- [可信边界](70-文档/20-可信门禁.md)
- [系统演进准入](70-文档/55-系统演进准入.md)
- [模型自主执行决定](70-文档/decisions/DEC-MODEL-AUTONOMY-EXECUTION-001.md)

`80-运行记录` 中的旧 Task/Evidence 数据仅作为历史证据保留，不再驱动当前研发流程。
