---
id: DEC-LIGHTWEIGHT-CORRECTION-CORE-001
status: accepted
affects:
  - ARCH-CORE-SLIMMING
  - ARCH-TRUST-GATES
  - ARCH-WORKTREE-INTEGRATION
sourceTaskId: task-20260820045742080-ff354735
supersedes: []
---

# 轻量交付纠偏内核与显式证明边界

## 背景

真实运行记录显示，系统的主要风险不是缺少更多流程，而是通用检查被误当成验收证明、Task Check 可携带任意命令、手工“输入变化”可清除失败，以及 Worktree 首次集成未绑定目标 HEAD 重验。这些问题会产生错误证明和状态污染。

## 决定

- 内核只负责 Goal、Scope/ChangeSet、用户已有改动隔离、定点验证、Worktree 集成新鲜度与用户最终验收。
- 通用检查默认不绑定 Acceptance；删除 `matching-covers` 和 `all` 的自动归因能力，只有 `explicit` 显式 ID 可以形成验收证明。
- Task Check 改为白名单 Runner 模型，当前只支持 `node-test`；调用方不得提供任意 command、args 或 sideEffect。
- 保存可重放 Check Manifest，固化检查定义、Runner 版本与测试文件哈希；首次集成确认和后续目标 HEAD 重验都重放该 Manifest。
- `forcedMode` 只能向上加强。删除文本式 input-change 逃生口；真实 ChangeSet 或正式重新对齐才改变验证依据。
- Task Schema V8 将写作态、待验收和历史记录分层；诊断命令保持只读，测试使用独立临时状态根。
- Review Package 与 Experience Candidate 不进入默认 Task 结构，只在明确触发时出现。

## 不采用

不增加常驻守护进程、签名/HMAC、企业审批流、通用沙箱或自动修复账本。没有真实净收益证据的机制保持按需或不实现。

## 验证

核心测试覆盖 Runner 拒绝路径、显式 Acceptance、Manifest 哈希、向下强制模式拒绝、状态分层与只读诊断；集成测试覆盖目标 HEAD 上的 Manifest 重放。CI 在 Windows/Linux 的 Node 20 与 22 运行。

## 回滚

如真实任务证明某个收缩点造成可测量退化，只恢复对应的独立能力，不把整套机制重新放回默认路径。
