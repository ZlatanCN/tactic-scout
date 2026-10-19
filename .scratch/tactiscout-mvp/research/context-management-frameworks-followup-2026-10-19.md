# Agent 上下文管理机制补充调查

研究日期：2026-10-19。只采用框架/平台官方文档。不同产品的“memory”所指并不相同；本文按短期会话状态、checkpoint、模型上下文裁剪/摘要、跨会话存储与检索拆开比较。文档描述的是能力与接口，不代表这些机制在 TactiScout 上会自动改善推荐质量或延迟。

## 结论先行

优秀 Agent 系统通常不会把“历史记录”“可恢复运行状态”“下一次模型调用能看到的上下文”“跨会话记忆”视为同一份内容：它们会分层存储，再按当前步骤选择一个有限视图提供给模型。框架的主要差异在于谁负责上下文整理：LangGraph 把流程状态和存储接口交给应用节点组合；OpenAI Agents SDK 提供 Session 与 Responses 专用压缩适配器；ADK 分开定义 Session/State 和可搜索 MemoryService；LlamaIndex 的 Memory 将 token 窗口、旧消息 flush 与 Memory Blocks 组合起来。

对 TactiScout 来说，优先解决**案件内事实和证据的按职责投影**，而非先增加跨会话“学习”。足球引援案件有强约束、可更正事实、指标证据和可追溯引用；这些不适合被一段自由文本摘要取代。

## 官方机制对照

| 框架/产品 | 短期状态与恢复 | 模型上下文整理 | 跨会话记忆/检索 | 关键边界 |
| --- | --- | --- | --- | --- |
| **LangGraph** | `thread_id` 将 graph state checkpoints 绑定到单个 thread；checkpointer 支持会话延续、interrupt、人类输入、故障恢复等。生产可用持久化 checkpointer。 | State 与 model prompt 是不同层：LangGraph 的设计指南建议 State 保存原始数据、在节点内按需格式化。核心 persistence API 的职责是保存 graph state；具体向模型提供什么由应用/节点决定。 | `Store` 以 namespace/key 保存跨 thread 的应用数据，节点可以按 query/limit 检索；官方支持语义搜索示例，也提供生产数据库 Store。 | checkpoint 不等同于“压缩后 prompt”，Store 也不会自动决定什么该记、何时注入。以上结论由 API 职责和官方设计指南综合得出。 |
| **Deep Agents（LangGraph 生态）** | 基于 LangChain 组件和 LangGraph 运行能力。 | 官方称 filesystem 工具可把大内容移出上下文；长对话会自动总结旧消息；子 Agent 可隔离探索上下文。 | 通过 LangGraph Memory Store 跨对话存取记忆；filesystem backend 可选内存、磁盘、Store 或 sandbox。 | 它是更高层、带约定的 harness，不是 LangGraph core 的默认行为。适合复杂通用任务，不代表 TactiScout 应引入完整 Deep Agents。 |
| **OpenAI Agents SDK (TypeScript)** | `Session` 在每轮前读取历史、每轮完成后持久化新输入/输出；可用 process-local `MemorySession`、OpenAI Conversations 或自定义后端。 | `sessionInputCallback` 可在每次模型调用前确定性合并/裁剪 history。`OpenAIResponsesCompactionSession` 可在阈值/自定义 hook 达成后调用 Responses `compact`，用缩短后的 item 列表替换 session history。压缩可放在每轮后，也可在流式回答结束后、轮间/空闲时手动执行。 | Session 是对话 history；SDK 的 sandbox `memory()` 是另一能力，面向未来 run 提炼 lessons 写入 workspace 文件，再按需读取。 | SDK 的自动压缩依赖 OpenAI Responses API，不能直接套用到 Ollama/任意兼容接口；压缩同步发生会让 stream 完成时间延后。 |
| **OpenAI Responses API** | `conversation` / `previous_response_id` 提供服务端会话延续；可选择本地传完整 input chain。 | `context_management.compact_threshold` 可触发服务端压缩；也有 stateless `/responses/compact`。compaction item 是加密且不可读的；standalone compact 返回的整个新窗口是后续 canonical input，应原样传回。 | conversation history 本身由 OpenAI 服务管理；API 文档说明 response 存储与 conversation item 有不同保留语义。 | 这是 provider 托管的模型上下文能力，不可移植；它不取代 TactiScout 自己的权威案件状态、证据读取和引用校验。 |
| **Google ADK** | `Session` 保存一条对话的 Events；`State` 有当前 session、user、app、invocation-temp 等作用域，由 `SessionService` 管理生命周期。 | ADK 把短期 Session/State 和长期 MemoryService 清晰分层；是否/如何将历史裁剪、总结后发给模型，依所选运行时/应用策略，不应把 Session 持久化误认为 token 窗口管理。 | `MemoryService` 可从已完成 session 或 event delta ingest，按 query 搜索；支持应用用 tool/callback 预加载或由模型需要时调用。具体服务可以是内存、本地数据库或云端实现。 | 作用域显式的设计值得借鉴；自动生成的跨会话记忆仍需权限、正确性和保留政策，不能直接吸收个人案件里的临时转会条件。 |
| **LlamaIndex Memory** | Memory 按 `session_id` 管理对话消息，供 agent/workflow 读取。 | 默认 Memory 受 `token_limit` 和 `chat_history_token_ratio` 控制：短期消息超过占比时，将较旧消息按 `token_flush_size` 移至长期 Memory Blocks；读取时把短期与长期记忆合并。提供 Static、Fact Extraction、Vector 等 blocks。 | VectorMemoryBlock 可从向量库检索消息批次；FactExtractionMemoryBlock 可从被 flush 的历史抽取事实。 | 文档当前给出的默认值（例如 30,000 token、0.7 比例、3,000 flush）是该框架的起始参数，不是跨模型/任务的最佳值；抽取和向量召回均需应用评测。 |

## 关键边界的补充核查

### LangGraph：checkpoint 保存 State，不等于把 State 自动塞进每个 prompt

**框架事实。** LangGraph checkpointer 按 `thread_id` 保存 graph State 的 checkpoints；官方将其归为 thread-scoped 的短期记忆。Store 是另外一套应用定义的 key-value 数据，面向跨 thread 的长期信息。LangGraph.js 的官方示例在节点里显式执行 `model.invoke(state.messages)`，而设计指南要求 State 保存原始数据、由节点在需要时格式化 prompt。因此，某个字段被 checkpoint 保存，并不意味着每个模型节点都会看见它；一个节点实际发给模型的内容，取决于该节点构造并传给 model 的消息/参数。反过来，如果节点直接把累积的 `messages` 全部传给模型，消息历史就会进入该次调用，checkpoint 本身不会自动替它裁剪或摘要。[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[Memory](https://docs.langchain.com/oss/javascript/langgraph/add-memory)、[Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)

**对 TactiScout 的推断。** 将 LangGraph 的 State/checkpoint 作为案件执行事实和恢复依据；为 Planner、证据分析、结论等节点分别构造请求视图。不要把“检查点变大”与“模型 prompt 变大”当成同一个问题，也不要假设设置 checkpointer 就获得了 compaction。

### Deep Agents：文件外置、自动摘要和子 Agent 是 harness 约定，不是 LangGraph core 行为

**框架事实。** Deep Agents 官方把自己描述为独立 harness：基于 LangChain 组件并使用 LangGraph 的运行能力。它提供文件系统工具，将大内容移出上下文；较长对话时自动总结较旧消息；并可委派给子 Agent 以隔离上下文。子 Agent 适合在独立工作上下文中做多步搜索后只回传精炼结论；若回传原始检索/工具结果，主上下文仍会膨胀。文件系统 backend 可选择内存、磁盘、LangGraph Store 或 sandbox。[Overview](https://docs.langchain.com/oss/javascript/deepagents/overview)、[Subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents)

**边界与推断。** 官方说明自动摘要会压缩旧消息，但这不构成对业务事实无损、精确保留或可追溯的保证。对 TactiScout，可借鉴“大型原始证据放在外部、按需读取”和“并行研究子任务只回传有证据的短结论”；案件硬条件、候选资格和指标证据仍应由结构化 State/证据记录负责，不能只依赖对话摘要。只有确有可并行、边界清楚的调研任务时才考虑子 Agent；单纯把 Planner 拆成更多 Agent 并不会自动缩小其实际 prompt。

### OpenAI Agents SDK：自动 compaction 可能延后 streaming run 的完成

**框架事实。** Agents SDK 的 `Session` 在每次 run 前读取历史，并在本轮完成后保存用户输入和模型输出。Responses 专用的 `OpenAIResponsesCompactionSession` 可在回合持久化后按阈值或 hook 调用 `responses.compact`，再替换 session 历史。官方 TypeScript 指南明确指出：自动 compaction 清除并重写底层 session，SDK 会等待它结束后才完成 streaming run；即使最后一个文本 token 已经显示，`result.completed` 仍可能因 compaction 多等待数秒。官方建议低延迟场景关闭自动 compaction，在流结束后、轮间或空闲时手动执行。[Sessions](https://openai.github.io/openai-agents-js/guides/sessions/)、[Streaming](https://openai.github.io/openai-agents-js/guides/streaming/)

**对 TactiScout 的推断。** 任何“最后一个 token 已到”之后还要等待的维护工作都应单独计入用户感知完成时间。若未来确实引入摘要，优先在模型调用前做必要的同步整理；可延期的历史摘要/归档放到结束后或空闲任务，并确保下一轮请求仍有可用的紧凑视图。该 SDK 的 Responses compaction 是 OpenAI API 能力，不能因为模型提供 OpenAI-compatible Chat Completions 接口就假定可用，也不适用于当前 Ollama 请求路径。

### 持久用户记忆与案件状态必须有不同的所有权与生命周期

**框架事实。** LangGraph 明确区分：checkpointer 保存一个 thread 的 graph State；Store 保存应用定义、跨 thread 的数据。官方示例不是让 Store 自动学习或自动灌入 prompt，而是在节点中按 `userId` namespace 显式检索，再把结果拼入 system message；写入也由应用代码决定。ADK 采用相近的显式作用域：无前缀 State 属于当前 session，`user:` 属于该用户跨 session 的状态，`app:` 属于应用共享状态，`temp:` 只存在于当前 invocation。LlamaIndex 的 Memory 则把按 session 维护的短期消息队列、超限 flush 和可选长期 Memory Blocks 组合成一套高层组件。[LangGraph Memory](https://docs.langchain.com/oss/javascript/langgraph/add-memory)、[ADK context](https://adk.dev/sessions/)、[ADK State](https://adk.dev/sessions/state/)、[LlamaIndex Memory](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/)

**对 TactiScout 的推断。** 当前案件状态（俱乐部、替代对象、位置职责、预算/年龄约束、已排除人员、证据和搜索游标）只能属于该案件/对话，不应被抽取成用户长期偏好。长期记忆只适合记录跨案件稳定的用户默认偏好，且要区分“用户明确要求保存”与“模型从一次任务猜测出来”；召回时可作默认值，但当前案件中的新指令必须覆盖它。初版没有显式偏好保存需求时，不必为了“有记忆”增加 Store、向量库或自动抽取流程。

### 事实来源

- **LangGraph 官方事实：**Checkpointer 为 thread-scoped graph state，Store 面向跨 thread 的应用数据；官方对比表将前者用于短期会话连续性/中断/容错，后者用于用户偏好、事实和共享知识。`model.invoke(state.messages)` 与按需拼接 Store 检索结果的官方示例证明，模型输入由节点显式组装。[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[Add memory](https://docs.langchain.com/oss/javascript/langgraph/add-memory)
- **LangGraph 官方事实：**State 应保存需要跨步骤的数据，能推导的值不应冗余保存；建议保存原始数据，并在节点内按需格式化 prompt。[Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)
- **Deep Agents 官方事实：**它是在 LangGraph 运行能力之上的独立 harness，提供文件系统外置、旧消息自动总结、子 Agent 上下文隔离、可插拔 backend 和跨 thread Memory Store。其 subagents 指南也提醒：子 Agent 若回传大量原始结果，父上下文仍会变胖。[Overview](https://docs.langchain.com/oss/javascript/deepagents/overview)、[Subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents)
- **OpenAI Agents SDK 官方事实：**Session 在 run 前读取历史、run 后持久化本轮内容；Responses 专用 compaction session 在回合持久化后可按阈值/hook 压缩并替换历史。SDK 等待 compaction 完成后才结束 streaming run，因此最后一个输出 token 与流关闭之间可能有数秒间隔；官方建议低延迟场景在流结束后/轮间手动压缩。[Agents SDK Sessions](https://openai.github.io/openai-agents-js/guides/sessions/)、[Streaming](https://openai.github.io/openai-agents-js/guides/streaming/)
- **OpenAI API 官方事实：**服务端和 standalone compaction 的触发方式、canonical 输出、opaque compaction item 与 `previous_response_id` 行为见 [Compaction](https://developers.openai.com/api/docs/guides/compaction)；Responses 会话延续及对象保留边界见 [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)。
- **Google 官方事实：**ADK 将单个对话的 Session/State 与可跨 session 检索的 Memory 分开；`SessionService` 管理前者，`MemoryService` 管理后者。State 的 key 前缀还分别定义 session/user/app/invocation 生命周期。[Conversational context](https://adk.dev/sessions/)、[State](https://adk.dev/sessions/state/)、[Memory](https://adk.dev/sessions/memory/)
- **LlamaIndex 官方事实：**Memory 提供 token 限额、旧消息 flush、Memory Blocks（静态、事实抽取、向量记忆）以及短期/长期内容合并读取。[Memory](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/)

## 可迁移的设计原则（对 TactiScout 的推断）

1. **存档与工作上下文分离。** 原始用户回合、工具结果和 checkpoint 留作恢复/审计；每个模型节点拿到一份按职责组装的视图。不要通过删 checkpoint 来缩短 prompt。
2. **事实与记忆分层。** 当前案件硬条件、球员身份、资格判断、指标样本、报告引用由结构化案件状态和证据记录管理；自然语言摘要只能辅助找回“案件如何演变”，不能更改这些事实。
3. **先裁剪，后摘要。** 先删除重复字段、只注入节点所需的状态、把大证据变成受限引用并按需读取。只有老对话仍然超预算时才摘要，摘要应版本化且可追溯来源事件。
4. **跨案件记忆先做用户显式偏好。** “今后默认优先看德国球员”可以让用户确认后保存；“这次给巴萨找 23 岁以下中卫”必须留在本案件，不应自动变成个人记忆。若未来加记忆，提供查看、编辑、删除及当前请求覆盖默认值的路径。
5. **不把框架的默认阈值当产品策略。** token 水位、保留轮数、flush 大小、摘要长度取决于本机 Qwen、阶段 schema、中文长度和证据目录。用本机真实请求用量和整图任务表现校准。

## 建议的分阶段落地

### 阶段 0：定义四种“记忆”边界

明确并在数据模型/文档中命名：

- **案件档案**：原话、Assistant/Tool 事件、checkpoint、历史证据的不可变或可追溯记录。
- **案件权威状态**：当前有效 brief、身份核验、排除对象、搜索范围/游标、已评估候选、证据 ref、缺失/冲突。
- **模型工作视图**：本次节点 prompt 实际拿到的最小必要信息和预算清单。
- **用户长期偏好**：显式同意、跨案件稳定、可撤回的默认项。

这是领域边界建议，不是引入四套数据库；单机阶段可继续用 SQLite checkpoint + 现有 state，也可用浏览器偏好存储承载已同意的轻量偏好。

### 阶段 1：按节点投影 + 请求预算观测

让理解、调查、扩围、重新定向、结论各自通过统一 context builder 生成 prompt。区分结构化状态与事件历史，记录每次请求各组成部分的字节数、token 估算/实测/未知、输出预留、窗口、裁剪项目和模型阶段。先跑基线；不因为用了 LangGraph 就默认它替你控制上下文。

### 阶段 2：工具证据外置 + 按需读取

目录提供完整精简候选覆盖，详细证据则以 case/ref/content-version 标识；模型用受限读取接口取得具体字段或完整引用片段。读取必须检查案件归属、需求版本和内容版本；失败要显式返回 stale/missing，不能静默拿最新版替代。此机制应减少重复上下文而不丢比较覆盖。

### 阶段 3：预算触发的案件导航摘要

当旧事件对特定节点上下文造成实际压力时，把早期问答压成短的“用户目标如何变化”导航记录；保留最近完整交互和来源事件 ID。摘要写入 checkpoint 作为有版本、可重建的衍生材料；决策仍直接读取 brief、身份、候选/证据 State。摘要模型失败时退回投影或安全分批，不得丢硬条件。

### 阶段 4：先不做隐式自动学习；之后评测显式偏好

等案件内上下文稳定后，再增加偏好 UI/存储。跨 session 搜索不应把旧案件细节混入新案件；若偏好要保存，记录用户确认、修改时间、来源和生效范围。当前自然语言输入始终覆盖默认偏好。

## 评测与采用标准

框架案例提供的是候选架构，不是 TactiScout 的实验结果。建议固定同一模型、Ollama 实际 context、数据快照、场景、压力轮次和工具预算，并串行轮换以下消融：

1. 现有历史策略；
2. 仅按节点投影；
3. 仅证据 ref 与按需读取；
4. 投影 + 证据读取；
5. 在 4 的基础上加入案件导航摘要。

主要指标除输入 token/请求大小外，还应包括：最新限制是否保留、被撤销条件是否错误复活、身份与本人排除是否正确、候选覆盖范围、分页连续性、证据引用/单位/样本保真、失败与恢复次数、首个进度及端到端延迟。摘要开销计入总量。至少多轮配对，报告中位数、范围和失败样本；只在正确性不退化并达到预先登记的净延迟/token收益后，才考虑改变默认策略。一次长对话实验不能代表日常使用。

**对当前实现的直接建议：**继续以 LangGraph StateGraph + SQLite checkpointer 为骨架；把 checkpoint 看作可恢复案件档案，而非让模型每次完整重读的提示词；逐步启用已实现的 `projection`、`evidence`、`unified`、`summarized` 实验臂，当前维持 `legacy` 默认直到五臂本机实验达到 spec 门槛。暂不迁移 OpenAI Responses 服务器压缩、ADK MemoryService、LlamaIndex Memory，避免为通用机制增加框架耦合。当前方案的具体接口和验收标准见[上下文管理规格](../../context-management/spec.md)。

## 当前本机五臂实验诊断

2026-10-19 的真实 Ollama 运行使用 `tactiscout-qwen3.5:9b`、固定 Barcelona U23 场景、每臂 5 次。五臂全部为 0/5 完成；每次运行都在进入 20 轮压力对话前结束，因此没有任何策略真正接受到长对话压力。所有臂的扩页 Planner 操作 p50 都约 60 秒，恰好触及配置超时；失败请求没有完整的 Provider token usage。故这些数据是 Harness 运行失败的诊断，不是五臂效果结论。

同一未完成运行里的上下文清单还给出两个排查方向，但只能当作请求体诊断：基线每次结论阶段估算约 20.6K 输入 token，高于 8K 软目标；加入 evidence 目录后该阶段约 25.2K，且总估算请求 token 高于基线。由于场景未完成、估算器并非 Qwen 精确 tokenizer、失败调用 usage 不完整，不能据此声称 evidence 策略一定变慢或模型质量降低；但它足以要求先检查结论阶段的证据目录是否把太多引用和候选详情塞进 prompt。

下一轮比较应先用完成案件的 checkpoint 做无模型调用的五臂上下文重放，验证保留事实、遗漏项、准确请求体大小和 ref 体量；再用从固定 checkpoint 产生的 Planner 请求比较模型行为；最后才跑小批真实整图对照。真实模型回归必须先证明每臂能完成相同的最小用例，随后才扩到 20 轮压力输入。若模型自身在所有臂的同一个首轮决策点都超时，应先把它作为模型/服务吞吐问题单独报告，不把该失败归因于上下文策略。

## 本轮补充：上下文管理不是单一“压缩”操作

### LangGraph core：裁剪、删除、摘要由应用决定

LangGraph JS 的短期记忆指南把长对话处理分成几类明确动作：调用前裁剪、永久删除 State 消息、旧消息摘要、checkpoint 的保留/读取，以及自定义过滤。它示例的 `trimMessages` 是调用模型前的临时投影；摘要示例则另设 `summary` State 字段并删除旧消息。两者都不等同于 checkpointer 自动执行的功能。[LangGraph Add memory](https://docs.langchain.com/oss/javascript/langgraph/add-memory)

### Deep Agents：先外置大结果，再摘要，再隔离重任务

Deep Agents 官方 context-engineering 文档补充了比“摘要对话”更具体的分层：大工具结果先写入虚拟文件系统并用引用替换；当上下文仍接近窗口且无可外置内容时才摘要旧消息；摘要保留一小段近期上下文，并把原始对话文本归档供检索。文档当前说明默认大结果阈值 20K tokens、上下文约 85% 时开始处理、约 10% 保留近期上下文。这些是 Deep Agents 1.6+ 的当前机制参数，不是 LangGraph 默认值，也不适合直接套给本地 Qwen。[Deep Agents context engineering](https://docs.langchain.com/oss/javascript/deepagents/context-engineering)

这对本项目最重要的启发是：**外置的资料必须能通过受限接口读回来**。仅把工具长文本删掉并留下一个无法解析的 ref，只减少 prompt，却损失了 Agent 的可恢复调查能力。TactiScout 的 `read_case_evidence` 走的是同一方向，但应以案件 scope、ref 版本、候选/指标字段和分页限额来保障引用确实可读取。

### 多次请求间的压缩可能影响用户感知完成时间

OpenAI Agents SDK 的 TypeScript Sessions 支持在回合保存后运行 Responses compaction；其官方文档说明自动压缩会重写 Session，并且 streaming run 需要等 compaction 才算完成。因此“最后一个答案 token 已显示”和“本轮已完成”可能相差数秒。它建议低延迟流程把维护性 compaction 放在轮间/空闲时间。这个 SDK 机制绑定 OpenAI Responses，不适用于 Ollama 的 OpenAI-compatible Chat Completions；可迁移的是把压缩耗时单独测量、避免掩盖在主回答延迟里。[OpenAI Agents JS Sessions](https://openai.github.io/openai-agents-js/guides/sessions/)

Anthropic 当前的 compaction 文档进一步区分了 on-demand、token-threshold 与客户端摘要：on-demand 可后台执行、最近轮次可以原文保留；阈值压缩发生在达到水位的普通请求内；context editing 则可以按规则清除旧工具结果而不做自然语言摘要。这再次说明压缩、工具结果清理和后台归档是不同运算，不能用一个“compact”开关概括。[Claude compaction overview](https://platform.claude.com/docs/en/build-with-claude/compaction)、[Claude context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)

### 修正一个容易误读的 prompt-cache 说法

静态 system/tool 前缀尽量稳定，有助于在支持 prompt caching 的提供方复用相同前缀；但这不是“静态前缀永远不可压缩”的通用硬规则。OpenAI 文档指出缓存命中依赖完整渲染前缀和对应缓存边界，compaction 更改前缀可能降低缓存复用；是否使用、如何收费、缓存多久由具体模型/API 决定。Ollama 当前请求没有证据显示命中供应商计费缓存，因此 TactiScout 应将缓存优化当作后续实测项，而非为保缓存锁死摘要或损害上下文相关性。[OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

### 方案取舍：按“档案、事实、视图、记忆”区分所有权

1. **案件档案**保留原话、历史事件、工具输出和 SQLite checkpoints，服务于恢复与审计；默认不整份重放给模型。
2. **案件事实**由结构化 brief、身份确认、位置/筛选、候选评估、证据/引用、游标与用户更正组成，是策略和报告的权威来源。
3. **模型视图**由每个图阶段从以上数据即时构造：去重复、只带相关字段、预算完整记录；证据正文超长时给受限 ref，按需读取；旧对话仍超限时才摘要。
4. **用户长期偏好**只保存用户明确要求跨案件沿用的默认偏好；当前案件硬条件优先覆盖它。它不参与当前阶段主链路，也不需要为了“记忆”而引入 Store 或向量库。

这个方案吸收 LangGraph 的 State/checkpoint/Store 职责边界、Deep Agents 的外置与恢复、OpenAI/Anthropic 的延迟与缓存注意事项；它没有复制任何供应商专属 compact API，也没有把摘要当成真值。
