# 08: 球队推荐保留完整名单与阵容来源

Status: resolved
Label: ready-for-agent
Blocked by: 03
Parent: [运行时上下文管理](../spec.md)

**What to build:** 球探为球队和位置推荐球员时，大名单仍完整交付，并正确说明阵容映射、真正参考画像及其数据时间；恢复上下文不重新获取已经完成的阵容或排名。

## Acceptance criteria

- [x] 两类候选完整保留原排名及姓名、FM ID、年龄、位置评分、CA、PA、currentDistance；程序按完整模型输入预算安排批次并使用共享调用 / 时间额度。
- [x] 团队身份、目标位置、API 阵容来源 / 获取日期、独立 FM 日期和 mapping coverage / 方法保持；映射人数不等于目标位置能力人数。
- [x] 已验证结果记录排名时的 roster-to-FM mappings 和 ranker 实际排除 FM ID；projection 对照完整结果复验，并拒绝候选与排除集相交或缺少排除 scope 的历史投影。
- [x] 完整已验证结果已存在时，额度耗尽或解释失败仍确定性展示全部名单和来源；排除 scope 缺失的旧结果明确说明不扩展排除范围。
- [x] Saved team recommendation 使用原 roster / 结果及日期，不调用 squad provider / ranker；托管 Dev Server 重启后保留批次 reservation，未知完成调用按额度保守结算。
- [x] 完整图和 evidence collector 覆盖两类 rankingBasis、映射覆盖、实际排除身份、模型批次输入与确定性完整渲染；原 State / Store snapshot 仍是权威。

## Blocked by

- [03: 一次自动文字压缩后完成任务并记住额度](03-compact-text-with-durable-allowance.md)

## Spec coverage

规格用户故事：4, 12, 13, 14, 17, 18, 19, 20, 22, 23, 24, 25, 30, 51, 56, 58, 59。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
- 2026-11-11：已完成。球队推荐工具将 `exclusionScope` 持久化到结果：每个 API-Football roster ID 对应的 FM ID / mapping method，以及计算时实际排除的、已按 Reep 展开的完整 FM ID 集合；这些 ID 与生成排名时使用的集合一致。专属投影按候选顺序自适应分批，并保留球队、两类日期、mapping coverage、参考画像、rankingBasis、过滤阶段计数和完整 exclusions。缺失 / 不一致 scope、投影修改、回答候选 / 字段遗漏、额度耗尽均 fail closed 到完整确定性名单。旧结果若无精确 exclusionScope，会如实说明该范围未保存在历史结果中，不重新读取当前 Reep 状态来补写。
- 2026-11-11：完整图证明 saved reuse 不重查 roster / ranker；额度消融回退完整字段；Dev Server 重启测试覆盖 ready batch + 未知 reservation 的保守结算。Evaluation collector 区分模型投影与程序完整渲染；实际英文 / 中文自然语言语义由现有 judge 检查，未运行 live judge。
- 2026-11-11 最终验证：球队推荐投影 4/4、完整图成功 / 额度耗尽用例、Dev Server 重启恢复 1/1、球队评测 4/4 通过；全量测试 118 个 suite / 495 个用例、`pnpm typecheck` 和 `ultracite check src tests evals` 通过。双轴 Spec / Standards 审查没有未解决发现。
