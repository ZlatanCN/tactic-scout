# LangGraph v3 进度事件与取消时的缓冲边界

核查日期：2026-10-06。本文补充 [LangGraph 招募进度与前端传递](./langgraph-progress-streaming-2026-10.md)，聚焦 `AbortSignal` 中断时，已经产生的 custom 事件是否会交给 v3 transformer 和消费者。仓库锁定 `@langchain/langgraph` 1.4.18；除官方文档外，也核对了该锁定包的本地发布产物与 LangGraph JS 官方源码。没有运行测试或模型。

## 结论

**LangGraph 官方文档没有承诺 abort 时一定 flush custom events。**不过当前 JS 实现对已经到达 transformer 并 `push()` 到 `StreamChannel` 的值，会先同步追加到 channel 的内存数组。即使运行随后以异常结束，`StreamChannel` 的失败状态不会清空数组；iterator 会先读完已缓存的项目，再抛出终止错误。因此，持续消费扩展流的调用方可以读到这些已经被 channel 接收的事件。这是实现当前的缓冲行为，应该视为“已接收事件可排空”，而不是可依赖的跨层投递或持久化承诺。[`StreamChannel.push()`、iterator 与 `fail()`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/stream/stream-channel.ts#L846-L985) · [`StreamMux.fail()` 与 `pump()`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/stream/mux.ts#L1980-L2005) · [v3 event streaming 的 channel 生命周期文档](https://docs.langchain.com/oss/javascript/langgraph/event-streaming#streamchannel)

## 依据与边界

- `PregelOptions.signal` 的 API 契约是：信号中止时取消这次 graph call；文档没有进一步规定 stream 是否排空、是否 flush 某个尚未处理的 chunk，或最后一个并发中的 writer 是否一定可见。[PregelOptions `signal`](https://langchain-ai.github.io/langgraphjs/reference/interfaces/langgraph.PregelOptions.html#signal)
- v3 的 pump 对 graph 原始 stream 中抛出的错误调用 `mux.fail(err)`。mux 再把 failure 传给各 projection channel。正常结束时则走 `mux.close()`。这两条路径都会结束 channel，但 API 文档没有把这描述为对消费者的 abort flush 保证。[官方 `pump()`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/stream/mux.ts#L2107-L2191) · [官方 `StreamMux.fail()` / `close()`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/stream/mux.ts#L1831-L2005)
- `StreamChannel` 的 `push(item)` 先写入 `#items`，然后唤醒等待者；`iterate()` 在检查 done/error 之前先检查是否还有缓存项；`fail(err)` 只记录错误和终止状态，不清除缓存。因此这能证明“到达 channel 的 item 在 channel 终止后仍可读取”。它不能证明图节点发出的 writer 调用已经变成原始 stream chunk，也不能证明发生 abort 时尚未进入 transformer 的并发写入会被处理。[官方 `StreamChannel` 实现](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/stream/stream-channel.ts#L846-L985) · [官方 channel 终止实现](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/stream/stream-channel.ts#L1122-L1163)
- v3 文档说明，projection channel 会由 stream handler 在 run 结束时自动 close 或 fail，但没有说 abort 要把 channel 缓冲传给每个消费者，也没有承诺远程传输、调用方停止迭代或进程退出时仍能收到这些值。[官方 Event streaming：StreamChannel](https://docs.langchain.com/oss/javascript/langgraph/event-streaming#streamchannel)

## 对 TactiScout 的可依赖契约

1. 对已经进入 transformer 且通过 schema 的每条进度，transformer 同步 `push()`；runtime 持续 drain `extensions.recruitmentProgress`，并在处理每条事件时马上调用应用的 `onProgress`。这与当前的 v3 channel 缓冲机制相符。
2. 应用自己的案件进度快照是产品层可回放的依据。取消完成时由 turn adapter / HTTP 层明确写入 `cancelled` 终态；不把 LangGraph 在 abort 竞态中的最后一条 custom event 当作取消是否成功的依据。
3. 对外描述应限定为：**取消后保留应用已经观察并记录的进度**。不要承诺“取消时 LangGraph 会 flush 所有已经发出的 custom event”；一个 `writer` 调用若尚未成为底层 stream chunk、进入 transformer 和 channel，现有来源没有提供可依赖保证。

所以 deterministic cancellation 验收应断言：取消前已被 app 记录的事件不会丢失、终态明确为 cancelled、排队中的同案回合可在锁释放后继续；不应断言与 abort 同一瞬间竞态发出的尾事件必须出现。

## 一手来源

- [LangGraph JS Event streaming：StreamChannel 与 transformer 生命周期](https://docs.langchain.com/oss/javascript/langgraph/event-streaming#streamchannel)
- [LangGraph JS PregelOptions API：`signal`](https://langchain-ai.github.io/langgraphjs/reference/interfaces/langgraph.PregelOptions.html#signal)
- [LangGraph JS `StreamChannel` 源码](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/stream/stream-channel.ts)
- [LangGraph JS `StreamMux` 与 `pump` 源码](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/stream/mux.ts)
- [仓库锁定依赖版本](../../../pnpm-lock.yaml)
