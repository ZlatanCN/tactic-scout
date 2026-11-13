# 05: 大 lookup 结果与已保存追问有界交付

Status: resolved
Blocked by: 03
Parent: [运行时上下文管理](../spec.md)

**What to build:** 球探查询或追问一名已解析球员时，程序从完整结果选择并分批提供所需证据，在有界模型输入中回答；数据来源与身份不变，未进入本批的字段仍可从原结果回读。

## Acceptance criteria

- [x] Scouting evidence projection 保留结果 digest、精确记录引用、所选字段、覆盖与剩余范围；大结果通过程序安排选择 / 分批 / 回读，所有新增模型调用计额外。
- [x] AI tool calls / ToolMessage 的有效配对、tool_call_id、已解析来源 ID、canonical / unlinked 关系、显式 / 默认赛季和三次搜索上限保持。
- [x] 区分有值、来源 null、未选择、unavailable 和 not-queried；省略字段不能被说成来源缺失，实际赛事 / 赛季及 FM 与表现来源边界正确。
- [x] Saved lookup 使用原快照 / 日期，不再次查询 provider；回读已保存证据不伪装为新搜索。
- [x] 额度耗尽且完整数据已有时程序完整展示数据 / 来源并标解释未完成；数据不完整时报告范围，不捏造完整事实。
- [x] 同票交付实际模型证据和确定性渲染证据的 collector 支持；完整图用大结果、窄字段追问和缺失状态验证，无需新通用检索工具。

## Blocked by

- [03: 一次自动文字压缩后完成任务并记住额度](03-compact-text-with-durable-allowance.md)

## Spec coverage

规格用户故事：4, 12, 13, 14, 15, 21, 22, 23, 24, 30, 51, 52, 56, 58, 59。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
- 2026-11-10：实现完成。Lookup 结果现按不超过两条记录组织 evidence batches；完整快照、digest、来源范围和批次进度写入 thread State，共用 03 的 durable allowance 与 reservation。已保存追问和多批次执行结果不重查 provider；工具模型输入保留 AI tool call / ToolMessage 配对及 `tool_call_id`，并只发送当前投影。额度耗尽或解释失败时返回完整已验证结果和来源，并标明解释未完成。Evaluation collector 现在分别记录模型收到的批次证据与程序渲染的完整结果。
- 2026-11-10：验证通过：类型检查、Ultracite、lookup 投影 / 多批次 / 缺失状态 / 额度耗尽全图用例、managed Dev Server 重启与 reservation 恢复、evaluation runner 文件（45/45）、以及最终全量测试（463/463）。新额度的明确继续与跨请求续接仍由票据 [11](11-continue-exhausted-context-processing.md) 负责。
- 2026-11-14 follow-up：compiled lookup graph 在同轮收到与成功搜索完全相同的 tool call 时复用已有结果，不重查 provider，并追加按新 `tool_call_id` 配对的 `ToolMessage`；非重复请求仍通过既有三次搜索 guard。Evidence prepare、batch answer 与当前结果验证均使用 source hash 匹配的 compacted scouting instruction，避免“继续”轮重新注入超长原文。完整长指令续接语义 smoke `4eedfbd9-4896-4142-bb86-797c31b26e31` 通过，所有来源 / 赛季 / 必需事实检查通过；最终全量测试 146 文件 / 544 用例通过。
