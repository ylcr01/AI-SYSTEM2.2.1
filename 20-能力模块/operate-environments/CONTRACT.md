---
id: operations-change
version: 2
status: active
artifactKinds: [operations]
---

# 环境与运维 Contract

## 三种模式
- observe：只读状态、日志、版本和健康。
- plan：形成变更、验证和回滚方案。
- execute：实际发布、重启、迁移、配置或回滚。

## 强制边界
- execute 必须针对具体动作、目标和范围取得独立授权。
- 凭据不进入提示、日志、文档或 Git。
- 自动检查不得伪装部署、重启、迁移、SSH 写入或外部副作用。
- 执行前记录基线、失败条件和回滚；执行后核验版本、健康、日志和关键业务探针。

## 结果
明确已执行、未执行、失败、回滚和残留风险，不用“命令已运行”代替健康结果。
