# 11: 安全排空运行中的服务

**What to build:** 本地服务停止时停止接收新回合，让活动案件在 LangGraph checkpoint 边界安全完成并持久化，再关闭偏好 Store；重启后可以继续活动案件。用户主动取消与服务排空拥有不同状态和消息语义。

**Blocked by:** 04

**Status:** resolved

**Labels:** ready-for-agent

- [x] 服务进入排空状态后拒绝新回合，同时允许已接收回合到达安全 checkpoint 边界。
- [x] 用户取消仍通过 `AbortSignal` 立即传播，不等待排空超时。
- [x] 排空超时、活动回合完成和 Store 关闭均有明确状态与安全日志。
- [x] 重启后使用同一 thread 恢复，不重复工具副作用或最终报告。
- [x] HTTP/SSE 测试区分用户取消、正常完成和服务排空。
- [x] `RunControl` 不进入 checkpoint，也不被当作案件事实或长期偏好。

## Answer

完成。`preClose` 停止接收新回合并请求 `RunControl` 在图安全边界排空；只有成功排空后才关闭 checkpoint 与偏好 Store，超时保留 Store 并记录活动回合数。服务排空通过 `service_draining`/503 表示，用户取消仍由 `AbortSignal` 立即传播。`service-drain.test.ts` 使用真实 SQLite checkpoint 和 Fastify `preClose` 完成关闭重开，恢复同一案件且不重复候选读取；HTTP/SSE 测试区分取消与排空终态。
