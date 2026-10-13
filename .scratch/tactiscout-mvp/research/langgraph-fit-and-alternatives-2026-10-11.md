# TactiScout 的 LangGraph 适配性复核

研究日期：2026-10-11。只采用 LangChain 与 Vercel 的官方 JavaScript 文档，并核对本仓库锁定依赖、运行时代码和 ADR。

## 结论

保留 LangGraph 是有根据的，但目前还不能声称它已被证明是唯一或整体最优选择。TactiScout 的核心难点不是一次工具调用，而是同一招募案件会跨多轮保留约束、在关键缺项时暂停等答复、依据证据决定下一项调查、经 Reviewer 退回补查，并将调查阶段安全地投影到 UI。LangGraph 把这些状态转移、条件边、中断/恢复和 checkpoint 放在同一运行时里，和当前产品模型直接吻合。[LangGraph 对 workflow 与 agent 的定义](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents) · [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) · [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

工具循环、模型决策、人工交互和流式 UI 都不是 LangGraph 独有能力。尤其是官方 Vercel `WorkflowAgent` 已提供持久工作流、步骤重试、暂停后的用户审批恢复和流；它是需要公平对照的真实备选方案。更准确的项目表述是：**LangGraph 当前最贴合 TactiScout 将领域调查流程显式建模为可恢复状态图的方式；优势需与同场景实现成本及恢复行为对照，不能据框架名字推断推荐质量更高。**

## 当前实现核对

- 锁文件解析到 `@langchain/langgraph` **1.4.18**、`@langchain/langgraph-checkpoint-sqlite` **1.0.4** 和 `@langchain/openai` **1.6.0**；`langchain`、`ai`、`@ai-sdk/workflow` 当前都未列为直接依赖。[package.json](../../../package.json) · [pnpm-lock.yaml](../../../pnpm-lock.yaml)
- 实际多轮招募主链在 `createRecruitmentConversation`：Planner 选动作，`execute_tool → choose_next_action` 回环；`choose_next_action` 依动作路由到工具、用户追问或复核；Reviewer 发现问题时走 `review_recommendation → choose_next_action` 补查回路。[conversation.ts](../../../src/agent/conversation.ts) · [ADR 0005](../../../docs/adr/0005-constrained-langgraph-investigation-stages.md)
- 用户追问通过 `interrupt()` 暂停；运行时从 checkpoint 检查待恢复任务，以同一 `thread_id` 发送 `Command({ resume })`。默认 API saver 是本地 SQLite 文件，图的状态是案件事实来源。[conversation.ts](../../../src/agent/conversation.ts) · [turn runtime](../../../src/agent/conversation-turn-runtime.ts) · [checkpoint store](../../../src/agent/checkpoint-store.ts)
- UI 进度不是框架自动定义的产品类型：节点发出 custom events，本项目用 `StreamTransformer` 投影事件，并由 Zod schema 白名单验证，再映射到应用进度响应。这种隔离让模型/工具日志不直接暴露给用户。[turn runtime](../../../src/agent/conversation-turn-runtime.ts) · [domain schemas](../../../src/domain/schemas.ts)
- LangGraph 没有替应用处理所有可靠性问题。本项目仍自行负责同案回合互斥、HTTP 幂等请求、取消语义和前端进度快照；架构文档也将当前 SQLite saver + 进程内互斥限定为本机单进程方案，多进程需要共享 saver 与跨进程协调。[架构文档](../../../docs/architecture.md)

## 按产品 seam 对照

| 必需 seam | TactiScout 当前需求与实现 | LangGraph 的实际价值 | 不用 LangGraph 的代价或选择 |
|---|---|---|---|
| 多轮案件状态 | 对话历史、用户确认的约束、候选/证据、预算、待回答问题和报告需跨 turn 保持 | `StateGraph` 状态通道与 `thread_id` 下的 thread checkpoint；比把整个案件隐含在 prompt/消息数组里更明确 | 普通 TypeScript 也可用一个案件对象实现；但需自己定义 state reducer、版本迁移、并发更新和恢复语义。若仅一轮固定表单分析，这种框架状态图会是额外复杂度 |
| 用户中断后耐久恢复 | 用户需要稍后回答 Planner 的澄清问题；不是确认一次即时工具动作 | `interrupt()` + checkpoint + `Command({ resume })` 是一条直接的暂停/恢复路径；SQLite saver 把当前原型状态写到进程外文件 | LangChain `createAgent` 可通过 checkpointer 与 thread ID 保持消息/状态，且支持 middleware；它不是“脱离 LangGraph”的运行时。Vercel 普通 `ToolLoopAgent` 在内存运行；`WorkflowAgent` 提供更强的 durable workflow/approval 备选。自建则需数据库状态、待答问题记录、恢复 token、重启恢复及幂等步骤 |
| 条件工具循环 | Planner 根据每次结果选择下一动作；确定性策略限制预算、cursor、硬约束和重复操作 | 明确的 conditional edges 表达工具回流、问用户、结束和阻断路径；模型只负责它应判断的调查动作，图保证流程不变量 | `while` + `switch` 也能完成；当只是一个 ReAct 工具循环时会比图简单。LangChain `createAgent` 与 Vercel `ToolLoopAgent` 都原生覆盖标准 tool loop；当阶段/状态约束变多时，再显式建图可减少隐藏的分支交错 |
| Reviewer 退回路径 | 确定性证据检查可通过、要求 Planner 补查一次，或收窄/撤回未被支持的推荐 | Reviewer 是图中的可见节点和返回边，状态里保留重试次数与 findings；Harness 可按真实整图轨迹验证 | 自建时实现成本不高，几条条件语句即可；LangGraph 的收益在统一 trace/checkpoint 与回路边界，而不是 Reviewer 算法本身更准 |
| 有类型的 UI 进度 | 只展示安全的阶段消息与状态，不显示原始思维/工具细节 | custom stream + 独立投影将进度事件与图 state/最终报告分开；项目用 Zod 校验应用级结构 | Vercel AI SDK 有 typed UI message/data parts 和 stream primitives；LangChain `createAgent` 也支持 LangGraph stream/event API。因此“能打字流式显示进度”不是选 LangGraph 的充分理由。差异在于进度是否与领域状态转移同源 |

LangGraph 官方文档同时给出一个重要限制：resume 使用同一 `thread_id`，但包含 `interrupt()` 的节点会从节点开头重跑；因此中断之前的逻辑应纯净或可安全重放。官方还区分内存 saver 与持久 saver，并指出 SQLite saver 适合本地工作流、生产可选 Postgres。[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) · [Checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)

## 备选方案的公平审查

### LangChain `createAgent`

它适合先用较少代码得到标准模型—工具循环，也能加自定义 state、middleware、checkpointer、thread ID 和 streaming。官方文档还展示了把 `agent.graph` 作为 StateGraph 子图运行。因此它可以降低“自建 Planner 工具循环”的代码量，但不是 LangGraph 的反例；若案件仍要有自己的多阶段状态图，可以将 agent 用在 Planner/局部工具环节。[LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents) · [LangGraph streaming 中的 agent 子图示例](https://docs.langchain.com/oss/javascript/langgraph/streaming)

这也提示目前需要用代码量审查架构：当前 Planner 自身是结构化 action interface，`StateGraph` 外围承担业务阶段与应用协议。不要为了“用了 LangGraph”再引入另一个 Agent 抽象；只有实际简化模型接入或工具循环时才值得加入 `createAgent`。

### Vercel AI SDK

`ToolLoopAgent` 支持多步工具调用、`stopWhen`、逐步改配置、结构化输出、流式执行和工具审批，普通聊天 Agent 足够使用；但官方明确它在内存执行，进程崩溃时丢失进度。[AI SDK Agents](https://ai-sdk.dev/docs/agents/overview) · [Loop control](https://ai-sdk.dev/docs/agents/loop-control) · [HITL 示例](https://ai-sdk.dev/cookbook/next/human-in-the-loop)

`WorkflowAgent` 是更强的替代项：它运行在 Workflow 5 内，给 `'use step'` 的工具执行提供持久化、重试与恢复；人类审批也可跨工作流暂停和进程重启存活。它还需要 workflow runtime、应用级 workflow 函数与步骤边界；工具未声明为 step 时不保证 durability，且没有默认调用步数上限，需显式设置。对 TactiScout 的自由文本澄清、领域状态图、Reviewer 回退和本机 Fastify API 是否能以更少的应用胶水映射过去，官方能力说明本身无法回答，必须做同场景的实现对照。[WorkflowAgent](https://ai-sdk.dev/docs/agents/workflow-agent)

## 简化工作流何时更好

如果需求退化为“解析固定输入 → 查一次数据 → 算分 → 报告”，一个普通 TS 函数、显式结果对象和直线调用更简单；`src/agent/graph.ts` 中的单次分析图就不应被当成必须保留 LangGraph 的证明。现在用户需求是自然语言、多次问答后继续，且证据复核能退回调查，所以简单 `while` 虽然可写，耐久暂停、状态持久化、失败重放和多节点进度都会变成自建控制面。框架价值是少重造这一控制面，不是使 Planner 或候选排序自然变聪明。

## 建议的下一步验证

目前消融对比的是同一张 LangGraph 上的动态 Planner 与固定调查策略，而非不同编排框架；文档也明确它不证明 LangGraph 优越。[docs/evaluation.md](../../../docs/evaluation.md) 因此应把结论保持为“架构适配性强、框架优越性未验证”。若要进一步决定，可用相同模型、工具 fixture、场景、调用预算和输出 contract 做一个小型 parity spike：比较 LangGraph、Vercel `WorkflowAgent`、简化持久 TypeScript runner 对同一澄清后续链路的代码复杂度、checkpoint 恢复、Reviewer 回退、事件类型、取消/互斥责任与端到端延迟。

持久恢复已有整图进程重启验证，不应再把它描述为缺失：`tests/recruitment-checkpoint-recovery.test.ts` 分别启动暂停与恢复两个独立 Node 子进程，共用同一个临时 SQLite checkpoint；第一个进程返回 `needs_input` 后退出，第二个重新打开数据库并以同一案件 ID 继续，最终返回 `completed`，且断言推荐球员与用户确认的证据键。该 fixture 证明了此条受控案件路径可以跨正常进程退出恢复；它不等于强杀进程、外部副作用 exactly-once 或生产多进程协调保证。若做框架 parity spike，应复用等价场景测各运行时的恢复语义，而不是重复增加同一 LangGraph 测试。[recruitment-checkpoint-recovery.test.ts](../../../tests/recruitment-checkpoint-recovery.test.ts) · [fixture worker](../../../tests/fixtures/recruitment-checkpoint-worker.ts)

这项框架对照只能回答 runtime 的实现/恢复取舍。Planner、`ask_user`、Reviewer 等产品机制的价值仍应由同一运行时内的受控消融与独立球探判断分别评估，不能把框架对照结果或 Harness 通过率解释为候选排名质量。

## 官方来源

- [LangGraph Workflows and agents](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)
- [LangGraph Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) · [Checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers) · [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangGraph Streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming) · [Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)
- [LangChain Agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- [Vercel AI SDK Agents](https://ai-sdk.dev/docs/agents/overview) · [Loop control](https://ai-sdk.dev/docs/agents/loop-control) · [WorkflowAgent](https://ai-sdk.dev/docs/agents/workflow-agent) · [Tool approval](https://ai-sdk.dev/cookbook/next/human-in-the-loop)
