# 05: 通过脱敏 checkpoint 历史检查案件

**What to build:** 增加由已编译图 `getStateHistory()` 支撑的 `inspectCaseRun()`，让维护者能查看案件运行的 checkpoint 步骤、活动节点、中断、失败类别和候选统计，而不会看到提示词、原始证据、异常、凭据或模型推理。

**Blocked by:** 04

**Status:** resolved

**Labels:** ready-for-agent

- [x] `inspectCaseRun()` 按 thread 与数量限制返回稳定排序的 checkpoint 摘要。
- [x] 摘要只包含白名单字段：步骤、下一节点、是否中断、动作、阶段、候选数、评估数和安全失败类别。
- [x] 不返回完整 checkpoint 值、原始球员记录、供应商载荷、异常正文、提示词、token 或隐藏推理。
- [x] 正常运行、中断、恢复、可重试失败和最终失败均有完整图或 HTTP 链路验证。
- [x] 该审计接口可供评测 CLI 复用；本工单不新增公开审计页面。

## Answer

完成。`inspectCaseRun()` 从编译图 checkpoint 历史生成稳定、限量的白名单摘要，未公开案件审计路由。原生策略、规划快照、恢复和排空测试覆盖正常、中断、恢复、重试与最终失败状态；摘要测试确认不含异常正文、原始记录或 token。
