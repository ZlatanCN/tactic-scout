# 07: 球员推荐两份名单完整交付

Status: open
Label: ready-for-agent
Blocked by: 03
Parent: [运行时上下文管理](../spec.md)

**What to build:** 能力相似和高潜推荐在两份名单都很大时仍完整交付，保持原排名、来源日期和筛选含义；解释可以分批，已计算的候选不能静默缩成一部分。

## Acceptance criteria

- [ ] 覆盖 current / potential 各 20 人的结果，分别保持全部顺序及每行姓名、FM ID、年龄、位置评分、CA、PA、currentDistance。
- [ ] 参考画像、目标位置、年龄计算日期、FM 日期、筛选条件及阶段计数保留；单份列表 limit 不被说成两份合计上限或总体候选数。
- [ ] 证据批次及回读均由程序安排；不重新排名、补算缺失属性或混合 PA 与能力相似度，新增模型调用共享 grant。
- [ ] 覆盖完整性核验与确定性完整名单展示随本票完成；解释未完成如实标识，不因失败丢弃完整已验证结果。
- [ ] Saved recommendation 不调用 ranker / provider，旧结果日期不变化，source 投影缺席与原始 null 明确区分。
- [ ] 完整图和 evidence collector 验证模型实际候选 / 字段与确定性展示的真实依据，不将整份存储结果一律算成模型已见。

## Blocked by

- [03: 一次自动文字压缩后完成任务并记住额度](03-compact-text-with-durable-allowance.md)

## Spec coverage

规格用户故事：4, 12, 13, 14, 17, 18, 19, 22, 23, 24, 25, 30, 51, 56, 58, 59。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
