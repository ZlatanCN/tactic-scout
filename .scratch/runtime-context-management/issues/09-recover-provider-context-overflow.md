# 09: provider 实际输入溢出自动缩减恢复

Status: open
Label: ready-for-agent
Blocked by: 04, 05, 06, 07, 08
Parent: [运行时上下文管理](../spec.md)

**What to build:** 即使本地预算检查通过，provider 仍报告 context-overflow 时，系统利用各入口已有的文字 / 证据处理策略自动缩减后有限重发；不能恢复时保留成果并真实交付。

## Acceptance criteria

- [ ] 可识别输入 overflow 与鉴权、配额、配置及普通暂时故障分类正确，后者不进入 compaction 重试。
- [ ] 原业务恢复请求同时消耗额外额度和原操作尝试次数；辅助请求及其重试也按既有分类记账，重新进入节点不刷新预算。
- [ ] 每次恢复后的 payload 有明确缩减进展并满足准备请求检查；无可缩减内容或无进展时退出，不相同内容盲重试。
- [ ] 文本分块、lookup、比较和两类推荐入口均使用自身已完成的缩减策略，保护精确约束、tool pairing、完整来源及覆盖。
- [ ] 在额度 / 时间内完成则交付原任务；耗尽或不能恢复时走本工作流已有完整数据 / 未完成出口，取消及时停止。
- [ ] 扩展现有本地 fake gateway 验证实际请求 / finish / usage 和计数；记录估算与 provider usage 的区别，不记录原始提示 / 阵容。

## Blocked by

- [04: 自动分块处理单条超长球探指令](04-process-oversized-scouting-instructions.md)
- [05: 大 lookup 结果与已保存追问有界交付](05-project-lookup-evidence.md)
- [06: 多人比较分批解释并完整交付](06-deliver-comparison-evidence-in-batches.md)
- [07: 球员推荐两份名单完整交付](07-deliver-player-recommendation-lists.md)
- [08: 球队推荐保留完整名单与阵容来源](08-deliver-team-recommendation-evidence.md)

## Spec coverage

规格用户故事：42, 44, 45, 46, 47, 48, 50, 55, 56, 59。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
