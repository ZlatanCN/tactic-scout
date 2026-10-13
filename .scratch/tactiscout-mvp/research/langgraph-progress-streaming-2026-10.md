# LangGraph 招募进度与前端传递

核查日期：2026-10-04。本文依据当前工作区实现、仓库锁定的 `@langchain/langgraph` 1.4.18 类型声明，以及 LangChain/LangGraph 官方 JavaScript 文档和源码更新。研究过程没有运行真实模型或端到端测试。

## 结论

当前实现采用 LangGraph 官方推荐的 **in-process v3 event streaming**，将图节点产生的 custom 进度事件投影为服务端可消费的类型化扩展；`turn()` 再通过既有回调更新 Fastify 快照，React 继续轮询该快照。链路为：

```text
图节点 getWriter(config) 发 custom 事件
  → streamEvents v3 的 recruitmentProgressTransformer
  → StreamChannel.local<RecruitmentGraphProgressUpdate>()
  → graphStream.extensions.recruitmentProgress
  → RecruitmentConversation.turn() 的 onProgress 回调
  → Fastify 案件进度快照
  → React 轮询 GET /progress
```

LangGraph 文档明确建议新应用使用 event streaming。它把底层 Pregel 事件转换为类型化投影，并提供互相独立的读取器；当应用想消费“图输出”和“定制进度”时，不需要自己在一个通用事件循环里拆分不同 stream mode。[LangGraph JS Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming) · [Streaming 的 API 选择说明](https://docs.langchain.com/oss/javascript/langgraph/streaming)

当前 `turn()` 调用形态为：

```ts
workflow.streamEvents(input, {
  ...config,
  version: "v3",
  streamMode: ["custom"],
  transformers: [recruitmentProgressTransformer],
});
```

`recruitmentProgressTransformer` 只处理 `event.method === "custom"` 的事件，并对 `event.params.data.payload`（LangGraph v1.4.18 对未命名 custom 数据的封装）使用 `RecruitmentGraphProgressUpdateSchema.safeParse` 白名单校验；通过后推入 `StreamChannel.local`。节点用 `getWriter(config)` 发布项目自己的 `tactiscout/recruitment-progress` 事件。`turn()` 并发消费 `extensions.recruitmentProgress` 和 `graphStream.output`；等待两个分支都 settled 后再传播错误，避免图失败时未排空进度通道。`turn()` 本身负责发出完成、等待用户或失败终态，因此 HTTP 应用和 Harness 消费同一份生命周期回调。[当前图事件与投影](../../../src/agent/conversation.ts) · [进度事件 schema](../../../src/domain/schemas.ts)

## 为什么用 v3 event streaming，而不是直接用 `.stream()`

- 底层 `graph.stream(..., { streamMode: "custom" })` 依然是有效、轻量的选择：它直接给调用方原始图运行流，适合只消费少数底层 mode 的情况。官方文档将 `custom` 定义为节点通过 writer 发出的自定义数据。[Streaming：stream modes 与 custom data](https://docs.langchain.com/oss/javascript/langgraph/streaming#stream-modes)
- 本项目已需要读取“最终图输出”和“实时进度”两种不同结果。v3 `streamEvents` 为它们提供 `output` Promise 和自定义 transformer 扩展，消费端可并行读；不用把原始 Pregel `custom` event envelope 作为 `turn()` 的内部接口。官方将 event streaming 说明为在 raw streaming 之上的类型化投影层，并建议应用代码采用它。[Event streaming：两层结构与投影](https://docs.langchain.com/oss/javascript/langgraph/event-streaming#how-the-pieces-fit-together) · [Event streaming：并发读取投影](https://docs.langchain.com/oss/javascript/langgraph/event-streaming#stream-multiple-projections)
- `StreamChannel.local` 让进度扩展只供同一进程里的 `turn()` 消费。官方源码将 local channel 定义为本地投影；需要向远程 SDK 客户端转发时才用 remote channel。TactiScout 当前由 Fastify 自己转换为已有 HTTP 快照，因此 local channel 与边界匹配，不额外引入 LangGraph 的浏览器协议。[官方 `StreamTransformer` / `StreamChannel` 类型说明](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/stream/types.ts)
- 这不是说 `.stream()` 做不到同样的功能。用 `.stream()` 时，调用方要自行迭代并分派 raw mode chunks；v3 更适合当前需要的类型化扩展和输出并行消费。

## 现有 Web 架构如何接收进度

- React 提交 turn 的 POST 请求并等待最终 JSON，同时约每 1.2 秒请求 `GET /api/v1/recruitment/cases/:caseId/progress`。页面显示最新消息、时间线、耗时和轮询连接状态。[React 进度请求](../../../web/src/App.tsx) · [API 客户端](../../../web/src/api.ts)
- UI 用 `visibleProgressSteps` 按阶段和 occurrence 把开始/结束事件归并为一个步骤，并保留最近六个步骤；它只改显示模型，不修改有界服务端事件快照。这样反复出现的 planning 阶段仍可区分，而一次工具调用的开始和完成不会挤占两个时间线位置。[进度步骤投影](../../../web/src/progress.ts)
- Fastify 在进程内保留案件快照，并为事件生成递增序号；每个快照最多保留 24 个事件。进度变更通过 `RecruitmentConversation.turn({ ..., onProgress })` 同步进入该快照，POST 结束时记录完成或等待补充状态。[Fastify turn 与 progress route](../../../src/app.ts)
- 当前没有通过浏览器 WebSocket 或 SSE 传送 LangGraph event。v3 stream 是后端进程内消费图事件的方式，HTTP 轮询是浏览器读取服务端快照的方式，两者解决不同层的问题。
- 保留当前轮询可使前端继续依赖项目自有的 `RecruitmentProgress` schema，不暴露 LangGraph 原始 payload。若将来要降低轮询延迟或支持重连回放，再单独设计 SSE：按 turn 分配 run ID 和事件序号，并为重连提供有界 replay buffer。官方 React transport 示例同样将 command 与流订阅拆分并讨论 replay；它定义的是另一套传输协议，并非当前 Fastify 接口可直接替换的前端适配器。[官方 React custom transport：server architecture](https://github.com/langchain-ai/langgraphjs/blob/main/libs/sdk-react/docs/custom-transport.md#server-architecture) · [官方 custom transport：layer choice](https://github.com/langchain-ai/langgraphjs/blob/main/libs/sdk-react/docs/custom-transport.md#choosing-a-layer)

## 事件契约与节点边界

图节点通过 `getWriter(config)` 发出的 payload 由 `RecruitmentGraphProgressUpdateSchema` 校验，包含阶段、生命周期状态、受控文案和已完成决策步数。transformer 对未通过 schema 的事件不推送；`process()` 返回 `true` 保留原始 event stream 行为。Fastify 收到进度后自行添加 `sequence`、重复阶段 `occurrence` 和时间戳，存进前端读取的 `RecruitmentProgress` 快照。

进度事件应只描述可公开的调查状态。不要将完整 LangGraph state、planner 历史、原始工具输入/输出、模型内部文本或凭证放进前端 DTO。节点应在有意义的动作开始和结束时发送状态；完成数只能代表实际结束的步骤，不能由 UI 根据等待时间推算百分比或 ETA。2026-10-04 的真实本地 Harness 首次发现 transformer 对外层 `params.data` 直接校验会静默丢弃所有事件；解开 LangGraph 1.4.18 的 `payload` 包装后，同一失败场景已实际记录 `planning/started` 和 `failed` 两条事件。

`updates` 表示节点步骤完成后产生的 state 更新，适合观测节点边界；它不代表长节点内部运行进度。当前招募 Agent 把若干 planner action 执行在统一的 `execute_tool` 图节点中，因此仅靠节点更新粒度不够。custom 事件可以在节点内部表达实际的查找、评估、审核等业务步骤。官方 `tools` mode 面向 LangGraph 工具调用生命周期；当前 TactiScout 进度需要包含领域阶段和安全文案，项目自有 custom DTO 更合适。[Streaming：updates 与 custom](https://docs.langchain.com/oss/javascript/langgraph/streaming#graph-state) · [Streaming：tool progress](https://docs.langchain.com/oss/javascript/langgraph/streaming#tool-progress)

## 1.4.18 类型兼容性

仓库 `pnpm-lock.yaml` 锁定 `@langchain/langgraph` 1.4.18。该版本的本机类型核对和当前代码调用以 `streamEvents(..., { version: "v3", streamMode: ["custom"], transformers: [...] })` 显式启用底层 custom mode，再由 transformer 接收并转换事件。官方 event streaming 文档描述了 `required_stream_modes` 声明机制；但本仓库当前实现使用调用选项中的 `streamMode`，不要把 `required_stream_modes` 写成这份代码必须新增的 transformer 属性，也不要引入本机锁定类型不接受的字段。请在升级 LangGraph 后再按升级目标版本的类型与官方文档复核 API。[本地依赖锁定](../../../pnpm-lock.yaml) · [官方 event streaming：required stream modes](https://docs.langchain.com/oss/javascript/langgraph/event-streaming#declaring-required-stream-modes)

## Interrupt 与恢复

当前 `turn()` 在 graph stream 和进度扩展都完成后调用 `workflow.getState(config)`，从 checkpoint task 中检查 interrupt；需要用户补充时返回 `needs_input`。回答时以同一个案件 ID 作为 `thread_id`，用 `Command({ resume: message })` 恢复。这里保留既有 checkpoint / `getState` 逻辑，不需要为了进度事件改成直接向浏览器暴露 v3 `interrupts` 投影。LangGraph 官方要求 interrupt 恢复使用启用的 checkpointer 和同一个 thread ID；恢复时含 interrupt 的节点会从头执行，因此该节点中 interrupt 前的工作可能重跑。进度通知应保持只读、可重复，不承载不可重复副作用。[LangGraph JS Interrupts：resuming](https://docs.langchain.com/oss/javascript/langgraph/interrupts#resuming-interrupts) · [Interrupt rules](https://docs.langchain.com/oss/javascript/langgraph/interrupts#rules-of-interrupts)

## 后续核验建议

本研究更新没有运行模型、集成测试或端到端验证。后续可由实现任务按项目验证流程检查：普通完成、暂停等待用户、同案 resume、custom event schema 无效时被过滤、进度轮询快照顺序，以及长工具运行期间 UI 能否持续读到进度。真实 Ollama 案例可进一步核对阶段文案是否准确反映 Agent 实际调查路径。

## 一手来源

- [LangGraph JS Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)
- [LangGraph JS Streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)
- [LangGraph JS Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangGraph JS `StreamTransformer` / `StreamChannel` source](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/stream/types.ts)
- [LangGraph JS React custom transport source docs](https://github.com/langchain-ai/langgraphjs/blob/main/libs/sdk-react/docs/custom-transport.md)
