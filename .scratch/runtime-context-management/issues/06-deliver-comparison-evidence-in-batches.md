# 06: 多人比较分批解释并完整交付

Status: open
Label: ready-for-agent
Blocked by: 03
Parent: [运行时上下文管理](../spec.md)

**What to build:** 球探比较许多已确认球员时，全部参与者和可比范围可在预算内分批解释；局部处理不被说成全体比较，完整结果在解释未完成时仍可使用。

## Acceptance criteria

- [ ] 从完整已验证比较结果生成带精确来源 / 字段 / 覆盖的证据批次，批次安排、回读和模型调用遵守共享预算。
- [ ] 全部确认参与者、赛事 / 赛季、局部 scope 人数、coversAllParticipants 和全体共同范围数量保持；无共同范围和局部记录不被扩大。
- [ ] 各 provider 数据、null / omitted / unavailable / unqueried、身份关系及缺失值声明保持；不能为缩减输入自行剔除参与者或生成整体强弱排名。
- [ ] 完成解释前核对覆盖；额度耗尽时完整展示已验证比较数据与来源，标明解释未完成；不完整数据不产出全体结论。
- [ ] Saved comparison 复用原结果，不重跑查询；原快照先提交及失败保留语义保持。
- [ ] 完整图与本票的 evidence collector 场景验证较多参与者、多范围 coverage、分批和确定性展示，区分模型所见与程序所读记录。

## Blocked by

- [03: 一次自动文字压缩后完成任务并记住额度](03-compact-text-with-durable-allowance.md)

## Spec coverage

规格用户故事：4, 12, 13, 14, 15, 16, 22, 23, 24, 25, 30, 51, 56, 58, 59。

## Comments

- 2026-11-08：用户确认拆分粒度和依赖（“合适了”），按批准的提案发布；尚未认领或实施。
