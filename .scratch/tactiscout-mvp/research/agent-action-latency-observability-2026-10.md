# Agent 等待时间的可观测语义：LangSmith 与 OpenTelemetry

核查日期：2026-10-10。仅依据 LangChain/LangSmith 官方文档与 OpenTelemetry 官方语义约定仓库；没有增加依赖或改动代码。

## 结论

不要用一个“耗时”数字代表所有等待。应保留外层请求/工作流的端到端时间，并用嵌套操作时间解释它花在哪里：模型推理、工具调用、规划或其他图阶段。多轮澄清是多个请求回合；用户思考和输入的间隔不应算作一次模型调用或一次 Agent 回合耗时。

## 两套约定各自回答什么

| 观测边界 | 语义 | 对慢等待的诊断价值 |
| --- | --- | --- |
| 浏览器 / HTTP 回合 | 本应用定义的**用户实际等待**，例如从浏览器发出对话 POST 到收到终态响应。它是产品边界，不会因 LangSmith run 或模型 span 被记录就自动等于其 latency。 | 真实回答“用户这一轮等了多久”；外层耗时可能含 HTTP/API 处理时间。 [TactiScout 计时器](../../../web/src/App.tsx) |
| LangSmith root run / trace | run 是一次工作单元（span），trace 是一个操作内 runs 的嵌套树。root run latency 可作为它所包围操作的 wall-clock 时间；只有当 root run 包住图调用时，它才是图的端到端时间。thread 把多回合 trace 关联起来，同时保留每轮的嵌套与时间。 | 先看被观测操作的总耗时，再从同一 trace 子 runs 定位步骤。LangSmith 明确将 trace 用于排查单次操作为何失败或变慢，将 thread 用于跨回合分析。 [Observability concepts](https://docs.langchain.com/langsmith/observability-concepts) · [RunBase schema](https://reference.langchain.com/python/langsmith/schemas/RunBase) |
| 单次模型请求 | OpenTelemetry 当前 GenAI 指标用 `gen_ai.client.inference.duration` 表示客户端从发出推理请求，到完整收到响应或以错误/取消结束的耗时。流式调用还可观测首个 chunk 时间和后续 chunk 间隔；`gen_ai.server.request.duration` 则是模型服务端视角的请求耗时。 | 区分“首块很晚（流式模型通常表现为首 token 慢）”“生成过程慢”和网络/客户端完整请求耗时。客户端与服务端边界不同，不能互换。 [GenAI metrics](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md) · [Metric definitions](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/model/gen-ai/metrics.yaml) |
| 单次工具执行 | `gen_ai.execute_tool.duration` 表示一次工具执行耗时；当同时记录对应 span 时，两者应一致。 | 找到候选检索、球员评估、报告检索等实际慢工具，避免把全部延迟归咎于 LLM。 [GenAI metrics](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md) |
| Agent / 工作流调用 | `gen_ai.invoke_agent.duration` 覆盖一次进程内 Agent invocation 到最终响应最后一个 chunk 或错误。`gen_ai.invoke_workflow.duration` 覆盖协调多个 Agent/生成式操作的工作流；Agent 的图式编排应按 workflow 边界理解。 | 当多个模型与工具构成一次 LangGraph 调查时，工作流时长解释用户级调查等待；单个模型/工具跨度解释工作流内部耗时。不能拿单模型请求时长代替整个图的时长。 [GenAI metrics](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md) · [Agent and workflow spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md) |

LangSmith 的 `RunBase` 暴露 `start_time`、`end_time` 和以秒计的 `latency`；trace 是嵌套 runs 的树。对应地，根 run 的耗时适合作为单次操作总时间，子 runs 用于定位模型、工具或其他步骤。不要把各子步骤的 latency 相加后称为用户等待时间：父级覆盖整个区间，步骤间的编排开销以及并行重叠都会使总和与端到端 wall time 不同。这是根据父子时间边界作出的测量解释，不是对所有步骤串行执行的假设。

## 对 TactiScout 的具体含义

- 将浏览器发起一次对话 POST 到获得终态的时间标为**本轮用户等待**；另外记录后端 LangGraph 调用边界。两者边界不同，前者还可能包括 API 与应用处理时间。
- 在同一请求/trace 下分别记录模型推理和每次工具调用的耗时，并为可明确区分的规划、审核等阶段保留 span 或开始/结束计时。当前前端计时覆盖本轮请求等待；进度事件只有单个 `occurredAt`，没有每一步的耗时，因此它们能显示进度，却不能单独解释步骤慢在哪里。[进度事件 schema](../../../src/domain/schemas.ts)
- 以 `thread_id` 关联同一招募案件的多轮 trace；用户回答澄清问题前的停顿属于对话间隔，不能混入某一轮 Agent 的计算耗时。LangSmith 将一个 turn 定义为独立 trace、thread 定义为连续 traces 的会话。
- 先沿用项目自己的类型化进度与计时边界即可。语义约定不要求采用 LangSmith 服务或安装 OpenTelemetry；只有需要跨运行聚合分布（例如 p50/p95）、统一导出或接入观测后端时，再评估相应遥测实现。

OpenTelemetry GenAI metrics 文档当前标注 **Development**，且模型指标命名已区分 `gen_ai.client.inference.duration` 与其他操作的 `gen_ai.client.operation.duration`（后者明确不用于 inference）。这些名称适合作为边界设计参考，但在稳定前应在项目内部固定自己的字段契约，并在升级或采用时复核官方版本。 [Status and definitions](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md)

## 一手来源

- LangSmith：[Observability concepts](https://docs.langchain.com/langsmith/observability-concepts)、[RunBase schema](https://reference.langchain.com/python/langsmith/schemas/RunBase)、[LangChain tracing](https://docs.langchain.com/langsmith/trace-with-langchain)
- OpenTelemetry：[GenAI metrics](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md)、[metric model definitions](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/model/gen-ai/metrics.yaml)、[GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
