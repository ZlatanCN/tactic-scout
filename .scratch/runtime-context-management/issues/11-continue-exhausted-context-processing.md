# 11: 额度耗尽后明确继续并跨重启续接

Status: resolved
Label: ready-for-agent
Blocked by: 02, 04, 07
Parent: [运行时上下文管理](../spec.md)

**What to build:** 长任务仅因上下文处理额度耗尽而停下后，球探可以明确要求继续，从持久化断点获得一份新的有界额度；正常重启、重复恢复和 cache 变化不会造成重复拨款或重做已完成计算。

## Acceptance criteria

- [x] 只有额度耗尽且原线程 / 请求 / 来源进度仍有效时新增 grant；继续消息 / 确认 ID 幂等，累计历史消耗保留，普通恢复 / 重启不拨款。
- [x] 配置、鉴权、契约错误或条件歧义不能靠继续绕过；多个可能目标会要求明确选择，新任务不能串用另一项任务的额度 / 摘要 / 进度。
- [x] 已完成数据和原日期直接复用，不再次调用 provider / ranker，除非用户明确要求刷新。
- [x] 分别从 04 的未处理完长指令和 07 的已完成推荐数据 / 未完成解释断点续接，验证部分理解与数据复用两种实际路径；共用 03 的 grant / 停止状态契约，不依赖 09 / 10 才能区分拨款资格。
- [x] 重复 compaction 与多个 grant 后，原文引用、精确条件、参与者和 source / scope 仍保持；缓存内容 / digest / 版本失效时从原文重建，不仅反复概括旧摘要。
- [x] 真实 Dev Server 隔离存储场景覆盖正常重启、pending clarification、源输入 / 缓存改变、未知完成状态保守结算、主 State 不兼容与辅助缓存重建的区别。
- [x] 验证用户等待 / 停机不按墙钟累计、恢复不清零、首次 / 重复继续的准确拨款、完整数据与解释状态，并通过长线程和固定证据续接回归检查实际任务成功与漂移。
- [x] 延续前票已有的恢复验证；本票交付的是明确继续与跨阶段长任务续接，而不是最后才补持久化 / 观测测试。不访问或清理用户真实持久化存储。

## Blocked by

- [02: 长线程中准确理解本轮球探请求](02-bound-request-understanding-context.md)
- [04: 自动分块处理单条超长球探指令](04-process-oversized-scouting-instructions.md)
- [07: 球员推荐两份名单完整交付](07-deliver-player-recommendation-lists.md)

## Spec coverage

规格用户故事：3, 11, 22, 26, 27, 28, 29, 30, 31, 32, 33, 34, 44, 46, 50, 52, 53, 54, 55, 57, 58, 60, 62。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
- 2026-11-13：实现完成。`contextProcessing.allowance.grants` 记录每份追加额度的稳定 continuation message ID、请求、来源、操作类型与增量上限；新增额度累加在同一 allowance 上，不重置已消费调用 / 时间。续接资格只从仍匹配的额度耗尽断点生成；故障、待澄清、未知结算、失效来源和不兼容 State 不拨款；多条可续进度时返回明确目标选项。
- 2026-11-13：#04 图回归覆盖两个后续 grant、同 ID 重放、引用偏移与参与者 / 2025/26 赛季 / 排除锚点保持，并覆盖鉴权 / 配置 / 契约失败、澄清、源变化、未知完成和 State 版本失配。chunk plan 在已完成 `nextStart` 上追加新区间，旧消费和已有 ready chunk 保留。
- 2026-11-13：#07 图回归从已保存的两份推荐名单与未完成解释继续；ranker/provider 未接入该路径，原快照 JSON 保持。另覆盖损坏的推荐投影从权威结果重建，以及 continuation ID 对未知 reservation 的保守结算。受管 Dev Server 用临时隔离 State 验证两种工作流跨重启后继续、重复 ID 不增加调用、推荐数据来源事件不增加；普通重启本身不会拨款或开始工作。
- 2026-11-13 最终验证：`pnpm typecheck`、`ultracite check src tests evals CONTEXT.md` 通过；全量 `pnpm test` 为 141 个文件 / 539 个用例全部通过。双轴 Standards / Spec 审查没有未解决发现。续接保真由固定模型 / provider fixture 对精确锚点、source 引用、候选字段、快照 digest 和数据复用进行确定性验证；未运行 live semantic judge，不外推为任意自然语言的普遍保证。所有 persistence 场景只使用临时 managed Dev Server 与 fixture，没有访问或清理用户持久化存储。
- 2026-11-14 follow-up：评测暴露 lookup 成功后模型重复发出同一搜索请求，以及 evidence continuation 用原始长问题 hash、无法在 compacted question 下续接。现在复用本轮同参数成功结果并为重复 tool call 生成匹配 `ToolMessage`；lookup 与 evidence batch 的问题文本、缓存匹配和 grant eligibility 共用经过 source ID/hash 校验的 compacted instruction。新增 full compiled graph 用例验证 compacted lookup 的 evidence explanation 耗尽后可继续，复用已有结果并回到 `answer_ready`。语义续接 case `4eedfbd9-4896-4142-bb86-797c31b26e31` 通过，43/129 请求、judge calibration 32/32、3/3 必需事实覆盖；最终全量测试 146 文件 / 544 用例通过。测试 profile 仅用于触发额度耗尽路径，不表示本地网关实际输入能力。
