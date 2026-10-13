# Recover bounded FPL transport failures before LangGraph replans

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Let a transient Fantasy Premier League network or timeout failure recover once before the cached repository failure is returned to the Agent, while preserving the distinction between source failure and a successful empty candidate search.

## Acceptance criteria

- [x] FPL retries a network or timeout failure at most once with a short bounded delay.
- [x] HTTP denial, rate limiting, redirects, malformed payloads, and other non-transport failures are not retried.
- [x] A second transport failure remains a visible candidate-query failure and is cached for the existing cooldown.
- [x] If FPL candidate discovery still fails before any successful query in the turn, LangGraph ends that path without asking the Planner to retry search or evaluate unavailable candidates.
- [x] Harness accepts this fallback only when the final report says the matching status is unknown and does not interpret the failure as zero matches.
- [x] A deterministic FPL provider test verifies recovery and retry boundaries.
- [x] A complete local-model Harness run verifies a non-empty data repository → LangGraph → Reviewer/report path after the change; live FPL availability is recorded separately.
- [x] Record the observed trace and Harness outcome without treating a failed source query as zero candidates or claiming recommendation quality.

## Comments

- 2026-10-08：最新宽范围 FPL Harness 重放遇到一次候选查询传输失败；Planner 随后重复方法资料检索，Harness 正确拒绝该次运行。短范围对照能够到达报告。当前 FPL provider 会缓存失败结果，但尚未在首次缓存前做与 ASA 一致的有界网络/超时重试。
- 2026-10-08：新增 FPL transport 重试与图内早停后再次启动真实整链验收；外部候选查询仍失败，Planner 又尝试无候选评估。为避免把运行预算花在重复模型回合，已在第 10 步停止本次无效重放；更新 LangGraph 失败收束策略和 Harness 报告断言后需要重新验收。
- 2026-10-08：定向 provider 测试覆盖临时网络失败恢复、超时两次封顶和 403/429/重定向/坏响应不重试；FPL LangGraph 失败夹具确认 Planner 只调用两次，随后图内直接生成“匹配未知”报告；Harness 55/55 与生产构建通过。整条 live-model Harness 仍需完成最终报告阶段。
- 2026-10-08：完成两条本地模型整链复验。FPL 在线源的候选查询仍遇到网络失败；其失败报告路径保持“匹配状态未知”，不写成零候选，Harness 通过。另用本地 Wyscout 2017/18 数据仓库走通成功数据路径：Qwen 3.5 9B 经 LangGraph 做 5 次 Planner 决策和 10 次工具调用，读取 60 条候选、评估 30 人，经 Reviewer 生成报告；28/28 Harness 检查通过（230.384 秒）。这证明仓库到报告的图链路，不证明当前 FPL 在线恢复或推荐排序质量。

## Answer

FPL 数据提供器现在会对网络或超时错误做一次有界重试；拒绝、限流、重定向和无效响应不会重试，二次传输错误会按既有冷却机制缓存。本轮没有把 FPL 上游持续网络失败伪装成空候选。确定性重试测试、图内失败收束测试及失败路径 Harness 均通过；此外，成功的本地 Wyscout 仓库链路已从候选查询走到 Reviewer 与报告并通过全部 28 项 Harness 检查。FPL 实时源在当前环境中的成功请求恢复仍受上游网络状态限制。
