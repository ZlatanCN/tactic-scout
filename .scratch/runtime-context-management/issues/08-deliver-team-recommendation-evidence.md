# 08: 球队推荐保留完整名单与阵容来源

Status: open
Label: ready-for-agent
Blocked by: 03
Parent: [运行时上下文管理](../spec.md)

**What to build:** 球探为球队和位置推荐球员时，大名单仍完整交付，并正确说明阵容映射、真正参考画像及其数据时间；恢复上下文不重新获取已经完成的阵容或排名。

## Acceptance criteria

- [ ] 两类候选完整保留原排名及必需字段；程序按预算安排证据、分批和回读，遵守共享调用 / 时间额度。
- [ ] 团队身份、目标位置、API 阵容来源 / 获取日期、独立 FM 日期和 mapping coverage / 方法保持，映射人数不等于目标位置能力人数。
- [ ] 实际参考对象、rankingBasis、当前阵容身份排除范围、筛选条件及阶段计数准确，不能从投影缺失反推不存在的业务事实。
- [ ] 完整已验证结果已存在时，解释未完成仍展示全部数据和来源；不完整映射 / 理解继续原有澄清，不输出完整推荐结论。
- [ ] Saved team recommendation 使用原 roster / 结果及日期，不调用 squad provider / ranker；缓存失效不自动刷新历史结果。
- [ ] 完整图和 evidence collector 覆盖大名单、两类 rankingBasis、映射覆盖和确定性渲染；原 State / Store 权威保持。

## Blocked by

- [03: 一次自动文字压缩后完成任务并记住额度](03-compact-text-with-durable-allowance.md)

## Spec coverage

规格用户故事：4, 12, 13, 14, 17, 18, 19, 20, 22, 23, 24, 25, 30, 51, 56, 58, 59。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
