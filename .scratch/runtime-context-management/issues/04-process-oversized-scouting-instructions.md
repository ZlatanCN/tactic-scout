# 04: 自动分块处理单条超长球探指令

Status: resolved
Blocked by: 03
Parent: [运行时上下文管理](../spec.md)

**What to build:** 第一条用户消息自身大于一次辅助请求预算时，系统自动有界分块、提取并合并任务 / 限制，形成带原文定位的 Compacted scouting instruction 后执行；实际条件矛盾时保留进度澄清。

## Acceptance criteria

- [x] 每个源批次及合并调用都满足自身预算，明确跟踪已处理 / 剩余范围，不能将整份超限输入交给摘要器或无限递归压缩。
- [x] 全部参与者、团队、参考 / 排除对象、否定、数值 / 单位、位置、赛事 / 赛季和跨块指代被核对；后文明确修正与真正矛盾分别处理。
- [x] 每条原文定位 / hash 有效，引用材料不升级为指令；独立块结果不能未经合并校验直接执行，语义保真不以 JSON 合法性代替。
- [x] 已完成块与消耗可恢复；额度耗尽时解释未理解完整，不给出整体比较 / 排名，原有成功快照不被覆盖。
- [x] 经完整图完成首条超长输入的 lookup / 比较 / 推荐代表场景；续接型用例包含跨块条件和重复压缩，确认真实 source IDs 和限制未漂移。

## Blocked by

- [03: 一次自动文字压缩后完成任务并记住额度](03-compact-text-with-durable-allowance.md)

## Spec coverage

规格用户故事：5, 7, 8, 9, 10, 11, 12, 23, 30, 33, 43, 52, 56, 60, 61。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
- 2026-11-10：实现并验收有界分块、跨块合并、冲突澄清后重新分块、精确引用检查、Unicode 安全边界、stale chunk hash 重建和 quota checkpoint 恢复。完整图 lookup 验收覆盖修正 / 冲突季节、团队 / 排除 / 年龄 / 位置条件和实际 FM / Understat source IDs；回归确认合并遗漏 ready chunk 的球队锚点或局部 ambiguity 时 fail closed，并阻止请求理解运行。额度耗尽用例保留旧成功快照；未知后续 chunk 调用结算保留已完成块。managed Dev Server 测试覆盖 6 个已完成 chunk 和额度在正常重启 / 同 message ID 重放后的保持。
- 2026-11-10：本票采用固定 fake model / provider 合约验收，没有运行 chunking 路径的 live-model semantic judge；测试验证约束进入最终指令和业务 lookup，但不声称证明任意自然语言压缩的普遍语义保真。额度耗尽后追加 grant 并继续处理尚未规划的范围由 [11: 额度耗尽后明确继续并跨重启续接](11-continue-exhausted-context-processing.md) 实现。
- 2026-11-10 最终验证：`tests/text-compaction.test.ts` 23/23 通过，managed Dev Server chunk recovery 通过；全量 `pnpm test` 为 41 个文件 / 450 个测试全部通过，`pnpm typecheck` 和改动文件的 Ultracite 检查通过。完整图代表路径按本票“代表场景”的单数语义选择 lookup；comparison / recommendation 的证据交付仍由 06–08 票据覆盖。
