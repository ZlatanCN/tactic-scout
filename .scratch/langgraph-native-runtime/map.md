# LangGraph Native Runtime Map

## Notes

- 目标：让 LangGraph 负责运行时通用机制，让领域规则继续由 TactiScout 代码负责。
- 执行顺序：先 runtime context、规划拆分和 `DecisionSnapshot`，之后再改节点失败策略、Store 和排空；实验未证明收益的分支要删除。
- 已安装版本：`@langchain/langgraph 1.4.18`、`@langchain/langgraph-checkpoint-sqlite 1.0.4`。
- 已验证：`StateGraph` 支持 runtime context、节点级 `timeout` / `retryPolicy` / `errorHandler` / `cachePolicy`，compiled graph 支持 `getStateHistory()` 和 `BaseStore`；SQLite checkpoint 包不提供 SQLite `BaseStore`。
- 本地 Node 26 提供 `node:sqlite`；项目最低 Node 22.13，需确认 `DatabaseSync` 的最低版本或对低版本给出可读启动错误。

## Decisions-so-far

- [01 注入运行时上下文](./issues/01-inject-runtime-context.md)：完成，依赖走 `Runtime.context`，不进入 State。
- [02 拆开规划热点](./issues/02-split-planning-hotspot.md)：完成，旧 planning 节点已删除。
- [03 唯一决策快照](./issues/03-one-decision-snapshot.md)：完成，快照只存在于每轮 runtime scratch。
- [04 节点策略与同步 checkpoint](./issues/04-native-node-policies-sync-checkpoint.md)：完成，重试只用于类型化幂等读取。
- [05 脱敏运行检查](./issues/05-redacted-case-run-inspection.md)：完成，只提供 `inspectCaseRun()` 白名单摘要。
- [06 上下文管理](./issues/06-choose-context-management-path.md)：完成；采用唯一 projection 模式，删除落败模式、开关和专用测试。
- [07 并行 enrichment](./issues/07-choose-parallel-enrichment.md)：采用 LangGraph `Send`，删除串行替代路径。
- [08 浏览器长期偏好](./issues/08-browser-scoped-long-term-preferences.md)：完成，显式批准后写入 SQLite BaseStore。
- [09 Send 候选评估](./issues/09-choose-send-candidate-evaluation.md)：拒绝；性能门槛未满足，临时实验已删除。
- [10 局部 Agent 循环](./issues/10-choose-local-create-agent-loop.md)：拒绝；没有稳定调用或延迟收益，且不能满足完整图语义门槛。
- [11 服务排空](./issues/11-graceful-service-drain.md)：完成；服务排空与用户取消使用不同状态。
- [12 收缩并验收](./issues/12-contract-runtime-and-verify-migration.md)：完成；753 项后端测试、后端/Web 构建和完整 HTTP/SSE 案件链路均通过，旧运行时路径已删除。

## Fog

- 持久层只在活动图安全排空后关闭；排空超时则保留 Store 并等待进程退出。
- 06 的远程模型评测使用已配置的 `codex/gpt-6-luna` 网关；不调用 Ollama。
