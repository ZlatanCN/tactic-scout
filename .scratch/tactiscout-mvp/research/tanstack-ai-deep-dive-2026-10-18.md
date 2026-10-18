# TanStack AI 深度调研：它能替代 TactiScout 的 LangGraph 吗？

**调研日期：** 2026-10-18
**范围：** TanStack AI 官方文档、TanStack/ai 仓库与发布记录、官方博客；并对照本仓库现有招募案件架构。本文不改应用代码，也不新建 issue。

## 结论先行

TanStack AI 是一个正在快速扩展的 **TypeScript AI 应用 SDK**：它把模型适配器、流式对话、工具循环、AG-UI 协议、前端 chat client、持久化、审批中断、多模态和沙箱等组合成可选包。它并不等于一个和 LangGraph 同层的有状态图工作流引擎。

对 TactiScout 来说，**目前不建议替换 LangGraph，也不建议为了“用上 TanStack AI”把后端重新接一遍**。本项目的核心难点是案件状态、按证据选择调查动作、跨轮追问恢复、Reviewer 回退和安全取消；这些由现有 `StateGraph` 明确控制。TanStack AI 的 `chat()` 主要提供模型调用与工具执行循环，并提供中断、持久化和事件传输原语，但当前发布版没有可与本项目案件图一一对应的稳定、持久化、声明式工作流图 API。

TanStack AI 有值得关注的产品能力：AG-UI、跨框架 chat client、Typed tools、流式事件、持久化分层。若未来确实要标准化前后端 agent 协议或构建多模型 / 多模态 chat，再通过一个最小的协议桥接试验评估；不要先动案件图。

## 1. 项目定位与成熟度

官方将其定位为 TypeScript 优先、框架无关、provider-agnostic 的 AI SDK，覆盖 streaming chat、tool calling、structured output、voice / media generation、agent、MCP 与 framework bindings。主仓库是 [TanStack/ai](https://github.com/TanStack/ai)，核心包与 provider / framework 包按能力拆分，而不是一个必须全量引入的单体运行时。[官方 Overview](https://tanstack.com/ai/latest/docs/getting-started/overview) · [仓库 README](https://github.com/TanStack/ai#readme)

成熟度要按“功能面广”与“API 稳定”分开看：TanStack 在 **2026-08-21 宣布进入 RC 阶段**；截至 **2026-10-18**，npm 显示 `@tanstack/ai@0.69.0` 为最新版本，GitHub Release 页面对应发布记录标为 **2026-10-13**。这两个时间点不冲突：RC 是项目成熟度阶段，0.69.0 是 RC 阶段中的具体 0.x 包版本；不要把“RC”误读成 1.0 已发布。它已明显超出早期 demo，但仍处于 1.0 前的快速迭代阶段，API 与包之间仍有持续调整；例如近期发布涉及模型调用重试、跨模型历史兼容、思考与工具块顺序、工具调用预算和新 middleware hook。npm 页面使用相对发布时间，报告采用可核对的 GitHub 发布日期；采纳时仍应检查 npm dist-tag 和锁文件中的精确版本。[RC 公告](https://tanstack.com/blog/tanstack-ai-rc) · [npm 包版本](https://www.npmjs.com/package/@tanstack/ai) · [GitHub Releases](https://github.com/TanStack/ai/releases)

官方 Beta 公告曾报告 265 个确定性 E2E 场景覆盖 10 个模型 provider；主仓库当前也规定新行为需覆盖 E2E，并使用 Playwright 与 aimock 测试。这个数字是 **2026-06 的官方快照**，不应误读成当前所有功能、所有 provider / model 组合都等价覆盖。 provider 支持矩阵仍然重要，特性不支持时会按矩阵跳过，不是所有模型都具备同一能力。[Beta 与测试说明](https://tanstack.com/blog/tanstack-ai-beta) · [当前仓库贡献 / 测试说明](https://github.com/TanStack/ai/blob/main/CLAUDE.md)

## 2. 核心 API 和运行模型

常规入口是 `chat({ adapter, messages, tools, middleware, ... })`，返回一条带 AG-UI 事件的异步流。adapter 把统一的文本 / 模态活动转成上游 provider 请求；`toolDefinition()` 提供类型化工具定义；`agentLoopStrategy` 决定模型继续循环的条件。默认策略最多进行 5 次模型轮次，并在模型以长度上限结束时停止；工具调用数、每轮并行工具数可以再单独限额。工具会默认并行执行，可通过 `toolExecution: 'sequential'` 改成串行。[Chat API](https://tanstack.com/ai/latest/docs/api/ai) · [Agentic Cycle](https://tanstack.com/ai/latest/docs/chat/agentic-cycle) · [Tools](https://tanstack.com/ai/latest/docs/tools/tools) · [发布记录中的调用预算变化](https://github.com/TanStack/ai/releases)

它的关键抽象更像：**一个请求 / run 内由 chat engine 执行模型—工具—模型的循环**。模型工具决策可以动态，但领域级阶段顺序、案件状态变更、复杂条件分支与持久工作流仍需要应用代码或其他编排器来定义。`middleware` 可以观察和改写配置、流块、工具调用、usage、错误等生命周期，也可以拒绝工具调用或插入业务逻辑；这给扩展留了很大空间，但 middleware 本身不是有节点边界和 checkpoint 语义的工作流图。[Middleware 指南](https://tanstack.com/ai/latest/docs/advanced/middleware) · [Middleware API](https://tanstack.com/ai/latest/docs/reference/interfaces/ChatMiddleware)

当前还支持 typed agents / subagents：父 chat 可启动子 agent，子 agent 可以有工具、中断及嵌套 subagents，并把运行事件关联回 UI。它增强了同一 chat runtime 下的委派能力，但仍与“我需要一个可见的案件状态图，控制何时理解需求、搜索、评估、复核、追问、恢复”不是同一个层次。[Subagents](https://tanstack.com/ai/latest/docs/chat/subagents)

### 工作流 / orchestrator 的状态必须谨慎表述

TanStack 官方曾在 2026-05 展示 `@tanstack/ai-orchestration`，含 generator workflow、router / orchestrator、状态 delta、审批和 React hooks；但当时公告明确写明它是 **未合并、未发布、不可从正常 npm 版本安装的实验 PR 构建**，生产级持久化也仍属未来 / 实验接口。2026-08 的 RC 公告仍把更丰富的 agent workflow / orchestration 列为接下来的计划方向。因此，不能把那篇实验文章当成当前稳定 npm 发行版已提供了替代 LangGraph 的功能。[Workflow / Orchestrator 实验公告](https://tanstack.com/blog/tanstack-ai-orchestration) · [RC 公告](https://tanstack.com/blog/tanstack-ai-rc)

截至本次调研，TanStack 另有独立的 **TanStack Workflow** 仓库。它不是 `@tanstack/ai` 的一个隐含模块：`workflow-core` 把普通 async function 建模成可重放工作流，用 `ctx.step()` 记录副作用结果，并提供等待事件、审批和定时器等原语；其仓库状态说明 core 已提供内存 RunStore，而 workflow runtime 和 Postgres / D1 / host adapters 仍标记为实验。另有 `@tanstack/ai-orchestration` 的 workflow-backed PR 线索，但未在当前 AI SDK 的稳定文档 / 常规包说明中找到可据以判断已稳定发布的依据。更严谨的结论是：TanStack 生态正在补齐 durable workflow 能力，但这是与 AI runtime 分离、且成熟度不同的另一套抽象，不能据此说 `@tanstack/ai` 已经有 LangGraph 等价图引擎。[TanStack Workflow 仓库与状态](https://github.com/TanStack/workflow) · [Workflow 持久化模型](https://github.com/TanStack/workflow/blob/main/docs/guide/persistence.md) · [AI orchestration 实验公告](https://tanstack.com/blog/tanstack-ai-orchestration)

### 两个容易误读的“harness / orchestration”术语

TanStack AI 的 **Code Mode** 允许模型在隔离执行环境里写 TypeScript 小程序，用 `for`、条件分支、`Promise.all` 组合已注册工具，再把执行结果交回 `chat()`；它的优化目标主要是减少逐工具来回的模型轮次和上下文开销。它是“模型生成程序来组合工具”的执行方式，并不负责 TactiScout 的案件状态、领域节点顺序、何时追问或跨轮 checkpoint。把球探策略交给任意生成代码还会扩大权限边界，除非有经过测量的收益和严密工具白名单，否则不适合作为当前主链路。[Code Mode 文档](https://tanstack.com/ai/latest/docs/code-mode/code-mode) · [Agentic Cycle 文档](https://tanstack.com/ai/latest/docs/chat/agentic-cycle)

文档中的 **sandbox harness adapter** 则指将 Claude Code、Codex、OpenCode、Grok Build 或 ACP agent 启动在一个 sandbox 中，并把它们输出转成 TanStack chat stream。这是“编码代理运行时适配器”，不是一般意义上用于评估球探 Agent 的 harness。命名相同容易误导：它对 TactiScout 目前没有直接产品价值。[Sandboxes 概览](https://tanstack.com/ai/latest/docs/sandbox/overview) · [Harness adapters](https://tanstack.com/ai/latest/docs/sandbox/harnesses)

## 3. Provider、模型与本项目的本地模型

官方 provider 包覆盖 OpenAI、Anthropic、Gemini、Vertex、Ollama、OpenRouter、Groq、Grok、Bedrock、Cloudflare、BytePlus、fal 等多种 provider / modality；包按 text / image / audio / video 等 activity 拆分并强调 tree-shaking。模型 adapter 具有 per-model capability 元数据和 provider-native option 类型，可在编译期限制错误的模型 / 模态 / 工具组合。这个“具体模型能力的类型安全”是它很突出的工程价值，但并不保证 provider 行为完全一致；供应商 API 演进和功能矩阵仍需要测试。[Provider 与 package 总览](https://tanstack.com/ai/latest/docs/getting-started/overview) · [适配器扩展 / capability 约定](https://tanstack.com/ai/latest/docs/community-adapters/guide) · [模型选项迁移说明](https://tanstack.com/ai/latest/docs/migration/migration)

TactiScout 当前通过 `@langchain/openai` 的 `ChatOpenAI` 对接 Ollama 的 OpenAI-compatible endpoint，并由服务端环境变量配置模型。TanStack AI 有专门的 `@tanstack/ai-ollama` adapter，也能用 `openaiCompatible({ baseURL, apiKey, models })` 接本地兼容服务；因此**技术上能对接当前本机模型**。不过更换 provider SDK 不会自动解决模型工具调用质量、模型上下文限制、工具选择可靠性或案件调度问题；这些还得用当前的本地 harness 对照验证。[Ollama adapter](https://tanstack.com/ai/latest/docs/adapters/ollama) · [OpenAI-compatible adapter（含 Ollama / vLLM 示例）](https://tanstack.com/ai/latest/docs/adapters/openai-compatible)

## 4. 工具、审批、中断与 streaming

- **工具契约：** `toolDefinition()` 可由服务端实现 `.server()`，或客户端实现 `.client()`；同一输入 / 输出 schema 可在前后端共享。服务端决定模型可见工具，静态注册是默认安全边界。多个服务端工具可并行或串行；工具可以发 typed custom progress event。 [Tools](https://tanstack.com/ai/latest/docs/tools/tools) · [Client Tools](https://tanstack.com/ai/latest/docs/tools/client-tools)
- **工具审批：** 工具可标注 `needsApproval`，执行暂停并将待决信息呈给客户端；用户批准后原工具才继续执行。MCP tools 也可通过 allowlist / filter 与 approval gate 控制。 [Tool Approval Flow](https://tanstack.com/ai/latest/docs/tools/tool-approval) · [MCP Tools](https://tanstack.com/ai/latest/docs/tools/mcp)
- **通用追问：** interrupt 可以由 middleware / interrupt definitions 表达；第一轮结束为 interrupt，客户端带答案发起 continuation run。它提供通用“暂停 / 传答案 / 继续”的协议，而不是自动判断什么时候该问足球领域里的问题。[Interrupts](https://tanstack.com/ai/latest/docs/interrupts/overview) · [Apply Answers](https://tanstack.com/ai/latest/docs/interrupts/apply-answers)
- **Streaming：** server 通过 SSE / HTTP stream / JSON helpers 输出 AG-UI 事件；client 有 framework-agnostic headless `@tanstack/ai-client` 和 React `useChat` 等绑定。AG-UI 带 run、message、tool、state 等事件协议，能与其他 AG-UI-compatible server/client 互通。 [Overview](https://tanstack.com/ai/latest/docs/getting-started/overview) · [AG-UI migration / interoperability](https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance)
- **应用级进度仍要自己设计：** 事件协议不会知道 TactiScout 的“理解需求 / 扩围检索 / 位置族确认 / 证据复核”意味着什么。产品仍需定义阶段事件、数据白名单、错误语义和进度文案。当前 TactiScout 的阶段事件是从 LangGraph custom events 映射成 UI 使用的安全进度；这与 TanStack 的 AG-UI 标准事件不冲突，但两者之间需要明确的 mapping。[本仓库架构说明](../../../docs/architecture.md)

### Runtime 和 React 客户端是可分开采用的两层

这里的“TanStack AI”容易被当作一个整体，但几个包的职责不同：`@tanstack/ai` 是模型 adapter、`chat()` 和工具循环的服务端 runtime；`@tanstack/ai-client` 是独立的无框架 chat 状态 / stream client；`@tanstack/ai-react` 是使用该 client 的 React hook。官方文档明确说 TanStack client 能连接其他 AG-UI server。因此，**只试用 React client 并不要求把 LangGraph 后端换成 `@tanstack/ai`**。React hook 可以通过 SSE connection adapter 指向兼容的 AG-UI endpoint，或由 `@tanstack/ai-client` 自定义 connection adapter；这仍会改变前端消息 / stream 状态管理，而不会自动接管 TactiScout 案件生命周期。[包职责总览](https://tanstack.com/ai/latest/docs/getting-started/overview) · [React `useChat` 与 connection adapters](https://tanstack.com/ai/latest/docs/api/ai-react) · [TanStack AI client](https://tanstack.com/ai/latest/docs/api/ai-client) · [其他 AG-UI server 的 client tool 说明](https://tanstack.com/ai/latest/docs/tools/client-tools)

### 把现有 LangGraph 接到 AG-UI：协议可复用，产品语义仍需适配

`@ag-ui/langgraph` 是 AG-UI 社区维护的 LangGraph adapter，不是 TanStack AI runtime 的一部分。README 声称支持 “local TypeScript graphs”，但示例仍通过 `deploymentUrl` 创建 `LangGraphAgent`。当前 TypeScript 实现构造 `@langchain/langgraph-sdk` 的 `Client` 并使用 `deploymentUrl`；AG-UI 仓库的 TypeScript issue #952 仍以开放状态请求“直接接收进程内 compiled graph”的 `LangGraphLocalAgent`。这说明“本地 LangGraph Server”与“同一 Node 进程内直接运行 graph”不能混为一谈。较早的 discussion #397 也记录了使用者遇到 README 声明与 Fastify 进程内 graph 实际接口不一致。另一个较早的 issue #444 回复说通过 TypeScript integration 已支持，但结合当前源码和仍开放的 #952，这句话更合理地理解为支持通过 LangGraph Server 接入，而不能作为进程内 graph 支持的证据。对 TactiScout，应按“现有进程内 graph 尚无已证实的官方 TypeScript 直连 adapter”规划：优先用自有 Fastify route 做薄 AG-UI 映射；若采用 `@ag-ui/langgraph`，先确认是否可通过本地 LangGraph Server 满足部署需求，并以锁定版本验证。[npm `@ag-ui/langgraph`](https://www.npmjs.com/package/@ag-ui/langgraph) · [TypeScript adapter README](https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/langgraph/typescript/README.md) · [TypeScript adapter source](https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/langgraph/typescript/src/agent.ts) · [进程内支持请求 #952](https://github.com/ag-ui-protocol/ag-ui/issues/952) · [Fastify 本地图讨论 #397](https://github.com/ag-ui-protocol/ag-ui/discussions/397) · [较早的 TypeScript 集成说明 #444](https://github.com/ag-ui-protocol/ag-ui/issues/444)

即使 adapter 能直接驱动本地图，TactiScout 也不是现成的标准 chat endpoint。现在 Fastify 的 turn route 收到带 `caseId`、`requestId`、已确认需求 / 回答的 JSON 后，调用既有 LangGraph graph；完整结果以 JSON 返回，进行中的阶段由另一个 progress endpoint 轮询，另有独立 cancel endpoint。AG-UI 要求将请求与结果改为带 `threadId` / `runId` 的事件流，并提供消息、工具、step、状态和 interrupt 事件。可以把 `threadId` 映射到 `caseId`、`runId` 映射到 `requestId`，但这只是起点。[Turn API](../../../src/app/routes/recruitment-turn.ts) · [Progress 与 cancel API](../../../src/app/routes/recruitment-progress.ts) · [前端 API client](../../../web/src/features/recruitment/lib/api.ts) · [Graph streaming / resume](../../../src/recruitment/conversation.ts)

必须逐一保留或重新设计的语义包括：

| 当前产品语义 | AG-UI 适配工作 |
|---|---|
| `caseId` 是持久案件 / LangGraph checkpoint identity | 映射到 `threadId`，并验证多标签页、旧案恢复和租户隔离（若以后有） |
| `requestId` 做同案 turn 幂等、队列和取消关联 | 映射到 `runId` 并保留服务端 idempotency；不能只依赖浏览器每次生成 run id |
| 位置选择、球员身份消歧等结构化答案会恢复不同 interrupt | 把已有 `Command(resume: ...)` 输入转换为 `resume[]` payload，再确认问答 schema / cancel sentinel 不改变图逻辑 |
| 当前进度只暴露允许前端看到的阶段文案 / 事件 | 只输出白名单 `CUSTOM` / `STEP_*` 等投影；禁止把整个 LangGraph state 或 RAW event 发到浏览器 |
| 完整报告包含大量球员指标、来源证据及审查结果 | 决定是否作为最终 message、typed state delta，或保留原 JSON report API；不要因采用 chat hook 而把完整报告塞进对话历史 |
| 同案串行器、AbortSignal、取消竞态与恢复后续 turn | 证明 AG-UI stream disconnect / cancel 确实传到现有 coordinator 和 graph signal；协议的 run 取消不自动等于本应用队列正确释放 |

这不要求替换 LangGraph。一个实际可控的方案是 **Fastify 保留为边界，新增一个 AG-UI endpoint / mapper，底层仍调用同一个 `createRecruitmentConversation` 与同一份 SQLite checkpoint**；前端再单独试 `@tanstack/ai-client` 或 `@tanstack/ai-react`。它的收益是标准化事件 / 多客户端互操作，不是提升球探搜索或 planner 的推理能力。

适配器的安全与带宽要单独审查。AG-UI 的协议本身定义了完整 `STATE_SNAPSHOT` 和增量 `STATE_DELTA`；应用负责决定哪些 state/message 有权投影给客户端。针对 `@ag-ui/langgraph@0.0.43` 曾有公开 issue 报告 RAW event 和每事件 state snapshot 带来重复数据及敏感 prompt / tool payload 暴露风险；维护者后续加入了 RAW 开关，但当前源码默认 `emitRawEvents: true`，快照频率 / 大 state 是否在 0.0.45 已改善仍需实测。因此不能把 adapter 默认流直接交给 UI；只允许安全 DTO 白名单，测量实际 SSE 字节数，并在生产选项中显式关闭原始事件。[AG-UI snapshot / delta 规范](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx) · [0.0.43 放大与泄漏报告](https://github.com/ag-ui-protocol/ag-ui/issues/2600) · [adapter source 中的 RAW 默认值](https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/langgraph/typescript/src/agent.ts)

## 5. 持久化、状态与部署边界

TanStack 文档把三个容易混淆的东西分开：

1. **Thread / chat persistence：** `@tanstack/ai-persistence` 的 middleware 可保存 messages、runs、interrupts、metadata；浏览器 client hydration 是另一层。官方列出 memory、Drizzle、Prisma、D1 等 store/backend 选项，并允许用户实现 store adapter。
2. **Resumable stream：** 将每个 run 已发出的 chunks 记录成带 offset 的有序日志，断线后重放，不重新调用 provider。内置 `memoryStream()` 仅适合开发和单进程；跨进程部署应接 durable stream backend 或实现自己的 `StreamDurability`。
3. **Sandbox / detached run durability：** 沙箱实例、agent run journal / takeover 属于独立能力，不等同于聊天记录，也不会自动保存 sandbox 文件。

所以 TanStack AI **可以持久化对话与用户审批，但它的 persistence 概念不能直接等同于 LangGraph checkpoint**。在本仓库里，LangGraph checkpoint 保存图状态，里面有需求解析、调查记录、待问问题、候选评估与案件进度；TactiScout 还拥有本地 SQLite checkpoint、同案串行和请求取消策略。若替换，需要证明图状态、取消和恢复语义全部能无损映射，不能只看到“TanStack 支持 persistence”就认为等价。[Persistence overview](https://tanstack.com/ai/latest/docs/persistence/overview) · [Persistence store controls](https://tanstack.com/ai/latest/docs/persistence/controls) · [Resumable streams](https://tanstack.com/ai/latest/docs/resumable-streams/overview) · [Custom stream adapter](https://tanstack.com/ai/latest/docs/resumable-streams/custom-adapter) · [Sandbox durability](https://tanstack.com/ai/latest/docs/sandbox/durability) · [本仓库 LangGraph ADR](../../../docs/adr/0010-langgraph-stategraph-for-recruitment-cases.md)

TanStack AI 是框架无关的，文档展示 Next.js、TanStack Start、Express、Remix、React Router、React Native 等接入方式。当前 TactiScout 则是 Fastify + React/Vite；概念上可组合，但需做一个小型适配验证 Fastify Response / SSE 行为、AbortSignal 传播、AG-UI 请求格式和现有的 caseId/requestId 协议；官方支持矩阵里没有“Fastify 的专用集成包”承诺。[Overview: framework support](https://tanstack.com/ai/latest/docs/getting-started/overview) · [本仓库架构](../../../docs/architecture.md)

## 6. 测试、维护和对抗性观察

**有利证据：** 官方公开了跨 provider 的确定性 E2E 方案、mock provider 服务、Playwright 浏览器执行和 feature support matrix。对一个底层 SDK 来说，这是好的维护信号；团队也在发行记录中持续补模型 / 工具边界、错误码、retry、跨模型历史与安全边缘行为。[测试设计文章](https://tanstack.com/blog/how-we-test-tanstack-ai-across-7-providers) · [Beta 测试快照](https://tanstack.com/blog/tanstack-ai-beta) · [发布记录](https://github.com/TanStack/ai/releases)

**不应忽视的风险：** 1) 仍在 RC，且当前文档规模非常大、package surface 持续增长；需要锁定同一组包版本，避免 `@tanstack/ai`、client、provider adapter、React binding 混用不兼容版本。2) provider 兼容依赖模型能力矩阵；generic OpenAI-compatible endpoint 的类型声明是用户提供的，不代表其每种原生特性都正确实现。3) memory stream 单进程、持久化 store 和锁需要针对部署拓扑选型，默认 demo 不是多实例生产方案。4) 官方自己的 0.x 发布在数月内经历过 API 重构 / 命名迁移；如果它只是被拿来替换已工作的一层，将增加迁移成本而非减少复杂度。[RC 公告](https://tanstack.com/blog/tanstack-ai-rc) · [OpenAI-compatible 能力边界](https://tanstack.com/ai/latest/docs/adapters/openai-compatible) · [migration guide](https://tanstack.com/ai/latest/docs/migration/migration) · [resumable stream 部署差别](https://tanstack.com/ai/latest/docs/resumable-streams/overview)

## 7. 对照 TactiScout：能力归属

TactiScout 当前由 [案件图组合入口](../../../src/recruitment/conversation.ts)、[Planner 接口和策略](../../../src/recruitment/recruitment-planner.ts)、[LangGraph ADR](../../../docs/adr/0010-langgraph-stategraph-for-recruitment-cases.md) 共同表达这些事实：

| 需求 | TactiScout 当前所有者 | TanStack AI 对应能力 | 是否等价 |
|---|---|---|---|
| 决定下一项球探调查动作 | Planner + StateGraph conditional routing | chat 的模型工具调用循环、middleware | 部分重叠；TanStack loop 可挑工具，但不是本应用有业务节点的案件图 |
| 候选搜索、角色方法 RAG、评估、Reviewer | 领域工具节点和 evaluator / reviewer | typed tools、MCP、subagent、middleware | 执行机制可复用；领域策略仍需应用拥有 |
| 用户在对话中补充关键信息后恢复同一案 | `interrupt()` + SQLite LangGraph checkpoint | Interrupts + chat persistence | 同属暂停 / 恢复，但状态模型与存储语义不同 |
| 多轮案件状态、工具证据和条件回退 | LangGraph typed state、reducers 和 edges | messages、runs、interrupts、metadata + chat loop | TanStack 存运行 / 对话信息；当前没有稳定图边 / 图 checkpoint 的 1:1 等价接口 |
| 流进度和自定义工作台 | LangGraph custom event → API 白名单投影 → React report panel | AG-UI event + useChat / client | 可能协议互通；产品阶段和安全映射仍需自建 |
| 多个 UI 共用一个 agent transport | 目前是自有 Fastify API / React hooks | `@ag-ui/langgraph` 事件适配 + `@tanstack/ai-client` / `@tanstack/ai-react` | 可标准化 transport，但需迁移事件模型、run/thread 标识和前端状态；与 TanStack runtime 无强依赖 |
| 同案排队、幂等、主动取消 | Fastify turn coordinator + LangGraph signal propagation | AbortSignal、run persistence / locks 能提供部分 primitives | 需要重新实现与验证本项目特有的队列 / request id 语义 |

这个项目不是普通“模型 + tools 的 chat”。已有 LangGraph 是核心产品机制的一部分，负责模型什么时候能做下一步、什么时候暂停、何时可复用案件状态。TanStack AI 也能支持很多 agent app 模式，但若直接把其 `chat()` 作为新后端中心，就会把显式图控制改写成模型工具循环，削弱目前可验证的案件生命周期边界。

## 8. 建议

### 现在

1. **保留 LangGraph 和当前 `RecruitmentPlanner` seam。** 不把 TanStack AI 的 `chat()` 加进主链路，不替换 `ChatOpenAI`。后者属于模型适配层，当前实现已被本地 OpenAI-compatible/Ollama 使用；更换 SDK 不会自动提升足球推理或推荐质量。
2. **不为采用它而迁移自定义工作台。** 目前前端展示的是案件阶段、来源与证据、进度轨迹及报告投影，`useChat` 并不会替你定义这些产品状态。若只想用 React client，应先验证它消费自有 AG-UI endpoint 的改造价值，而不是改换 `@tanstack/ai` runtime。
3. **把 TanStack AI 列为技术观察 / 有需求时再评估。** 重点关注其稳定版发布、正式工作流编排 API、跨框架 AG-UI 客户端，以及对 abort / persistence store 的生产约束。

### 什么情况下值得做试验

如果将来需求变成“除了本地 web app 之外，还要给独立移动端 / 多 UI consumer 统一 agent 协议”，可以做一个不改案件图的纵向小实验。由于当前 TypeScript adapter 没有证据表明能直接接收本项目的进程内 compiled graph，第一步应从现有 Fastify route 和 LangGraph events 写最薄的 AG-UI mapper；仅当团队愿意额外运行 LangGraph Server 时，再对 `@ag-ui/langgraph` 的服务端连接方式做独立验证。第二步只把现有**安全进度事件与 assistant message**投影成 AG-UI；使用 headless `@tanstack/ai-client` 消费，再单独试 React `useChat`，避免同时改后端 runtime 与 UI 状态。用同一冻结 scenario 验证：普通回合、`positionAnswer` / `playerIdentityAnswer` 两类 interrupt 恢复、case checkpoint 续接、工具 / 节点事件、取消后同案下一回合继续、错误语义、敏感字段拒绝投影、SSE 字节量与报告完全一致。只有当它减少自维护的传输 / client 状态代码，而且不让安全投影、队列和产品报告变得更复杂，才继续。

若目标是用 TanStack AI 替换 LangGraph，则需要另做 matched harness：同一冻结案件、同一模型 / 工具 / 数据快照，比较追问正确性、候选证据完整性、同案恢复、取消、工具错误处理、token / latency / 代码维护面。当前没有这项跨框架实验结果，因此不能宣称哪一套绝对更优。

## 来源索引（官方 / 一手）

- [TanStack AI 官方文档总览](https://tanstack.com/ai/latest/docs/getting-started/overview)
- [TanStack/ai GitHub 仓库](https://github.com/TanStack/ai)
- [GitHub Releases](https://github.com/TanStack/ai/releases)
- [RC 阶段公告，2026-08-21](https://tanstack.com/blog/tanstack-ai-rc)
- [Beta 与跨 provider 测试，2026-06-09](https://tanstack.com/blog/tanstack-ai-beta)
- [实验工作流 / orchestrator 公告，2026-05-28](https://tanstack.com/blog/tanstack-ai-orchestration)
- [Chat / agentic loop API](https://tanstack.com/ai/latest/docs/api/ai) · [Agentic cycle](https://tanstack.com/ai/latest/docs/chat/agentic-cycle)
- [Middleware](https://tanstack.com/ai/latest/docs/advanced/middleware) · [Tools](https://tanstack.com/ai/latest/docs/tools/tools) · [Approvals](https://tanstack.com/ai/latest/docs/tools/tool-approval)
- [Interrupts](https://tanstack.com/ai/latest/docs/interrupts/overview) · [Subagents](https://tanstack.com/ai/latest/docs/chat/subagents)
- [Ollama adapter](https://tanstack.com/ai/latest/docs/adapters/ollama) · [OpenAI-compatible adapter](https://tanstack.com/ai/latest/docs/adapters/openai-compatible)
- [Chat persistence](https://tanstack.com/ai/latest/docs/persistence/overview) · [Persistence controls](https://tanstack.com/ai/latest/docs/persistence/controls)
- [Resumable streams](https://tanstack.com/ai/latest/docs/resumable-streams/overview) · [Custom durability adapter](https://tanstack.com/ai/latest/docs/resumable-streams/custom-adapter)
- [AG-UI migration / interoperability](https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance)
- [TanStack React client API](https://tanstack.com/ai/latest/docs/api/ai-react) · [TanStack headless client API](https://tanstack.com/ai/latest/docs/api/ai-client)
- [AG-UI LangGraph TypeScript adapter](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/langgraph/typescript) · [npm `@ag-ui/langgraph`](https://www.npmjs.com/package/@ag-ui/langgraph) · [AG-UI event / snapshot model](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx)
- [TanStack Code Mode](https://tanstack.com/ai/latest/docs/code-mode/code-mode) · [Sandboxed coding-agent harness adapters](https://tanstack.com/ai/latest/docs/sandbox/harnesses)
- [TanStack Workflow](https://github.com/TanStack/workflow) · [Workflow persistence model](https://github.com/TanStack/workflow/blob/main/docs/guide/persistence.md)
- [TanStack AI testing article](https://tanstack.com/blog/how-we-test-tanstack-ai-across-7-providers)
