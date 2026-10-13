# 本地 Ollama 调用的 Token Usage

研究日期：2026-10-11

## 结论

**TactiScout 当前的 Ollama + `ChatOpenAI` 路径可以拿到本地模型实际报告的 prompt/completion token 数。**非流式 `invoke()` 是最直接的采集点；流式也有对应协议，但依赖服务端支持 `stream_options.include_usage`，且中断时可能拿不到最终计数。`ChatOllama` 的原生 Ollama 集成也会暴露用量，不过它是另一条 API 路径，不是项目当前正在用的集成。

当前代码通过 `@langchain/openai` 1.6.0 构造 `ChatOpenAI`，可选设置兼容服务 `baseURL`，没有安装 `@langchain/ollama`，也没有设置 `streaming: true`。[模型工厂](../../../src/agent/chat-model.ts) [依赖版本](../../../pnpm-lock.yaml)

## 数据形状与行为

| 路径 | LangChain 用量字段 | 可靠性边界 |
|---|---|---|
| 当前：`ChatOpenAI` → Ollama `/v1/chat/completions`，非流式 | `AIMessage.response_metadata.usage` 保留标准字段 `prompt_tokens`、`completion_tokens`、`total_tokens`；`AIMessage.usage_metadata` 映射为 `input_tokens`、`output_tokens`、`total_tokens`。当前 `withStructuredOutput(..., { includeRaw: true })` 返回的 `raw` 是带这两种 metadata 的 `AIMessage`。 | 已安装 `@langchain/openai` 1.6.0 的转换器把 `rawResponse.usage` 原样浅拷贝到 `response_metadata.usage`；同一版本只在对应 token 数为 truthy 时填 `usage_metadata`，因此 `usage_metadata` 会漏掉显式零值。Normalizer 应优先读 `response_metadata.usage`，再回退到 `usage_metadata`；响应或字段不存在时标记未知，不当作 0。Ollama 当前 OpenAI 兼容实现把原生 `prompt_eval_count` / `eval_count` 转成 `usage`。 [LangChain ChatOpenAI](https://docs.langchain.com/oss/javascript/integrations/chat/openai) [LangChain OpenAI converter source](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-openai/src/converters/completions.ts) [Ollama 兼容层实现](https://github.com/ollama/ollama/blob/main/openai/openai.go) [OpenAI Chat Completion 响应](https://developers.openai.com/api/reference/resources/chat) |
| 当前：`ChatOpenAI` → Ollama `/v1/chat/completions`，流式 | 当请求带 `stream_options: { include_usage: true }`，用量会在最后一个 chunk 中到达，LangChain 会把它作为一个空内容 `AIMessageChunk.usage_metadata` 发出；合并 chunk 后可读取总数。 | OpenAI 规范规定其他 chunk 的 `usage` 可以为 null；流被中断或取消时，最终用量 chunk 可能缺失。LangChain 文档也提醒第三方兼容服务不一定支持 `stream_options`；可用 `streamUsage: false` 关闭该请求选项。Ollama 当前兼容 API 将 `include_usage` 列为支持字段，但用户机器上 Ollama 的准确版本尚未核实。 [OpenAI 流式响应规范](https://developers.openai.com/api/reference/resources/chat) [LangChain ChatOpenAI 的流式用量选项](https://reference.langchain.com/javascript/langchain-openai/ChatOpenAI/streamUsage) [LangChain 对兼容服务的说明](https://docs.langchain.com/oss/javascript/integrations/chat/openai) [Ollama 兼容 API](https://docs.ollama.com/api/openai-compatibility) |
| 替代：LangChain `ChatOllama` → Ollama 原生 `/api/chat` | 同样暴露 `AIMessage.usage_metadata`：`input_tokens`、`output_tokens`、`total_tokens`；`response_metadata` 保留 `prompt_eval_count`、`eval_count` 和推理耗时字段。 | LangChain 官方 JS 文档给出非流式样例；其当前 JS 实现也在流结束时从 Ollama 统计信息构造带 usage 的最终 chunk。它是独立集成与端点，不必仅为 token 统计而切换当前 `ChatOpenAI` 架构。 [ChatOllama 官方集成文档](https://docs.langchain.com/oss/javascript/integrations/chat/ollama) [ChatOllama JS 实现](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-ollama/src/chat_models.ts) [Ollama `/api/chat` 字段](https://docs.ollama.com/api/chat) |

Ollama 原生 `/api/chat` 将 `prompt_eval_count` 定义为 prompt token 数，将 `eval_count` 定义为生成 token 数；ChatOllama 的示例把它们映射到 LangChain 的 `input_tokens` 和 `output_tokens`。[Ollama API 字段说明](https://docs.ollama.com/api/chat) [ChatOllama 示例](https://docs.langchain.com/oss/javascript/integrations/chat/ollama)

## 对项目的实现建议

1. 保持现有 provider seam。当前 `/v1/` + `ChatOpenAI` 路径已具备收集这类元数据的能力；仅为 usage 引入 `ChatOllama` 会增加第二套配置与验证面。
2. 在每次真实模型调用的边界捕获 provider 返回的 usage，并标注阶段、模型与图运行 ID；把一次图运行中的各次模型调用相加，避免只显示最后一轮 Planner 的 token 数。兼容端点未返回数值时，记录为未知。
3. 当前 Planner 使用结构化输出并设置 `includeRaw: true`。LangChain 返回 `{ raw, parsed }`；这里的 `raw` 是带 `response_metadata.usage` 和 `usage_metadata` 的 `AIMessage`，可以在解析后立即归一化计数，再丢弃原消息。无需启用内部 `__includeRawResponse`，避免额外保留完整生成响应。
4. 眼下工厂未启用模型流式输出，所以应先验证非流式 `invoke()` 用量是否穿过结构化输出调用边界。将来若模型本身改为流式，再验证 Ollama 版本是否支持最终 usage chunk，并把取消/断连后的统计标记为不完整或未知。

## 2026-10-11 全链路验收

接入只读取实际结构化响应 usage 的记录后，本机 `qwen3.5:9b` 在 LangGraph 调查规划消融中完成 36 次 Planner 模型调用；36 次都有响应，input/output/total 三字段均完整，未出现失败调用或缺失 usage。确定性整图验证确认每个真实 `invoke()` 恰好产生一条脱敏 usage trace；测试还覆盖显式零、非法/负数/非安全整数、逐字段 fallback 和缺字段不补零。该验收只证明当前本机非流式 Ollama 运行能在该场景提供计数；它没有检查 `stream_options.include_usage`，也没有制造真实模型请求失败或取消，所以不外推到流式、中断请求、其他 Ollama 服务版本或其他兼容端点。

在固定的 Wyscout 2017/18 curated 快照上，巴萨和拜仁各三组配对均完成，分别汇总动态臂 27,633/36,789 tokens、单页固定臂 3,345/20,028 tokens（依次为巴萨/拜仁每臂总量）。各臂报告的 input/output/total 字段均为 `complete`，且 requestCount 等于真实 trace 事件数。此处记录的是 LangGraph Planner 使用量，不包含独立需求解析 API；历史 `plannerRequestAttempts` 不能回填为 usage，单次本机计数也不是金额成本或推荐质量结论。拜仁首轮验收还暴露并修复了按来源记录计数与按候选身份组计数不一致的 Harness 问题；修复后六次拜仁运行都通过 29/29 检查。结果与完整解释见[评测记录](../../../docs/evaluation.md#动态调查规划消融)，原始本地汇总位于忽略目录 `.data/evaluations/`。

## 本地 structured-output 冒烟

2026-10-11 通过当前项目安装的 `@langchain/openai` 1.6.0、`ChatOpenAI` 和 `jsonSchema` structured output 向 `http://127.0.0.1:11434/v1` 发送了一次不含项目数据的 `qwen3.5:9b` 请求。`withStructuredOutput(..., { includeRaw: true })` 成功返回 `{ ok: true }`；`raw.response_metadata.usage` 与 `raw.usage_metadata` 都报告 prompt 27、completion 182、total 209，`additional_kwargs.__raw_response` 未启用。第一次把探测输出上限故意设为 64 时触发长度上限；将这次探测提高到 1,024 后成功。这只证实本机 provider + structured-output adapter 的响应形状，不等同于 Planner、LangGraph 全图或 Harness 汇总验收。

## 2026-10-11 一手来源复核：非流式 usage 与零值

- **已核实（Ollama 当前官方文档与主分支源码）：** Ollama 文档列出本地 `/v1/chat/completions` 接口。其当前 `openai/openai.go` 将 `Usage` 定义为 `prompt_tokens`、`completion_tokens`、`total_tokens`；`ToUsage` 分别取原生 `PromptEvalCount`、`EvalCount` 并相加。`middleware/openai.go` 的非流式分支调用 `ToChatCompletion` 输出 JSON，因此该端点会带上这些 usage 字段。这里核实的是当前公开源码实现，不代表用户本机服务版本。[Ollama OpenAI 兼容文档](https://docs.ollama.com/api/openai-compatibility) [当前 API 文档](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx#L356-L386) [Usage 与响应构造](https://github.com/ollama/ollama/blob/main/openai/openai.go#L136-L155) [ToUsage 与 ToChatCompletion](https://github.com/ollama/ollama/blob/main/openai/openai.go#L245-L255) [非流式 `/v1/chat/completions` 分支](https://github.com/ollama/ollama/blob/main/middleware/openai.go#L2308-L2471)
- **已核实（项目锁定版本及 LangChain 当前主分支实现）：** 项目锁定 `@langchain/openai` 1.6.0；本地安装的 `ChatOpenAI` 非流式实现把 provider 的 `usage` 浅拷贝到 `AIMessage.response_metadata.usage`，再用 `if (completionTokens)`、`if (promptTokens)`、`if (totalTokens)` 构造 `usage_metadata`。所以 provider 返回的标准字段即使为 `0`，也会保留在 `response_metadata.usage`，但不会写入 `usage_metadata` 对应字段。当前 LangChain 主分支源码仍呈现相同行为。[项目依赖锁](../../../pnpm-lock.yaml) [当前 ChatOpenAI 非流式转换](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-openai/src/chat_models/completions.ts#L198-L357) [当前 Completions 消息转换](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-openai/src/converters/completions.ts#L2529-L2591)
- **已核实（structured-output 返回形状）：** `ChatOpenAI.withStructuredOutput(..., { includeRaw: true })` 把 `includeRaw` 传给 LangChain Core 的结构化输出组装器；组装器返回 `{ raw: BaseMessage, parsed }`，并在解析失败时仍保留 `raw`、令 `parsed` 回退为 `null`。本项目的 Chat Completions 原始消息由上述适配器构造成 `AIMessage`。此选项与 ChatOpenAI 内部的 `__includeRawResponse` 不同；后者才会把完整 provider response 放入 `additional_kwargs.__raw_response`。[ChatOpenAI 结构化输出实现](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-openai/src/chat_models/base.ts#L1019-L1186) [LangChain Core 返回形状](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/language_models/structured_output.ts#L88-L125) [内部完整响应字段](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-openai/src/converters/completions.ts#L2537-L2555)
- **本机版本仍未知：** 当前执行环境的 `ollama --version` 显示 client version 0.40.1，同时报告无法连接运行中的 Ollama instance。因此不能据此确认服务端版本或其具体序列化行为；此前一次本地请求成功只证明那次运行返回了 usage，不应推广到未知版本。实现仍应优先读取 `response_metadata.usage`，逐字段保留显式零；字段缺失时标记未知，不用 `usage_metadata` 缺失的键补零。
