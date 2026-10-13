# TactiScout 长流程 Agent 的 LangGraph 控制架构依据

核查日期：2026-10-05。范围：LangGraph JS/TS 官方文档、`langchain-ai/langgraphjs` 官方仓库，以及当时工作区源码与锁定依赖。核查时没有运行模型、测试或 GitHub 操作。在线文档是随官方站点更新的当前资料；本文记录核查日期，不把页面当成某个历史版本的不可变快照。实现跟进于 2026-10-06 追加在文末。

## 结论

TactiScout 已经在用 LangGraph 管理真正需要图运行时的部分：同一案件内 Planner—工具—Planner 的受控调查循环、政策分支、证据复核回路、用户中断/恢复、checkpoint，以及贯穿运行的安全进度事件。它不是把一次 prompt 包在 `StateGraph` 里。现有主图足以支撑当前产品，不需要为了展示框架而改成多 Agent 或子图。

接下来应持续改进**代码模块边界与数据源可扩展性**，不是另造一层 agent 框架：

1. 图构建与应用侧 `turn()` 生命周期适配已拆成两个普通 TypeScript 模块；两侧共享同一 compiled graph、案件 checkpoint、`thread_id` 和 checkpointer。
2. `execute_tool` 的五种具体执行已整理为 typed executor。它返回 action-specific 结果，图继续控制调查策略、失败状态、预算和 state 更新；当某项外部 I/O 确实需要独立 checkpoint、超时或重试时，再把它升为单独 LangGraph node。不要给整个 `execute_tool` 盲目套通用重试。

暂不建议将现有 workflow 机械切成多个 subgraph。官方将 subgraph 主要定位于多 Agent、跨图复用或团队并行开发，并要求明确父子状态契约；TactiScout 当前多个阶段直接共享同一案件状态。若把大状态原样嵌套，只会换一种方式承载耦合；若切出独立状态，又会增加字段映射和 checkpoint/trace 复杂度，暂时没有产品收益。

## 当前架构事实

当前锁文件将 `@langchain/langgraph` 锁定为 **1.4.18**（package.json 的范围为 `^1.0.0`）。本机包的 `graph/state.d.ts` 中可见 `addNode` 的 `retryPolicy`、`timeout` 与 `StateGraph.setNodeDefaults` 类型；因此本报告引用的 1.4 系列 API 与当前锁定依赖相符，而不是只根据线上“最新版本”推测。[依赖锁定](../../../pnpm-lock.yaml#L175) · [本机 `StateGraph` 类型声明](../../../node_modules/@langchain/langgraph/dist/graph/state.d.ts)

主图仍由 `conversation.ts` 中的 `createRecruitmentConversation` 一次性构造。当前可见的阶段包括：`record_user_turn`、`choose_next_action`、`execute_tool`、`wait_for_user`、`review_recommendation`、两类候选外部补充、`deliver_recommendation`。边定义了主循环：Planner 选择工具后执行再回到 Planner；可追问时进入 interrupt；完成时先过确定性 Reviewer，Reviewer 要求补查就回到 Planner；通过后才补充并交付。[状态与图定义](../../../src/agent/conversation.ts#L577) · [节点与主循环](../../../src/agent/conversation.ts#L1269) · [条件边和编译](../../../src/agent/conversation.ts#L2196)

Planner 的工具动作不是自由执行：图状态保留已发现/已评估球员、搜索游标、工具预算、用户确认的位置、政策阻止计数及报告检索范围。`choose_next_action` 将模型提议经过显式用户限制、候选游标、工具预算和阶段规则校正；必要时由确定性策略直接要求评估或检索报告。独立 `review_recommendation` 再核对推荐 ID、位置与证据引用，并允许一次回到 Planner 补查。这使“由模型选研究方向、由工作流守住不变量”成为可追踪的 harness 契约。[状态](../../../src/agent/conversation.ts#L582) · [候选与用户约束](../../../src/agent/conversation.ts#L746) · [规划策略](../../../src/agent/conversation.ts#L1305) · [最终证据复核](../../../src/agent/conversation.ts#L1973) · [现有架构决策](../../../docs/adr/0005-constrained-langgraph-investigation-stages.md)

等待用户不是一次性 HTTP 暂停，而是 graph interrupt。`wait_for_user` 把问题放入 `interrupt()`；`conversation-turn-runtime.ts` 通过同一 `thread_id` 以 `Command({ resume: message })` 恢复，并在 checkpoint task 中确认是否仍处于等待状态。生产 app 注入 SQLite saver；factory 被单独调用且没传 checkpointer 时仍回退到进程内 `MemorySaver`，所以独立部署调用者须显式注入持久化 saver。[interrupt 节点](../../../src/agent/conversation.ts#L1940) · [turn runtime](../../../src/agent/conversation-turn-runtime.ts) · [SQLite checkpointer](../../../src/agent/checkpoint-store.ts) · [app 注入](../../../src/app.ts#L70)

运行中的图阶段通过 custom event 发出。LangGraph v3 `streamEvents` 与 transformer schema 校验、`StreamChannel.local` 在 `conversation-turn-runtime.ts` 统一消费，再经现有 API 快照给前端轮询；浏览器没有直接消费 LangGraph 原始事件或完整状态。[进度 transformer 与消费](../../../src/agent/conversation-turn-runtime.ts) · [节点进度 writer](../../../src/agent/conversation.ts#L1261) · [图适配器](../../../src/agent/conversation.ts) · [当前进度链路研究](./langgraph-progress-streaming-2026-10.md)

## 官方资料核对

| 控制能力 | 官方依据与当前结论 |
|---|---|
| 图作为显式的工作流控制器 | LangGraph JS 的 StateGraph API 以节点、边、条件路由和共享 state 定义图；`Command` 可同时更新 state 和跳转，`conditional edges` 则适合只做路由。[Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api#command) 页面说明：图的结构是可检查的控制流；返回 `Command` 的节点应声明 `ends`，且不可同时配置静态后继边，否则两种路由都会执行。TactiScout 当前用条件边表达主循环路由，符合这一分工。核查状态：官方 JS 文档，2026-10-05 可访问。 |
| 中断、等待与恢复 | 官方要求 interrupt 配置 checkpointer 与 `thread_id`；resume 必须复用相同 `thread_id` 并传 `new Command({ resume })`。含 interrupt 的节点恢复时会从节点开头重跑，因此 interrupt 前的工作可能再执行。数据变更或外部副作用应放在可重放安全的位置，进度事件也应容忍重复。[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts#resuming-interrupts) · [Rules of interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts#rules-of-interrupts)。核查状态：官方 JS 文档；interrupt `responseSchema` 是 **1.4.16+**，项目锁定 **1.4.18**，但 TactiScout 当前只用普通问句和字符串 resume，没有依赖新 schema 功能。 |
| Checkpoint 作用域 | 官方区分 thread 内 checkpoint（短期对话、HITL、容错）与跨 thread Store（长期应用数据）；`MemorySaver` 在进程重启后丢失，生产使用持久化 checkpointer。[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)。核查状态：官方 JS 文档；与项目的 SQLite 案件状态 / localStorage 计划快照分工一致。 |
| 进度和事件流 | 官方将 v3 **event streaming**称为多数 LangGraph 应用代码推荐的进程内 streaming 模型。它将 Pregel 原始事件通过 transformer 转为 `output`、`values`、`messages`、`subgraphs`、`interrupts` 和自定义 `extensions` 等可同时读取的类型化投影。[Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)。旧式 stream-mode API 仍适合需要底层 `updates` / `custom` 原始事件的场景。[Streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming#custom-data)。核查状态：官方 JS 文档；当前 v3 实现与推荐方向一致，前端继续使用自有进度 DTO 是合理边界。 |
| 子图和模块化 | 官方定义 subgraph 为“作为另一张图节点使用的图”；常见用途为多 Agent、跨图复用、独立团队开发。状态 schema 不同则通过 wrapper 映射输入/输出；共享键可直接把 compiled graph 当 node。默认 per-invocation 子图能继承父 checkpointer、在单次调用内 interrupt；per-thread 才跨多次调用保留子图私有状态。[Subgraphs](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs)。核查状态：官方 JS 文档；子图是有状态与运行语义的边界，不等于普通文件拆分。 |
| 重试和 timeout | 官方 JS `addNode` 支持显式 `retryPolicy`；重试是 opt-in。1.4.0+ 提供 node timeout 与 error handler；timeout 仅用于 async node。超时会抛 `NodeTimeoutError`，并由 retry policy 决定是否再次执行。[Fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)。当前锁定 1.4.18；本地类型声明确认 API 存在。核查状态：官方 JS 文档的最低版本提示 + 工作区精确锁版本与类型声明。 |

## 已落地的模块 seam

### 1. graph builder 与对话 turn runtime

**拆分前的 seam 由职责而非行数确定。** `conversation.ts` 同时承载 Planner prompt/适配、案件状态 schema、大量候选约束辅助逻辑、整个 `StateGraph` 节点/边定义，以及外部 `RecruitmentConversation.turn()` 的并发锁、checkpoint 检查、stream projection 消费、interrupt 检测、API response DTO 与进度终态。这些 turn lifecycle 职责现由 `conversation-turn-runtime.ts` 负责，图构建仍留在 `conversation.ts`；同一个 compiled graph 通过窄适配器接入 runtime。[turn runtime](../../../src/agent/conversation-turn-runtime.ts) · [graph 与适配器](../../../src/agent/conversation.ts)

实现后的职责分配：

- `conversation.ts`：仍持有 `RecruitmentState`、图节点/边与 compiled graph 工厂；LangGraph 继续拥有案件状态、conditional routing、interrupt 与证据回路。图节点只把具体 I/O 委派给 typed executor，再按观察结果更新同一份 LangGraph state。
- `conversation-turn-runtime.ts`：负责同案件串行、判断初始输入还是 resume、消费经过校验的 v3 event stream、读取 checkpoint interrupt，并将最小图状态投影成 `ConversationTurnResponse` 与安全进度 callback。
- `recruitment-tool-executor.ts`：通过 repository、knowledge repository 和评估函数的注入，执行五种 action 并返回 action-tagged 结果；Planner 的 action 与案件策略仍由 LangGraph 决定。

边界契约保持不变：同一个 `thread_id`、同一 checkpointer 与持久 state；不复制 LangGraph state，不把状态镜像进第二个运行时。这样图层可以按 workflow/harness 测试，Fastify 调用层继续按公开 turn 协议测试；未来更换 API 传输方式也不需要改 Investigator 的路由语义。

运行时拆分之前发现的 interrupt 进度副作用也已由 issue 60 修复：`wait_for_user` 不在 `interrupt()` 前 emit `asking_user/started`；实际暂停后由 turn runtime 发出 `asking_user/waiting_for_user`，恢复时不会把历史问题显示成新问题。[`wait_for_user`](../../../src/agent/conversation.ts#L1940) · [turn runtime](../../../src/agent/conversation-turn-runtime.ts) · [官方 resume 重跑规则](https://docs.langchain.com/oss/javascript/langgraph/interrupts#rules-of-interrupts)。

### 2. Typed tool executor 与 graph 节点粒度

拆分前，一个 LangGraph `execute_tool` node 同时做五种 I/O 并组装案件 state。现已把具体执行移至 `recruitment-tool-executor.ts`，其穷尽请求/结果类型覆盖方法检索、球员报告检索、球队样本查询、候选分页和表现评估。报告检索输入由图适配器限制为已评估且未查过的候选球员；候选查询依旧走带筛选与分页一致性校验的 provider 函数。图节点继续计算实际 trace filters、进度摘要、Planner history、工具预算与 checkpoint state 更新。[typed executor](../../../src/agent/recruitment-tool-executor.ts) · [`execute_tool` state adapter](../../../src/agent/conversation.ts)

executor 错误继续抛给图节点现有的 catch 策略；候选数据 provider failure 会写入案件 state 并作为错误反馈回给 Planner，知识检索失败也会标记为失败，不能折叠成成功的零命中。executor 测试通过注入的本机 fake dependencies 覆盖五种 action 和成功空页/失败区别，不触发模型或网络。

当新 provider 带来不同重试/timeout 要求时，再把确有独立运行语义的 I/O 提升为 graph node：例如 query node 可以有安全的短重试，Planner/model node 使用模型自己的请求 deadline，评估 node 保持确定性；每个节点的自定义 progress 与错误仍写回相同 state。官方说明节点粒度会影响 checkpoint 后的恢复与可观测性，并允许按外部服务失败模式配置独立 node policy；但当前 `execute_tool` 的 `catch` 会把所有异常改成正常的 state 更新并交回 Planner，LangGraph 因而看不到异常、不会触发 node retry。只给现有 wrapper 配 `{ retryPolicy: ... }` 不会重试这些被捕获的错误。模型超时已经在 `chat-model.ts` 配置；若后续添加 LangGraph timeout，要协调单次请求 timeout 与整节点 timeout，避免两个层次互相抢先结束。[官方重试/超时](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance#retries) · [官方节点粒度说明](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph#advanced-considerations) · [当前工具异常 catch 与状态回写](../../../src/agent/conversation.ts#L1911) · [模型请求 timeout](../../../src/agent/chat-model.ts#L1)。

## 此刻不值得做的事

- **不因 2336 行就创建多个 subgraphs。** 普通 TS module seam 不会引入新的图状态和 checkpoint 语义；subgraph 应在拥有清楚且稳定的 I/O state contract、确有跨图复用/隔离状态或独立 Agent 目标时再引入。[官方用途和 state mapping](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs#define-subgraph-communication)
- **不把 deterministic policy 伪装成独立 Agent。** 用户边界、候选游标、source failure、工具预算与推荐证据验证是代码不变量；LLM 继续负责调查选择和综合解释，LangGraph 负责状态化地反复调用，确定性 policy/reviewer 可以挡住越界。ADR-0005 已明确这份责任划分。
- **不启用当前整个工具 node 的泛化 retry/errorHandler。** 工具错误目前被设计为模型能依据的状态/消息；把它抛给运行时重试会改变工具预算、来源错误处理和用户看到的语义。先按错误类别与操作幂等性建 typed executor，再决定节点策略。
- **不直接把 full `values` 或 debug stream 暴露给 UI。** 图 state 有对话历史、候选与检索结果；当前经过 schema 筛选的 custom event 与有限快照把 UI、模型上下文和内部状态分开。官方 v3 typed projections 也允许只读取应用所需扩展。

## 后续实现建议

下一项应根据真实 provider 故障语义，为特定 I/O 确定是否需要 LangGraph node 级 timeout/retry；目前 executor 仍将原始失败交回图策略，因此不能宣称 LangGraph runtime 正在自动重试工具。运行时适配由 [issue 61](../issues/61-isolate-langgraph-turn-runtime.md) 跟踪，typed executor 由 [issue 62](../issues/62-typed-recruitment-tool-executor.md) 跟踪。2026-10-06 完整测试套件 166/166 通过。

## 一手来源

- [LangGraph JS Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
- [LangGraph JS Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangGraph JS Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph JS Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)
- [LangGraph JS Streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)
- [LangGraph JS Subgraphs](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs)
- [LangGraph JS Fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)
- [Thinking in LangGraph: node granularity trade-offs](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)
- [官方 LangGraph JS 仓库 `StateGraph` 实现](https://github.com/langchain-ai/langgraphjs/tree/main/libs/langgraph-core/src/graph)
