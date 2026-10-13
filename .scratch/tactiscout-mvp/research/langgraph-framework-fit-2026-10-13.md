# TactiScout 为什么采用 LangGraph StateGraph

**核对日期：2026-10-13**

**范围：** 只核对 LangGraph、LangChain `createAgent` 与 Vercel AI SDK 的官方文档，并对照当前仓库代码、测试和已记录的 Harness 结果。本文是架构适配判断，不是跨框架基准测试。

## 结论

TactiScout 选择直接使用 LangGraph `StateGraph`，理由不是它才会循环调用工具，也不是它能自动提升球探判断质量。项目需要管理的是**一宗会持续推进的招募案件**：Planner 根据实际调查证据决定下一步工具、追问或结束；案件要保留候选与来源观察、搜索范围、失败状态和评审状态；必要时暂停，用户回答后继续同一案件；证据复核还可能要求回到 Planner 补查。LangGraph 把共享案件状态、节点和条件路由作为一等运行模型，并提供基于 checkpointer 的暂停/恢复能力，和这类工作流相匹配。[LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview)、[Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)、[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

这只能支持“StateGraph 是当前需求下合理、可解释的底层编排选择”。它**不能**证明 LangGraph 优于 LangChain `createAgent`、Vercel AI SDK 或手写循环；项目没有同一案件、模型、工具和策略下的跨框架迁移/消融，也没有相应的成本、延迟或推荐质量对比。

## 先区分 LangChain 与 LangGraph

两者不是简单的同层竞品。LangGraph 官方把自己描述为低层编排框架和运行时，用于组合确定性步骤与模型驱动步骤；LangChain `createAgent` 是更高层的 agent harness，而 LangChain 官方说明其 agent 构建在 LangGraph 之上并复用持久执行、人机交互与 checkpoint 能力。[LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview)、[LangChain overview](https://docs.langchain.com/oss/javascript/langchain/overview)

因此，更准确的选择题是：**用 `createAgent` 的现成模型—工具循环，再以 middleware 扩展；还是直接用 `StateGraph` 明确描述应用自己的工作流。** `createAgent` 有自定义 state/middleware、checkpointer、`thread_id` 与人机交互 middleware 的官方接口；它不是“不能暂停或保存状态”的弱替代品。[LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents)

## 方案比较

| 方案 | 适合解决什么 | 对 TactiScout 的代价或缺口 |
| --- | --- | --- |
| 单次 LLM 调用 | 一次输入、一次结构化解析或报告生成 | 若不在外围实现循环、案件状态与暂停机制，就无法表达“查证据→重新决策→需要时追问→收到补充后续查→复核”的多轮生命周期。这是对所定义方案的推论，不是声称模型 API 本身不能调用工具。 |
| 手写工具循环 | 自己实现模型—工具—模型的迭代；适合流程简单、运行状态较短的应用 | 可以实现相同产品行为，但团队需要自行维护持久化格式、恢复指针、阶段路由、策略回环、运行边界与可观测事件。它可能是更小的实现；本项目没有与之做复杂度或稳定性对照。 |
| LangChain `createAgent` | 标准工具调用循环和常见 harness 能力；可通过 middleware 自定义；可传入 checkpointer 和线程 ID | 是最有力的同生态替代方案，并且底层依赖 LangGraph。直接 StateGraph 的理由只能是需要把本项目自定义的案件工作流本身显式建模，不是 `createAgent` 缺少持久化或 HITL。尚未实现/比较 `createAgent` 版本。 |
| Vercel AI SDK `ToolLoopAgent` | TypeScript 应用中可复用的多步工具循环、停止条件和 UI/流式集成；官方还支持结构化 workflow 的手动控制 | 对自定义长期案件仍需决定如何保存业务阶段状态、如何挂起案件并恢复工作流。Vercel 的“恢复流”文档要求应用自行持久化消息/活动流 ID，并用 Redis 保存 UI stream；这证明它有流恢复路径，但不是与 LangGraph checkpoint 完全同类的节点级案件状态恢复。没有做等价实现比较。 |

官方资料：LangChain 的高层 harness 和低层图的职责区分见 [LangChain overview](https://docs.langchain.com/oss/javascript/langchain/overview)；`createAgent` 的 state/checkpointer/`thread_id`/HITL 见 [LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents)；Vercel 的 `ToolLoopAgent` 及“复杂结构化工作流用 core functions”的建议见 [Agents overview](https://ai-sdk.dev/docs/agents/overview) 与 [Loop control](https://ai-sdk.dev/docs/agents/loop-control)；工具审批流程见 [Tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)，UI 流恢复的外部存储要求见 [Chatbot resume streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)。

## 与当前实现的对应关系

### LangGraph 在项目里实际承担什么

1. **维护案件共享状态。** 图状态包含用户对话、目标球队和已确认位置、候选及候选查询观察、已评估球员、方法/报告检索、工具预算、失败状态、待答问题、审核结果和报告等。状态定义位于 [`conversation.ts`](../../../src/agent/conversation.ts#L300)。LangGraph 的 `StateGraph` 把 state、节点和路由组合为循环工作流；节点可返回部分状态更新，条件边根据当前状态选择后续节点。[Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)

2. **让 Planner 自主选择，同时由策略守住案件不变量。** 图先记录新回合，再进入 `choose_next_action`；Planner 在该节点被调用以提议下一动作，周围的确定性策略处理硬条件、工具预算、证据顺序和重复动作。[`planner.decide()`](../../../src/agent/conversation.ts#L1247) 查询/评估工具结束后回到 Planner，收到 `ask_user` 或 `finish` 则转入等待或复核；复核若要求补查也会回到 Planner。主要条件路由和循环见 [`conversation.ts`](../../../src/agent/conversation.ts#L2284)。这是“模型负责灵活决策、代码负责边界”的组合，不是纯固定 DAG，也不是让模型任意执行工具。

3. **暂停并恢复同一个案件。** `wait_for_user` 节点用 `interrupt()` 输出待答问题；API runtime 用同一 `thread_id` 检查 checkpoint，并在 interrupt 后用 `Command({ resume: message })` 恢复图。[`conversation.ts`](../../../src/agent/conversation.ts#L1922) [`conversation.ts`](../../../src/agent/conversation.ts#L2337) 默认应用通过 [`app.ts`](../../../src/app.ts#L73) 注入 SQLite checkpointer，数据库路径默认为 `.data/recruitment-cases.sqlite`：[`checkpoint-store.ts`](../../../src/agent/checkpoint-store.ts#L1)。直接创建图而未注入 checkpointer 时，图工厂会退回 `MemorySaver`；这适合隔离/测试用法，但不会跨进程保存。LangGraph 文档要求中断恢复使用 checkpointer 和同一 `thread_id`；恢复时触发 interrupt 的节点从开头重跑，因此节点中的副作用需按此语义设计。[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

4. **把审核/失败路径作为运行控制流，而不是最终 prompt 里的建议。** 复核节点可以将结论退回 Planner、通过后进入补充数据阶段，或直接交付；错误与进度也按运行阶段返回。当前图明确给这些结果路由，而非假设一次生成就完成。具体 reviewer edge 见 [`conversation.ts`](../../../src/agent/conversation.ts#L2298)。

5. **进度可观察性是 LangGraph 能力加上项目自建协议。** 项目从图节点用 `getWriter` 发自定义安全进度事件，再由 runtime 同时消费 graph output 和 progress stream，并在暂停时投影为 `waiting_for_user`。[`conversation.ts`](../../../src/agent/conversation.ts#L838) [`conversation-turn-runtime.ts`](../../../src/agent/conversation-turn-runtime.ts#L131) 这是应用自行定义的事件和 UI 状态；当前代码证据不应被描述为已接入 LangSmith，也不意味着框架自动提供了业务可读的球探进度。LangGraph 文档把 LangSmith tracing 单独列作观测/调试途径。[Graph API: Observability and Tracing](https://docs.langchain.com/oss/javascript/langgraph/graph-api)

### 可以引用的项目证据

- [`recruitment-checkpoint-recovery.test.ts`](../../../tests/recruitment-checkpoint-recovery.test.ts#L25) 启动一个 API 子进程暂停案件，再启动另一个进程用同一 SQLite 数据库恢复并生成报告。这证明该 fixture 下的持久 checkpoint 恢复链路；它是确定性脚本 Planner 和 fixture 仓库，不是模型质量实验。
- [`recruitment-conversation.test.ts`](../../../tests/recruitment-conversation.test.ts#L692) 覆盖图调查、产生实质追问、同案恢复并基于证据生成建议。测试使用固定实现/fixture，支持工作流行为断言，不代表真实模型在任意场景都能稳定完成。
- [`docs/evaluation.md`](../../../docs/evaluation.md#L136) 记录了相同 Harness 下的追问策略配对实验；[`docs/evaluation.md`](../../../docs/evaluation.md#L244) 记录动态 Planner 与冻结单页策略比较，并明确其结果不证明“LangGraph 框架优越性”。这属于 LangGraph 内部机制实验，而非框架对框架实验。

## 真实取舍与尚未证明的部分

- **更高的控制力，要付出状态/流程设计成本。** StateGraph 把路由和可恢复状态变成显式模型，便于审查节点边界、条件和回环；代价是需要应用作者定义这些节点、reducers、动作约束和迁移语义。LangChain `createAgent` 可以省掉通用 agent loop 的一部分样板，并通过 middleware 增量扩展；若一个工作流只是常规 ReAct 工具循环，使用更高层 API 可能更简单。[LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview)、[LangChain overview](https://docs.langchain.com/oss/javascript/langchain/overview)
- **中断恢复不等于副作用自动 exactly-once。** LangGraph 的中断会从所在节点开始恢复；工具执行要考虑重复执行、幂等和恢复边界。官方 graph API 另有“节点重执行与幂等性”说明。[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)、[Graph API: re-execution and idempotency](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
- **进度面向用户的语义仍需自己设计。** 框架能暴露 state/update/事件流；把工具活动投影为用户能理解且不泄露隐藏推理的状态，是 TactiScout 自己的产品和隐私责任。[Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
- **本地 SQLite 证明的是单机持久化路径，不是生产可扩展性。** 当前默认 checkpoint 后端由 `SqliteSaver` 提供；项目未测并发多实例、备份恢复、数据保留或生产数据库吞吐。LangGraph 支持不同 checkpointer/store 的概念，不自动决定部署方案。[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- **框架本身不等于 Agent 能力或球探质量。** 现有 Harness 可评估流程契约、工具选择和同案恢复；短名单质量仍需要独立、盲评且裁决过的标签。跨框架的效果、成本、延迟、可维护性以及真实用户澄清体验都尚未经过匹配实验。[评估边界](../../../docs/evaluation.md#L138) [短名单质量评测](../../../docs/evaluation.md#L265)

## 面试时的诚实表述

> 我用 LangGraph 是因为产品对象是一宗能暂停、补充和恢复的招募案件，而不是一次性聊天。Planner 负责基于工具结果选择下一步；StateGraph 负责把候选搜索、证据积累、策略门、用户 interrupt、同案 checkpoint 恢复和 Reviewer 回环组织成可检查的运行状态机。LangChain `createAgent` 同样有持久化和 HITL，并且构建在 LangGraph 上；对标准工具循环它可能更省代码。我选直接 StateGraph 是为了把 TactiScout 的自定义案件控制流和硬约束明确建模。我们验证过同案恢复和若干冻结场景内的流程行为，但还没有证明它相对其它框架能提高候选质量或系统效率。

## 官方来源清单

以下均为框架所有方的一手文档，检查日期均为 **2026-10-13**：

- [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview) — 低层编排运行时、确定性与 agentic 步骤组合，以及 LangChain/LangGraph 职责区分。
- [LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api) — StateGraph、state、nodes、edges、conditional routing、Command、streaming 和节点恢复语义。
- [LangGraph Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) — checkpointer 的 thread 状态范围及其与跨 thread store 的差异。
- [LangGraph Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) — interrupt、checkpointer、同一 `thread_id` 和 `Command({ resume })` 的恢复流程。
- [LangChain overview](https://docs.langchain.com/oss/javascript/langchain/overview) — `createAgent` harness、高层/低层框架定位，及 LangChain agents 建立在 LangGraph 之上。
- [LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents) — agent state/middleware、checkpointer/thread continuation、streaming 与 human-in-the-loop。
- [Vercel AI SDK Agents overview](https://ai-sdk.dev/docs/agents/overview) — `ToolLoopAgent` 工具循环及建议改用显式结构化 workflow 的场景。
- [Vercel AI SDK Loop control](https://ai-sdk.dev/docs/agents/loop-control) — `stopWhen`、`prepareStep` 和手动循环控制。
- [Vercel AI SDK Tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) — 工具审批请求/响应流程。
- [Vercel AI SDK Chatbot resume streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams) — UI 流恢复所需 Redis、消息与活动流 ID 持久化，以及 abort 兼容性限制。
