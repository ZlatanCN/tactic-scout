# LangGraph 工具调用取消传播缺口

核查日期：2026-10-12。范围：LangGraph.js 的生产相关进度流、interrupt/resume 与取消语义；对照当前 TactiScout 实现及 issues #51、#61、#68、#128。依据 LangGraph 一手文档、官方源码和本地仓库代码；未改产品代码，也未运行模型或测试。

## 结论：一个已确认的工程缺口

用户点击“停止”时，request-scoped `AbortSignal` 能到达 LangGraph 和 Planner，也能到可选的 PlayerElo 增补请求。但它没有沿实际球探工具链传给候选查询、球队样本查询、球员评估、RAG 检索及其底层数据源。因此，若停止发生在这些操作执行期间，LangGraph 可以进入取消退出流程，而其尚未接收取消信号的 HTTP、embedding 或本地检索工作仍可能继续消耗网络、CPU 或磁盘资源，直到自身结束或触发独立超时。

这不是 LangGraph streaming API 用错，也没有证据表明它会造成 checkpoint 损坏。它是应用依赖边界尚未实现端到端协作式取消；当前尚未以运行实验量化停止延迟或取消后的剩余工作。

## 一手依据

- LangGraph.js 将 `signal?: AbortSignal` 作为图调用配置，定义为取消本次调用的信号；v3 event streaming 则是推荐的进程内 streaming API，支持 `output` 与自定义 `extensions` 投影并行消费。TactiScout 已采用这套结构，不需要为此迁移到 Agent Server 或 SDK。[PregelOptions `signal`](https://langchain-ai.github.io/langgraphjs/reference/interfaces/langgraph.PregelOptions.html#signal) · [Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)
- 官方 PregelRunner 源码将未完成 task promise 与 abort promise 放入 `Promise.race`；官方 retry 实现把 signal 放进节点 `RunnableConfig`，并在 signal 已 abort 时停止后续重试。这表明 graph 会响应取消；要让节点正在等待的外部依赖也停止，调用方仍须把 signal 传给那些依赖并让它们配合取消。[PregelRunner 的 race](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/pregel/runner.ts#L300-L336) · [retry 的 signal 传递](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/pregel/retry.ts#L92-L116)
- 人工 interrupt 是另一种状态迁移：LangGraph 文档要求 graph 配置 checkpointer，并在恢复时使用相同 `thread_id`。TactiScout 已使用 SQLite checkpointer，并有跨 API 进程暂停后恢复的回归测试。[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts#resuming-interrupts) · [重启后恢复测试](../../../tests/recruitment-checkpoint-recovery.test.ts)

## 对照项目现状

**已覆盖：**

- [issue #51](../issues/51-langgraph-live-progress-events.md)：真实 graph/tool 生命周期驱动 typed progress；有界快照可在短暂轮询中断后恢复最新状态。明确不承诺回放保留窗口之外的事件。剩余人工验收是屏幕阅读器检查。
- [issue #61](../issues/61-isolate-langgraph-turn-runtime.md)：graph 和 HTTP turn runtime 已拆成小接口，同时保留唯一 graph/checkpointer/thread ID 和 typed progress contract。
- [issue #68](../issues/68-stop-long-running-investigations.md)：停止会传到 LangGraph、Planner 和 PlayerElo；HTTP 生命周期、真实编译 graph 的 Planner 取消及同案排队释放已有确定性验证，另有本地 Ollama 运行记录。验收范围没有覆盖活动中的球员数据源、RAG 或 evaluator 操作；读屏验证仍未完成。
- [issue #128](../issues/128-recorded-harness-run-showcase.md)：`/showcase` 展示真实录制的调查、澄清和恢复过程，并注明数据时效与质量边界；它不是取消演示。

**代码可直接确认的缺口：**

- `execute_tool` 把 repository、knowledge base 和 evaluator 传给 [executeRecruitmentToolAction](../../../src/agent/conversation.ts)，但执行器依赖接口没有 `signal` 参数。[执行器](../../../src/agent/recruitment-tool-executor.ts)
- [PlayerRepository](../../../src/data/provider.ts) 的查询方法不接受 request signal。远程适配器自行使用 `AbortSignal.timeout(...)`，如 [ASA](../../../src/data/asa-provider.ts) 与 [Understat](../../../src/data/understat-provider.ts)；这类 timeout 不是用户停止信号。
- [KnowledgeRepository.search](../../../src/knowledge/index.ts) 与 [RecruitmentEvidenceEvaluator.evaluate](../../../src/agent/recruitment-evidence-evaluator.ts) 也没有取消参数。
- 相比之下，Planner 调用显式传入 `config.signal`，PlayerElo 增补也显式传入 signal，见 [conversation.ts](../../../src/agent/conversation.ts)。所以这是一个边界不一致，而不是所有运行路径都缺少取消。

## 建议聚焦的后续改动

沿一条依赖上下文把 signal 从 `execute_tool` 传到工具执行器、`PlayerRepository`、`KnowledgeRepository` 和 evaluator；网络适配器把用户 signal 与已有来源超时组合，取消错误保持为“已取消”而不是“来源失败”。纯本地同步计算可在批次边界检查 signal；模型与本地 embedding 能否中止，需按底层库真实能力分别确认，不要宣称强制终止。

用已认可的 HTTP / 整图验收 seam 验证：取消活动中的数据查询或 RAG 后，底层请求收到 aborted signal、不会继续启动下一项工具、没有新报告；取消终态及同案队列顺序仍正确。随后做一组配对消融：完整 signal 传播 vs. 在工具边界故意不传 signal，对比停止到终态耗时及终态后仍活动的依赖数。若没有实际可观测的差异，就不要把这项工作包装成性能或可靠性提升。

## 边界与不支持的说法

- 官方文档定义 LangGraph 调用的 `signal`，没有承诺任意节点内部的第三方请求、embedding runtime 或 CPU 工作会被强制杀死。
- 对 Runner 内部 race 的结论是源码层观察，不应表述成“LangGraph 会泄漏任务”或“LangGraph 取消一定留下后台请求”。只有未接收／未遵守 signal 的依赖才存在继续工作的可能；需要通过应用级信号传播和运行观察解决。
- 不建议因此重写当前 v3 streaming、interrupt/checkpoint 或 turn runtime；这些机制已有一手依据和项目验收，当前差距在数据工具协作取消。

## 来源与仓库证据

- [LangGraph.js event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)
- [LangGraph.js PregelOptions API](https://langchain-ai.github.io/langgraphjs/reference/interfaces/langgraph.PregelOptions.html#signal)
- [LangGraph.js interrupt/resume](https://docs.langchain.com/oss/javascript/langgraph/interrupts#resuming-interrupts)
- [LangGraph.js PregelRunner source](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/pregel/runner.ts)
- [LangGraph.js retry source](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/pregel/retry.ts)
- 仓库本地分析：[architecture.md](../../../docs/architecture.md)、[progress research](./langgraph-progress-streaming-2026-10.md)、[abort event-buffering research](./langgraph-v3-abort-progress-buffering-2026-10-06.md)。
