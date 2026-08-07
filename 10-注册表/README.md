# 注册表

注册表只保存项目、模块、底座和本机路径的身份关系，不保存外部源码，也不决定工程方案。

身份由登记路径、Git Root、Remote 和 Subpath 联合确认。冲突时停止，不扫描磁盘猜测。

- `projects.json`：项目和模块身份。
- `templates.json`：整项目底座身份、入口和质量清单。
- `local.paths.json`：本机绝对路径，被 Git 忽略。
- `local.paths.example.json`：可提交示例。
