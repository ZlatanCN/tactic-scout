# LangGraph 运行时失败恢复、中断恢复与进度事件复核

核查日期：2026-10-06。范围仅限 LangGraph JS/TS 官方文档与当前仓库实现；官方文档为核查当日在线页面，不是版本锁定快照。仓库 `pnpm-lock.yaml` 锁定 `@langchain/langgraph` 1.4.18（见[依赖锁](../../../pnpm-lock.yaml#L175)）。未运行测试、模型或外部服务。

## 结论

当前图对“Agent 能据此改策略的工具失败”采用官方推荐的状态反馈循环：`execute_tool` 把安全错误写入 tool history，随后回到 Planner。用户补充信息走 `interrupt()`，进度则通过 custom event 投影到本进程中的 typed stream。最值得做的一项后续改进是：**给只读数据工具建立明确的失败分类契约，并在确定会短暂恢复的外部 I/O 边界启用窄范围、有限次的 LangGraph retry；失败耗尽后仍把结构化错误交回现有 Planner/policy。**不要给整个混合职责的工具节点加通用重试。

## 官方文档事实

### 失败和重试

- LangGraph JS 对 `StateGraph.addNode` 的重试是 opt-in；`retryPolicy` 判断的是节点抛出的异常。1.4.0+ 还支持 node `timeout` 与 `errorHandler`，执行顺序是抛错、重试策略决定是否重试、耗尽后调用 handler。[Fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)
- 官方 Agent 设计指南区分四类处理：短暂网络/限流错误用 retry policy；Agent 可修正的工具或解析错误写进 state 再回到 LLM；缺用户信息用 `interrupt()`；未知错误应冒泡以便诊断。[Thinking in LangGraph：错误处理](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph#handle-errors-appropriately)
- `errorHandler` 可在重试耗尽后改 state 或返回 `Command` 路由；这不是 Planner 可见反馈的必选实现，只有需要在图内显式恢复分支时才需要。[Fault tolerance：Error handling](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance#error-handling)

### Interrupt / resume

- 恢复时必须使用同一个 `thread_id`；`new Command({ resume })` 的值成为 `interrupt()` 的返回值。恢复会从包含 `interrupt()` 的节点开头重新执行，因此 interrupt 前的代码也会重跑。[Interrupts：Rules of interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts#rules-of-interrupts)
- interrupt 前的副作用需要幂等，或移到 interrupt 之后/单独节点，避免恢复时重复写入。[Interrupts：Side effects called before interrupt must be idempotent](https://docs.langchain.com/oss/javascript/langgraph/interrupts#side-effects-called-before-interrupt-must-be-idempotent)。官方也明确警告不要用裸 `try/catch` 包住 `interrupt()`，因为暂停依赖特殊异常向图运行时冒泡。[Interrupts：Do not wrap interrupt calls in try/catch](https://docs.langchain.com/oss/javascript/langgraph/interrupts#do-not-wrap-interrupt-calls-in-trycatch)

### Custom progress

- LangGraph 的 v3 event streaming 是多数应用代码推荐的进程内流式接口；`streamEvents()` 产出可同时消费的 typed projections，transformer 可以把 raw `custom` 事件映射到 `stream.extensions`。[Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)
- 节点可用 `LangGraphRunnableConfig.writer` 发自定义数据；图流必须启用 `custom` stream mode 才会收到这些事件。[Streaming：Custom data](https://docs.langchain.com/oss/javascript/langgraph/streaming#custom-data)
- 官方说明无名字的 `StreamChannel` 是本地 side-channel projection，只能由 `stream.extensions` 的进程内消费者读取；命名 channel 才会把 push 转发到主 protocol event stream。[Event streaming：StreamChannel](https://docs.langchain.com/oss/javascript/langgraph/event-streaming#streamchannel) · [JS API：EventLog.local](https://reference.langchain.com/javascript/langchain-langgraph/index/EventLog/local)

## 当前实现映射与判断

- **工具错误**：[`conversation.ts`](../../../src/agent/conversation.ts#L1635) 中的 `execute_tool` 承载多种 action；其 `catch`（约 L1912）调用 `safeToolFailure`，把失败写入 tool history / 对应 failure state，然后通过固定边回到 `choose_next_action`。因此，Planner 当前能看到可恢复错误并换调查路径；但这些已捕获错误不是“抛出的节点失败”，给 `execute_tool` 加 `retryPolicy` 不会自动重试它们。依赖关系是代码观察，结论按官方 retry 触发条件推得。
- **中断恢复**：[`wait_for_user`](../../../src/agent/conversation.ts#L1938) 在 `interrupt()` 前没有进度副作用；`conversation-turn-runtime.ts` 检查 checkpoint task interrupt，并用相同 thread 的 `Command({ resume: message })` 恢复（[`runtime adapter`](../../../src/agent/conversation.ts#L2246)）。恢复后节点顶部只读取已 checkpoint 的问题，之前没有额外写操作，符合官方重跑语义。
- **进度流**：图节点用 `getWriter(config)` 发带业务类型的 custom 事件；[`recruitmentProgressTransformer`](../../../src/agent/conversation-turn-runtime.ts#L65) 只接收 `custom`、校验 DTO，再 push 到 `StreamChannel.local`。运行时同时 drain `extensions.recruitmentProgress` 与 `output`。这与官方 custom writer + v3 transformer + local projection 组合一致，也避免把完整 graph state 暴露给进度消费者。

## 一项建议（文档事实 + 推论）

建议下一步只做**失败分类契约**：在 typed tool executor 与 graph state adapter 的边界区分“短暂可重试 I/O”“Planner 可处理的查询/工具失败”“来源禁止访问或其他 terminal failure”“未知程序错误”。对确定为只读且瞬时的 I/O，在最窄的 LangGraph node 上配置明确 `maxAttempts` 和 `retryOn`；耗尽后把结构化失败留给现有 Planner/policy，未分类异常继续冒泡。现有 `execute_tool` 会捕获 action 异常，所以若需要 LangGraph retry，需先让被分类的瞬时异常到达有 `retryPolicy` 的边界；不要只在当前 catch 外层加 retry 配置。

这是基于官方分类模式和当前代码形态的**实现推论**，不是 LangGraph 对 TactiScout 的规定。它保留现有 Agent 调查循环，同时避免重复对确定失败的请求、把来源拒绝伪装成空结果，或让一次瞬时故障直接终止整轮调查。进度事件在 retry attempt 间可能重复发出，事件消费者应按 stage/status 语义覆盖展示，不能把每条 `started` 都视为一次独立用户操作。
