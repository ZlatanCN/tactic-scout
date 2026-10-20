# 03: Planner 使用唯一决策快照

**What to build:** 每个 Planner 回合只读取代码确定性生成的一份权威 `DecisionSnapshot`。该视图包含最新请求、已确认条件、阶段、候选资格、已观察证据、准确游标、工具预算、待回答问题与来源限制；最新用户要求覆盖历史和长期偏好，非法动作在图内被拦截。

**Blocked by:** 02

**Status:** resolved

**Labels:** ready-for-agent

- [x] `DecisionSnapshot` 从规范案件状态生成，不作为可变的第二事实源写回 checkpoint。
- [x] Planner 模型只读取快照中的权威事实，历史消息仅用于引用和审计，不再重复解释硬条件。
- [x] 最新明确用户要求优先于先前对话和 Store 偏好。
- [x] Planner 输出在进入动作校验前完成 schema 验证；不合法动作不会执行。
- [x] 修改或撤销年龄限制、最新位置选择、多页搜索、身份歧义和报告追问均通过完整图验证。
- [x] 快照字段与 checkpoint 中的案件事实一致，状态不保留漂移的完整副本。
- [x] 决策轨迹保留确定性与模型动作，便于实验审计。

## Answer

完成。每轮快照从 `State` 确定性生成，只保留在每次运行的 `Runtime.context.planningRun` 临时区；不会作为案件事实写进 checkpoint。Planner 的硬事实从 `decisionSnapshot` 读取，旧 JSON action 路径同步迁移到同一快照合同。`pnpm build` 与 53 项代表性完整图回归通过。
