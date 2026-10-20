# 10: 决定局部 `createAgent` 内循环去留

**What to build:** 以窄工具集比较局部 `createAgent` 内循环与现有 Planner 到 `ToolNode` 路径。只有在完整图语义一致，并且带来明显的行为、成本或维护收益时才采用；否则保留现有路径并删除实验实现。

**Blocked by:** 04, 09

**Status:** resolved

**Labels:** ready-for-agent

- [x] 窄循环实验只比较 LangGraph 原生 helper 和显式 `ToolNode` 循环。
- [x] 两臂使用相同确定性 fake model、冻结工具调用和响应。
- [x] 验证具名工具调用与 `interruptBefore: ["tools"]` 后恢复的消息和状态等价；完整招募语义未由局部 helper 证明，因此不采用。
- [x] 5 组配对调用数相同（每臂 2 次模型调用、1 次工具调用）；p50 为 5ms/5ms，p95 为 18ms/17ms，未形成稳定收益。
- [x] 未达到门槛，实验路径和开关已删除；安装版本也没有 `createAgent` 导出，只有 `createReactAgent`。
- [x] 不采用：helper 在窄循环中提供同一 `ToolNode` 路由，放入招募图则会绕过既有策略闸门和案件 checkpoint 边界，维护上无净简化。

## Answer

不采用。当前安装的 `@langchain/langgraph/prebuilt` 没有 `createAgent`，可用的近似 helper 是 `createReactAgent`。用相同冻结响应运行 5 组局部循环配对后，逐条消息与工具调用、工具前暂停和恢复状态完全一致；每臂都是 2 次模型调用和 1 次工具调用，p50 延迟均为 5ms，p95 为 18ms/17ms，没有稳定收益。结果见 [`create-agent-loop-paired.json`](../results/create-agent-loop-paired.json)。

这项局部实验不能证明招聘案件的阶段、Reviewer、证据和报告语义不变；helper 也不会自动迁移这些领域状态。由于完整图硬门槛未能成立，不把它接入 Planner 或保留实验分支。临时实现已删除。
