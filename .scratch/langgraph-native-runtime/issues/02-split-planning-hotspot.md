# 02: 拆开规划热点

**What to build:** 将当前 Planner 回合拆成确定性快照准备、策略闸门、模型规划和动作校验四个清晰职责。重构只改变内部组织，不改变追问、分页、候选资格、证据复核和报告生成行为，使后续运行时能力可以在可审查的基础上加入。

**Blocked by:** 01

**Status:** resolved

**Labels:** ready-for-agent

- [x] 快照准备、策略判断、Planner 调用和动作验证不再共同堆积在一个大型节点中。
- [x] 确定性业务规则仍由代码负责，Planner 不能绕过阶段、预算、游标、资格或证据约束。
- [x] 同时更新状态并决定下一节点的步骤使用 `Command`；普通固定跳转仍使用边。
- [x] 既有完整图测试覆盖澄清、多页搜索、参考球员替代、身份歧义、证据补充和报告生成。
- [x] 重构前后的合法动作、工具轨迹、候选证据和最终报告等价。
- [x] 不保留旧规划入口、重复路由或仅供重构兼容的死代码。

## Answer

完成。已删除旧 `planning-node.ts`，职责由 `planning-run.ts`、`policy-gate-node.ts`、`plan-decision-node.ts` 和 `validate-decision-node.ts` 承担；需要同时改状态并路由的节点使用 `Command`。完整图回归覆盖澄清、搜索、替代者、身份、证据与报告。
