# 注册表

注册表只保存项目、模块、底座和本机路径的身份关系，不保存外部源码，也不决定工程方案。

本地模板以登记路径和独立 Git Root 确认身份，使用 `repository: null` 明确声明没有远程仓库。远程仓库模板在此基础上继续校验 Remote；项目模块还会校验 Subpath。冲突时停止，不扫描磁盘猜测。

模板只在项目模块显式绑定 `templateId` 后为该项目提供工程样板；未绑定模板的项目仍以自身入口和现有代码为事实，中央通用样板只作兜底参考。

- `projects.json`：项目和模块身份。
- `templates.json`：整项目底座身份、入口和质量清单。
- `local.paths.json`：本机绝对路径，被 Git 忽略。
- `local.paths.example.json`：可提交示例。
