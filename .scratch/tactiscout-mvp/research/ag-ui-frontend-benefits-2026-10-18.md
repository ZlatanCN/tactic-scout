# AG-UI 前端接入的实际收益

**调研日期：** 2026-10-18  
**范围：** AG-UI 协议、TanStack AI React client，以及当前 TactiScout 的 Fastify + LangGraph + React/Vite 对话链路。只做架构调研；没有修改应用代码。

## 结论

对 TactiScout 来说，AG-UI 的直接价值是**标准化服务端与前端之间的事件传输，并把当前轮询式进度改为事件流**。TanStack AI 的 `useChat` 可以进一步接管 SSE 解析、消息/运行状态和一些通用回调。

它不会提高球探推理质量，也不会替应用决定何时追问、如何解释阶段或呈现球员报告。若短期只有这一套 React 网页、当前进度体验也够用，全面迁移的收益不大；若要提高长任务的进度即时性，或以后让另一种前端/Agent UI 复用同一个服务，**值得做一个保持现有案件图不变的小型端到端实验**。AG-UI 是协议，TanStack AI client 是协议消费者；两者可以分开采用。

## 当前链路基线

- 前端发 `POST /api/v1/recruitment/cases/:caseId/turns`，正文是 TactiScout 自己的 JSON：消息、是否恢复已有状态、`requestId`，以及可选的位置答案/位置更新/球员身份答案。Fastify 等 LangGraph 回合结束后返回一个完整 JSON，其中包含状态、问题、报告和进度事件。[前端请求封装](../../../web/src/features/recruitment/lib/api.ts) · [Fastify 回合路由](../../../src/app/routes/recruitment-turn.ts) · [回合响应契约](../../../src/domain/conversation.ts)
- 调查期间，另一个 hook 每 1.2 秒请求 `/progress` 快照；停止操作走单独的 `POST .../cancel`。进度当前最多保留 24 条，并在服务进程的内存 Map 中按案件保存。[进度 hook](../../../web/src/features/recruitment/hooks/useRecruitmentProgress.ts) · [进度与取消路由](../../../src/app/routes/recruitment-progress.ts)
- React 前端自己维护案件对话、追问答案控件、报告、等待时长、失败恢复、幂等请求状态；活动会话写 `sessionStorage`，已保存计划和报告快照写 `localStorage`。[会话 hook](../../../web/src/features/recruitment/hooks/useRecruitmentSession.ts) · [计划与消息模型](../../../web/src/features/recruitment/lib/plans.ts) · [会话存储](../../../web/src/features/recruitment/lib/active-session.ts)
- 现有进度并非只有一个“正在思考”动画：LangGraph 节点已经发出阶段事件，API 将其投影为前端可见的阶段和安全消息；报告仍是结构化领域对象。[架构说明](../../../docs/architecture.md) · [进度事件类型](../../../src/domain/conversation.ts)

这说明实验目标应是改进**事件传递与前端消费**，而不是再做一套 Agent，也不是把进度轮询改成逐字展示 Planner 的思考内容。

## AG-UI 与 TanStack AI client 分别带来什么

### 协议层收益

AG-UI 用 HTTP 请求承载 `threadId`、`runId`、消息、工具和扩展属性，再用带类型的事件流表达运行生命周期、文字、工具、状态、活动和自定义事件。它的目标是让 Agent 与 UI 通过共享线格式通信；它本身不是 Agent runtime，也不规定 TactiScout 的业务决策。[AG-UI 事件模型](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx) · [AG-UI 架构](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/architecture.mdx) · [基础协议规范](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/basic/index.mdx)

对本项目而言，这能建立稳定的跨界约定：把案件 `caseId` 映射为 `threadId`，把本轮 `requestId` 映射或关联到 `runId`，用标准运行事件表示开始、结束和错误，用 TactiScout 自定义事件承载已经脱敏的阶段进度。后续 UI 不必理解 LangGraph 自己的 stream 细节。TanStack 官方说明其 client 可连接外部 AG-UI server；这不要求后端使用 TanStack 的 `chat()` runtime。[TanStack AG-UI 互操作说明](https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance)

### TanStack React client 的增量收益

`@tanstack/ai-react` 的 `useChat` 建立在 headless `@tanstack/ai-client` 上，支持 `fetchServerSentEvents`、消息状态、`isLoading`、错误/完成回调和流 chunk 回调。TanStack 文档也明确说明，外部 AG-UI server 的事件可以被 client 消费；自定义事件可通过 `onCustomEvent` 交给应用处理。[React API](https://tanstack.com/ai/latest/docs/api/ai-react) · [外部 AG-UI server 兼容说明](https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance) · [自定义事件 UI 示例](https://tanstack.com/ai/latest/docs/code-mode/client-integration)

它可能减少项目自己维护的 SSE 解码、运行生命周期与消息流 glue code；但它不是现成的 TactiScout 工作台。最终问题控件、足球场位置选择器、球员身份消歧卡片、证据报告和本地计划仍由应用渲染和保存。

## 可预期收益与不能解决的问题

| 领域 | 可以带来的收益 | 对 TactiScout 的实际边界 |
|---|---|---|
| 进度延迟 | SSE 事件到达时即可更新 UI，不需要等下一次 1.2 秒轮询；也可只传增量，而不是反复读取整份进度快照。AG-UI 是事件流协议；TanStack 提供 SSE connection adapter。[协议事件](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx) · [TanStack transport](https://tanstack.com/ai/latest/docs/transports/overview) | 这是最直接的体验收益，但节点执行本身不会变快。事件太密、太技术化或 UI 不会解释，用户体验仍然差。 |
| 客户端传输代码 | TanStack `useChat` 可以处理通用 SSE chunk、消息累积、加载/错误状态、`stop()` 和回调。[useChat API](https://tanstack.com/ai/latest/docs/api/ai-react) · [取消约定](https://tanstack.com/ai/latest/docs/transports/overview) | 现有 hook 还负责案件恢复、幂等、计划保存、报告快照、表单回答和保留上一版报告。换成 `useChat` 不会自动删掉这些应用状态；如果两边都持有消息，还可能重复维护。 |
| 多端/多 Agent runtime 互通 | 如果以后有移动端、第二个工作台或其他 AG-UI-compatible UI，可复用相同请求/事件格式，而不是为每个消费端设计专有传输协议。[AG-UI 互操作](https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance) | 现在只有 React/Vite 工作台。若没有明确的第二个消费者，互操作的即时产品收益有限。 |
| 长报告处理 | 可以在 run 生命周期中发送结构化完成事件，前端收到后切到报告页；若未来报告文案确实逐步生成，也能流式展示文字。 | 现有核心结果是结构化 `RecruitmentReport`，不是长篇 token 文本。报告要保持证据对象、来源样本、未知值和审核信息完整，不能为了 `useChat` 把整个报告降格成文本消息。 |
| 追问/人工交互 | 协议可以带应用定义的状态/自定义事件，前端收到后展示追问。[AG-UI Custom event](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx) | 领域问题何时值得追问、位置选择和身份确认都由现有图与 schema 决定。TanStack 的 interrupt/审批 API 不会自动理解 LangGraph `interrupt()` 的 payload。需保留 TactiScout 的问题 schema 和回答端点语义。 |
| 取消 | TanStack `stop()` 会中止客户端活动请求并传递 AbortSignal。[TanStack run cancellation](https://tanstack.com/ai/latest/docs/transports/overview) | `stop()` 本身只是前端取消当前 stream。TactiScout 要确认服务端图真的停止、同案队列释放和下一回合能继续；现有显式 cancel endpoint 仍必须被调用或实现等价语义。TanStack 自己对持久/脱离 run 也区分连接断开与用户取消。[TanStack detached runs](https://tanstack.com/ai/latest/docs/sandbox/takeover) |
| 数据与 Agent 质量 | 无。 | 不改变 Planner 的足球知识、球员姓名解析、数据源覆盖、候选召回、评估规则或 Reviewer 结果。只换协议无法修复空名单和错误人选。 |

## 主要迁移成本与风险

1. **增加一个双向协议适配层。** 当前端点接收单条业务命令，并返回完整业务 DTO；AG-UI 请求模型携带消息历史、`threadId` / `runId` 和 `forwardedProps`。需要明确业务输入放在哪里并由服务端校验，不能信任任意客户端 `state` 或 `forwardedProps`。[TanStack RunAgentInput 格式与兼容说明](https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance)
2. **把同步等待式 turn 改为边执行边写流。** 当前 Fastify route 等 `recruitmentConversation.turn()` 返回后发送 JSON；实验版要在同一执行期间按顺序发送合法 AG-UI 事件，还要正确发 run terminal 事件、处理流中断和 Fastify response 生命周期。Vite/代理、浏览器断线和服务端异常要通过真实 HTTP 验证。
3. **不可混淆 thread、run、幂等 ID。** TactiScout 的 `caseId` 是 LangGraph checkpoint identity，`requestId` 用于去重、排队、取消和恢复。AG-UI 的 `threadId` / `runId` 提供关联标识，但协议本身不替应用定义同案串行、重放缓存和不确定结果恢复。TanStack client 的每次 send 会产生 run id；需要测试重发时如何保持 TactiScout 的 request id 语义。[TanStack thread/run 迁移文档](https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance)
4. **中断恢复要保留现有表单契约。** 位置答案和球员身份答案是带问题 ID 的结构化输入，不应被隐式转成普通文本。恢复同一 SQLite checkpoint、拒绝过期答案和选择位置后继续图执行都要保留。
5. **断线恢复不会因 SSE 自动具备。** 普通事件流能推送事件，但不会自动保证断线后补齐丢失的历史事件。实验需要保留现有 `/progress` 快照或设计带游标的服务端事件重放；不能把浏览器断开等同于服务端任务取消。TanStack 文档把可恢复流作为单独的 durability 能力讨论。[Resumable streams](https://tanstack.com/ai/latest/docs/resumable-streams/overview)
6. **前端消息所有权可能重复。** 当前 `ConversationMessage`、pending request、report、plans 与恢复状态有自己的 Zod schema 和存储迁移。`useChat` 又提供一套 UI message/run 状态。必须决定 TanStack client 只拥有“当前网络 run”，领域会话仍由 `useRecruitmentSession` 拥有，还是整合状态层；两份来源都可写就容易出现重复或恢复不一致。
7. **安全投影仍由 TactiScout 负责。** 只把进度白名单和已确认可展示的数据发给浏览器。不能转发 LangGraph 整体 state、Planner prompt、工具参数/结果中的内部信息，或未经产品筛选的原始 event。AG-UI `CUSTOM` 可以承载应用数据，但协议不会替应用做字段授权。[AG-UI custom event](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx)
8. **增加包版本和长期维护面。** 要锁定并一起升级 `@tanstack/ai-client` / `@tanstack/ai-react` 对应版本，另维护 AG-UI 映射器。TanStack 官方迁移说明记录了其 0.x wire 变化与弃用桥接，因此协议集成测试应作为依赖升级的门槛。[TanStack AG-UI migration](https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance)

## 建议的最小实验

先做一个**独立的实验端点和前端分支/模式**，不替换既有 JSON API，也不更改图、Planner、数据源、评估器或 checkpoint：

1. Fastify 新增一个实验 AG-UI endpoint。验证请求中的稳定 `threadId` 对应现有 `caseId`，`runId` 与服务端幂等/取消 `requestId` 的关联经显式验证；位置/身份等业务输入放在经过 Zod 校验的应用字段中。
2. 仍调用同一个 `recruitmentConversation.turn()`。仅把其现有白名单进度 DTO 转成 AG-UI `CUSTOM`（例如 `tactiscout/recruitment-progress`），并按 AG-UI 要求发 run 开始/完成/错误事件。结束事件携带一个带 schema 校验的 TactiScout 完成结果（报告保留为结构化对象）；不要发送原始 LangGraph state 或模型隐式推理。
3. 用 TanStack `fetchServerSentEvents` / `useChat` 消费实验端点；`onCustomEvent` 只更新调查时间线，现有 `RecruitmentReportPanel` 仍负责呈现报告。用户问题仍通过现有的结构化位置/身份 UI 回答，并在同一案件上恢复。
4. 保留主动 cancel endpoint；点击停止时调用 `stop()` 关闭前端流，同时调用服务端取消接口。断线恢复继续使用既有 request id 取回结果；试验不把断线当成取消。
5. 控制组使用现有 JSON turn + 轮询；实验组使用事件流。使用相同图、相同固定数据快照和同一冻结的简单场景：正常完成、需要追问并回答、位置结构化回答、身份结构化回答、网络断开后恢复、取消后同案下一回合。

### 验收指标

- **事件即时性：** 从服务端 `onProgress` 到浏览器渲染，实验组 p95 小于 300 ms（本机测试）；对照组按实测轮询间隔统计，不把目标当成已实现事实。
- **轮询量：** 正常连接时不再反复 GET progress；若为安全恢复保留轮询，仅在断线/不确定结果期间启动。比较每个运行的请求数和 HTTP 字节量。
- **业务结果一致：** 固定场景下，实验组的 `status`、追问 schema、report JSON、retry message 与对照组一致；不能丢 `brief`、source evidence、unknown/null 语义或报告快照。
- **可恢复性与幂等：** 同一网络请求重复提交不重复执行图/工具；断线后能恢复原 `requestId` 的最终状态而非新开一轮；历史阶段不丢或 UI 明确告知不可恢复。
- **取消闭环：** 用户停止后前端立即停止接收流，服务端 LangGraph 收到 signal；停止终态明确；同案排队的下一回合能继续。仅 abort HTTP stream 不能算成功。
- **安全：** 用 canary 字符串写入假 prompt/工具 payload/内部 state，验证流中只出现批准的进度和报告字段。
- **维护成本：** 统计为协议/客户端接入新增和删除的代码路径、测试与重复状态源。如果只是把轮询换成一个自定义 event stream，但多出两套消息状态和新的恢复逻辑，净收益不足，应停止。

## 决策门槛

**值得继续：** 同一案件链路完整，进度明显更及时，正常运行减少重复轮询，而且没有重复保存消息、不确定结果、取消、追问或安全性回归；或者确实准备让第二个 UI/runtime 消费同一 Agent 服务。

**不值得全面替换：** 只有一个 UI、进度及时性不构成用户问题、现有 hook 没有明显维护负担，而 TanStack client 要求复制会话状态或改变问题/报告渲染。此时可只采用 AG-UI 事件 DTO 的设计经验，保留现有端点。

因此当前推荐不是“全站改成 TanStack chat”，而是**先用同一 LangGraph 案件图做一条 AG-UI SSE 纵向切片**。它验证的核心假设是“协议化事件能带来可测的前端响应与维护收益”；不验证、也不声称提升 Agent 的球探能力。

## 一手来源

- [AG-UI 基础协议规范 1.0](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/basic/index.mdx)
- [AG-UI 事件目录与 Custom event](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx)
- [AG-UI 架构说明](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/architecture.mdx)
- [TanStack AI React `useChat` API](https://tanstack.com/ai/latest/docs/api/ai-react)
- [TanStack AI 与外部 AG-UI server 的兼容/迁移说明](https://tanstack.com/ai/latest/docs/migration/ag-ui-compliance)
- [TanStack AI Transport 与 abort 语义](https://tanstack.com/ai/latest/docs/transports/overview)
- [TanStack AI 自定义事件前端接收示例](https://tanstack.com/ai/latest/docs/code-mode/client-integration)
- [TanStack resumable stream 文档](https://tanstack.com/ai/latest/docs/resumable-streams/overview)
