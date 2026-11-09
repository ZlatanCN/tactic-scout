# 10: 输出截断自动恢复并如实交付

Status: open
Label: ready-for-agent
Blocked by: 04, 05, 06, 07, 08
Parent: [运行时上下文管理](../spec.md)

**What to build:** 生成结果被模型输出上限截断时，球探不会收到被标为完成的半份答案或不完整请求；程序在剩余额度内续写 / 重分批，或交付完整数据和明确的未完成状态。

## Acceptance criteria

- [ ] 终止原因、结构化输出有效性及记录 / 字段覆盖一起参与完成判断；达到输入预算并不被误当成输出一定完整。
- [ ] 长输入提取、辅助摘要、lookup 和比较 / 推荐解释都不消费未完成结构化结果或冒称完整覆盖。
- [ ] 有限续写 / 重新分批及其重试全部纳入额外预算；保留批次覆盖和既有排名，无进展及时退出。
- [ ] 完整数据已有时复用对应确定性展示及 provenance，数据 / 理解不完整时不生成全体比较 / 排名，成功快照保持。
- [ ] 内部摘要、草稿和截断流片段不会作为最终完成回答；模型证据与程序渲染证据继续区分。
- [ ] 通过完整图和本地 fake gateway 的截断、部分结构化响应、取消和 usage 场景验证，而不是只断言某个截断 helper 被调用。

## Blocked by

- [04: 自动分块处理单条超长球探指令](04-process-oversized-scouting-instructions.md)
- [05: 大 lookup 结果与已保存追问有界交付](05-project-lookup-evidence.md)
- [06: 多人比较分批解释并完整交付](06-deliver-comparison-evidence-in-batches.md)
- [07: 球员推荐两份名单完整交付](07-deliver-player-recommendation-lists.md)
- [08: 球队推荐保留完整名单与阵容来源](08-deliver-team-recommendation-evidence.md)

## Spec coverage

规格用户故事：23, 24, 25, 44, 45, 46, 49, 50, 56, 58, 61。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
