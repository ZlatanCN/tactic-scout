# 05: 大 lookup 结果与已保存追问有界交付

Status: open
Label: ready-for-agent
Blocked by: 03
Parent: [运行时上下文管理](../spec.md)

**What to build:** 球探查询或追问一名已解析球员时，程序从完整结果选择并分批提供所需证据，在有界模型输入中回答；数据来源与身份不变，未进入本批的字段仍可从原结果回读。

## Acceptance criteria

- [ ] Scouting evidence projection 保留结果 digest、精确记录引用、所选字段、覆盖与剩余范围；大结果通过程序安排选择 / 分批 / 回读，所有新增模型调用计额外。
- [ ] AI tool calls / ToolMessage 的有效配对、tool_call_id、已解析来源 ID、canonical / unlinked 关系、显式 / 默认赛季和三次搜索上限保持。
- [ ] 区分有值、来源 null、未选择、unavailable 和 not-queried；省略字段不能被说成来源缺失，实际赛事 / 赛季及 FM 与表现来源边界正确。
- [ ] Saved lookup 使用原快照 / 日期，不再次查询 provider；回读已保存证据不伪装为新搜索。
- [ ] 额度耗尽且完整数据已有时程序完整展示数据 / 来源并标解释未完成；数据不完整时报告范围，不捏造完整事实。
- [ ] 同票交付实际模型证据和确定性渲染证据的 collector 支持；完整图用大结果、窄字段追问和缺失状态验证，无需新通用检索工具。

## Blocked by

- [03: 一次自动文字压缩后完成任务并记住额度](03-compact-text-with-durable-allowance.md)

## Spec coverage

规格用户故事：4, 12, 13, 14, 15, 21, 22, 23, 24, 30, 51, 52, 56, 58, 59。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
