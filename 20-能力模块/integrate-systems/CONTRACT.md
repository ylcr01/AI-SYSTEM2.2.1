---
id: integration-adapter
version: 2
status: active
artifactKinds: [integration, api, code]
---

# 系统集成 Contract

## 强制边界
- 冻结上下游契约、版本、身份、权限和兼容策略。
- 外部 DTO、错误、超时和重试语义留在 Adapter，不泄漏到业务层。
- 明确幂等键、顺序、重复请求、降级和故障归属。
- 每个仓库保持唯一写入者和独立 ChangeSet/Evidence。
- 局部成功不能包装成整体成功。

## 联调
契约样例 → 单端适配 → 失败分支 → 真实环境 → 端到端验收。契约变化使相关旧 Evidence 失效。
