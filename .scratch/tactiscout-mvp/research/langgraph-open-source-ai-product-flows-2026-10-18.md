# LangGraph 开源 AI 产品的真实链路调查

调查日期：2026-10-18
范围：公开开源仓库中有代表性的 LangGraph 应用与 Agent harness。优先看图定义、节点实现和项目维护者文档，不把架构宣传图当成代码事实。

## 结论先行

优秀项目并没有统一采用“多 Agent”。从代码里看到的主要是四种控制流：

1. **有界工具循环**：模型判断要不要调用工具，工具结果回到模型，直到完成或达到上限。
2. **检索—反思循环**：搜索、汇总、检查知识缺口，再决定是否继续搜索。
3. **主管—并行工作者**：主管把独立问题拆成子任务，子图并行研究，最后汇总。
4. **耐久任务运行时**：外部事件启动长任务，任务状态跨请求保存，在隔离环境中执行工具，支持暂停、恢复、审批和交付。

它们的共同点不是节点多，而是**把 LLM 的判断放进明确的状态边界和转移条件里**。必经步骤用代码保证；模型只处理需要语义判断的部分；循环、并发、失败、等待用户都有明确出口。

## 调查样本与可信度边界

样本主要来自 LangChain 官方组织的实际代码仓库。它们适合研究 LangGraph 的实现方式，但不等同于独立产品质量排名。星数、项目自述的 benchmark 成绩、LangGraph 本身的采用情况，都不能单独证明端到端产品优秀。

状态也有差异：`open_deep_research` 和 `opengpts` 已归档；`open-swe` 自述仍在积极开发，直接部署依赖 Managed Deep Agents 私测能力；`local-deep-researcher` 是研究应用模板；Deep Agents 是 harness/SDK，不是终端产品。下文会把这些差异标出来。

本次通过仓库源码和项目文档静态核对链路，没有逐个部署并运行这些项目。因此报告描述的是公开实现的设计与控制流，不代表每个项目在当前环境中都能开箱运行。

## 1. Local Deep Researcher：最清楚的自适应检索循环

项目：[langchain-ai/local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher)

实际图：

```text
START
  → generate_query
  → web_research
  → summarize_sources
  → reflect_on_summary
       ├─ 还有检索轮数 → web_research
       └─ 达到上限     → finalize_summary → END
```

图的节点和边直接在 [`graph.py`](https://github.com/langchain-ai/local-deep-researcher/blob/main/src/ollama_deep_researcher/graph.py#L1821-L1858) 中定义。`reflect_on_summary` 会从当前总结中找知识缺口并产生跟进查询，`route_research` 按配置的最大轮数在继续检索和收束之间做路由；README 说明可配置轮数，最终保存总结及来源。

**值得学的地方**：它不是让模型“想查多久就查多久”。模型负责提出下一条查询，代码负责限定次数、保留累计总结和来源、统一收尾。它用单个 Agent 循环解决了“搜索结果还不够，需要继续查”的需求，不需要再引入一个主管 Agent。

**边界**：这个循环主要补充信息，不负责高风险动作；它的最终质量仍取决于搜索结果、摘要和模型。循环上限是可靠性机制，不是质量保证。

## 2. Open Deep Research：有清晰边界的主管与并行子图

项目：[langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research)，**2026-08-21 起已归档，只读**。

顶层图：

```text
START → clarify_with_user
          ├─ 需要补充信息 → 提问后 END
          └─ 可以开始 → write_research_brief
                         → research_supervisor 子图
                         → final_report_generation
                         → END
```

顶层节点和连线可在 [`deep_researcher.py`](https://github.com/langchain-ai/open_deep_research/blob/main/src/open_deep_research/deep_researcher.py#L2734-L2765) 查看。这里有个容易被架构图掩盖的细节：当前实现的澄清节点会把问题写进消息并结束本次图；它不是在同一次运行中等待用户恢复的 `interrupt`。之后由应用以新的输入继续对话。

研究主管是一个短循环：主管模型可以调用 `ConductResearch`、`think_tool` 或 `ResearchComplete`；执行节点将多个独立 `ConductResearch` 调用交给同一个 researcher 子图并行运行，结果再汇总回主管。并发数有配置上限。研究员子图自身则是“模型选择搜索/工具 → 执行工具 → 回到模型”，达到循环上限或任务完成后压缩原始研究笔记；顶层最后再生成报告。对应实现见[主管和子图构造](https://github.com/langchain-ai/open_deep_research/blob/main/src/open_deep_research/deep_researcher.py#L1917-L2210)、[并行调用与聚合](https://github.com/langchain-ai/open_deep_research/blob/main/src/open_deep_research/deep_researcher.py#L2081-L2190)、[研究员子图及压缩](https://github.com/langchain-ai/open_deep_research/blob/main/src/open_deep_research/deep_researcher.py#L2212-L2582)。

**值得学的地方**：只有相互独立的主题才并行；研究执行被包在子图里，主管不必了解每次搜索的细节；原始研究笔记先压缩，再交给最终写作阶段，降低长上下文压力。

**风险与反例**：仓库的[未解决问题 #283](https://github.com/langchain-ai/open_deep_research/issues/283) 指出研究子任务异常处理分支包含 `or True`，会把普通异常当成正常结束，让外层继续生成基于部分结果的报告。这提醒我们：有子图、重试和汇总，不代表故障语义就可靠；必须区分“研究完成”“部分失败”“没有结果”，不能让一份像样的最终报告掩盖失败。

**状态边界**：这个项目 12k+ 星、README 自报参加 Deep Research Bench，但这些只能说明关注度和项目方报告的评测结果；仓库已归档，因此更适合作为架构样本，不能直接视作仍在持续维护的产品模板。

## 3. DeerFlow 2.0：一个主 Agent 加 harness，而不是手写大流程图

项目：[bytedance/deer-flow](https://github.com/bytedance/deer-flow)，当前活跃开发的开源长任务 Agent harness。

DeerFlow 的后端文档把实际入口描述为一个 Lead Agent：通过 LangGraph graph factory 创建，装配模型、工具、按 thread 隔离的 sandbox、subagent 委派和有序 middleware。公开实现导入并使用 LangChain `create_agent`，middleware 包含线程数据、上传文件、sandbox、上下文压缩、可选任务清单、记忆、工具循环检测与澄清中断等职责。[后端结构说明](https://github.com/bytedance/deer-flow/blob/main/backend/README.md#core-components)和[Agent 组装代码](https://github.com/bytedance/deer-flow/blob/main/backend/packages/harness/deerflow/agents/lead_agent/agent.py)都显示：它的核心不是一个固定的 `planner → executor → reviewer` 业务图，而是一个可委派、长时间运行的通用主 Agent。

```text
用户消息 / 外部渠道
  → thread 与身份上下文
  → Lead Agent 的模型—工具循环
       ├─ 直接调用工具、技能或 sandbox
       ├─ 按需派发受限子任务，可并行
       ├─ 执行中间件：限额、上下文、记忆、澄清/中断
       └─ 汇总并流式返回结果/产物
```

**值得学的地方**：它将跨业务的 harness 关注点（隔离、工具策略、限额、可见进度和恢复）放到统一运行时；长任务中的子 Agent 是按需的能力，而不是静态存在于每次请求中的一组角色。

**不宜照搬**：这是一个能运行代码、浏览网页和写文件的通用 harness，仓库结构和 middleware 体量都很大。TactiScout 的核心是只读调研、数据口径约束和推荐证据，采用这种规模会制造大量与产品目标无关的复杂度。

## 4. SurfSense：主 Agent 做路由，专职子 Agent 负责能力域

项目：[MODSetter/SurfSense](https://github.com/MODSetter/SurfSense)，开源知识库与研究产品，覆盖本地文档问答、搜索和内容处理。仓库近期转向桌面/本地使用形态，其 README 提醒曾使用托管版的用户在 2026-10-18 前导出工作区；所以这里主要分析代码中的 agent 结构，不把托管版现状当作其长期产品承诺。[README](https://github.com/MODSetter/SurfSense)

实现上，主 Agent 只构建一小组路由工具；连接器、知识库、网页搜索/爬取和交付物能力被注册为专职子 Agent。主图由 `create_agent(model, tools, middleware, context_schema, checkpointer)` 创建，subagent registry 按能力名装配各子 Agent。[主图编译](https://github.com/MODSetter/SurfSense/blob/main/surfsense_backend/app/agents/chat/multi_agent_chat/main_agent/graph/compile_graph_sync.py#L444-L585)、[子 Agent 注册表](https://github.com/MODSetter/SurfSense/blob/main/surfsense_backend/app/agents/chat/multi_agent_chat/subagents/registry.py#L635-L822)、[主 Agent 与子 Agent 的职责边界](https://github.com/MODSetter/SurfSense/blob/main/surfsense_backend/app/agents/chat/multi_agent_chat/main_agent/runtime/factory.py#L1242-L1271)。

```text
用户问题
  → 主 Agent 判断走哪个能力
  → 知识库 / 搜索 / 网页抓取 / 文件连接器等专职子 Agent
  → 子 Agent 返回结构化或带来源的结果
  → 主 Agent 综合成回答或产物
```

**值得学的地方**：主 Agent 的工具面被刻意做小，连接器构造和权限通过上下文装配；子 Agent 不是“角色名字不同”，而是有独立可调用工具和清楚的能力边界。这有助于降低主 Agent 工具面噪声。

**风险**：如果每种数据源都再包一层 Agent，用户请求将经历多次模型调用和状态边界；SurfSense 的大量连接器值得它这样分工，但球探项目不能因此把一个简单的球员统计查询拆成多个子 Agent。

## 5. Open SWE：图只是 Agent 产品运行时的一层

项目：[langchain-ai/open-swe](https://github.com/langchain-ai/open-swe)，LangChain 的异步编程 Agent 项目。

它不是一个 `START → planner → tools → answer` 的单图。仓库注册多个图入口，分别负责主编程 Agent、Reviewer、代码库风格分析、PR 对话和调度器。外部请求从 Dashboard、GitHub、Slack、Linear 或计划任务进入服务层，按身份、工作区和仓库权限路由到 thread，再派发耐久运行。主 Agent 在 thread 绑定的隔离 sandbox 中读代码、搜索、编辑、运行命令并使用集成工具；结束后可交付 PR。图入口和服务边界见项目的[代码库指南](https://github.com/langchain-ai/open-swe/blob/main/openwiki/quickstart.md#entrypoints-and-execution-boundaries)，Agent 组装点及 sandbox/tool/middleware 边界见[定制指南](https://github.com/langchain-ai/open-swe/blob/main/docs/CUSTOMIZATION.md#customization-guide)。

从 `get_agent()` 的组装看，它复用 Deep Agents 的通用 Agent loop，再接入本产品的工具、沙箱后端和中间件；这说明 LangGraph 的作用是运行可持续的图状态和多种任务入口，而模型—工具循环由上层 agent/harness 复用。仓库还明确说明直接部署依赖私测中的 Managed Deep Agents，且当前处于活跃开发、可能有不稳定边界，参见[README](https://github.com/langchain-ai/open-swe)。

**值得学的地方**：产品级 Agent 的“链路”还包括入口、权限、线程隔离、队列、沙箱、持久化、状态通知和结果交付；这些往往比多一个 LLM 节点更重要。不同用户目标也可以是不同图入口，而非让一个超级图承担所有事情。

**不宜照搬**：编程 Agent 可以在沙箱里运行 Shell 并修改仓库；球探 Agent 的核心是只读证据调查和候选评估，权限、执行工具和失败代价不同。Open SWE 的运行时复杂度不等于其他产品都该有同样复杂的基础设施。

## 6. OpenGPTs：三种认知架构各有取舍

项目：[langchain-ai/opengpts](https://github.com/langchain-ai/opengpts)，**2026-02-24 已归档**。

这个项目将三种体验分成三套图，而不是强迫一个 Agent 处理所有对话：

```text
Chatbot:  LLM → 回复
RAGBot:   检索一次 → LLM 基于结果回复
Assistant: LLM → 工具调用？ → 工具结果 → LLM 循环 → 最终回复
```

README 明确写了 Assistant 的工具循环，以及 RAGBot 的“一次检索后生成”；也指出 RAGBot 更简单、对更广泛的模型更稳，但无法在第一次检索不准时自行再查；工具 Agent 灵活，但更依赖模型的工具调用能力。[项目架构说明](https://github.com/langchain-ai/opengpts/blob/main/README.md#cognitive-architecture)

**值得学的地方**：先判断产品需求需要哪一种控制权。如果每次用户请求都必须搜数据，固定检索流程能少走弯路；如果要根据上下文选择不同工具并补查，才需要有界工具循环。不要为了“Agent 感”把简单对话也送进复杂规划器。

## 7. Chat LangChain：文档助手把安全与稳态行为放在 middleware

项目：[langchain-ai/chat-langchain](https://github.com/langchain-ai/chat-langchain)，官方文档助手。它的产品入口用 `define_deep_agent()` 组装文档搜索、支持知识库和链接校验工具，并挂上输入 guardrail、法律问题转人工、上下文摘要、工具重试、模型重试和 fallback middleware。README 说明它依赖 Managed Deep Agents 做托管部署、身份和连接器；因此它适合看“上层产品如何装配 agent 与守卫”，而不是一个可单独检查每条 LangGraph 边的独立图。[Agent 定义](https://github.com/langchain-ai/chat-langchain/blob/master/agent.py#L319-L429)、[产品能力和托管边界](https://github.com/langchain-ai/chat-langchain/blob/master/README.md#overview)。

**值得学的地方**：边界输入拦截、人工转接、上下文压缩、重试和模型回退都是 Agent 产品链路的一部分；它们不一定要变成业务图中的许多节点，可以由顺序明确、可观测的 middleware 承担。

## 8. Deep Agents：解释 Open SWE 等项目怎样复用通用图

项目：[langchain-ai/deepagents](https://github.com/langchain-ai/deepagents)，这是 harness/SDK，不是最终用户产品。

它把栈分成三层：**LangGraph** 负责运行时状态、checkpoint、streaming、interrupt；**LangChain `create_agent()`** 提供模型—工具—中间件循环；**Deep Agents** 在上层装配规划、文件系统、上下文管理、委派子 Agent、技能、记忆和后端等惯用能力。`create_deep_agent()` 最终调用 `create_agent()` 构造可运行图。维护者在[架构说明](https://github.com/langchain-ai/deepagents/blob/main/libs/ARCHITECTURE.md)明确了这三层。

**关键理解**：采用 LangGraph 不意味着每个项目都要亲手把 `model` 和 `tools` 节点写一遍。LangGraph 可以承载手写业务图，也可以作为通用 Agent loop 的 runtime；当产品需要明确分支、人工中断、状态恢复或子图时，再在业务层使用更低层的图控制。

## 跨项目对照

| 项目 | 主要图形态 | LLM 决定什么 | 代码固定什么 | 最适用的任务 |
|---|---|---|---|---|
| Local Deep Researcher | 单图、有限反思循环 | 跟进搜索词、知识缺口 | 轮数、状态累积、最终收束 | 有限轮次的信息补查 |
| Open Deep Research | 主管子图 + 并行研究员子图 | 拆分主题、分派研究、何时完成 | 并发上限、工具执行、压缩和报告阶段 | 多个相互独立主题的深度研究 |
| DeerFlow | 通用 Lead Agent + harness middleware + 按需子任务 | 工具与技能选择、是否委派 | 权限、sandbox、循环/任务上限、上下文与运行时 | 长时间、开放任务、执行和产物生成 |
| SurfSense | 小工具面主 Agent + 专职子 Agent | 将问题路由到能力域 | 子 Agent 注册、上下文、checkpointer | 多连接器知识库和研究产品 |
| Open SWE | 多个耐久图入口 +通用 Agent loop | 具体实现步骤、工具选择 | 线程、权限、沙箱、调度和交付边界 | 长时间、异步、有副作用的编程工作 |
| Chat LangChain | 通用 Agent loop + guardrail middleware | 何时检索/调用链接校验工具 | 越界拦截、法律转人工、摘要、重试/模型回退 | 有明确范围和安全边界的文档助手 |
| OpenGPTs Assistant | 模型—工具循环 | 要不要用哪个工具 | 工具调用/结束协议 | 多工具、短程对话 |
| OpenGPTs RAGBot | 固定检索后回答 | 如何综合检索结果 | 每轮都先检索一次 | 请求总是知识查找的问答 |
| Deep Agents | 通用 loop + middleware/harness | 每轮下一步和工具选择 | 中间件能力、状态和后端边界 | 需要文件、计划、委派等通用 Agent 能力 |

## 对 TactiScout 的映射

当前项目的主图已经是一个有状态、有限回环的专用工作流，位置见 [`src/recruitment/conversation.ts`](../../../src/recruitment/conversation.ts)：

```text
record_user_turn
  → understand_request
  → choose_next_action
       ├─ ask_user → wait_for_user (LangGraph interrupt，收到回答后回到理解节点)
       ├─ search/tool → execute_tool → choose_next_action
       ├─ 尚不能结束 → 重新规划
       └─ finish → review_recommendation
                      ├─ retry → choose_next_action
                      ├─ 通过 → 外部/历史信号补充 → deliver_recommendation
                      └─ 其他 → deliver_recommendation
```

所以它更接近“OpenGPTs 的有界工具 loop + Local Deep Researcher 的证据补查”，并且加了显式追问、球员身份/位置上下文和候选报告校验。当前阶段**没有证据表明应该加入通用 supervisor 或堆叠多个角色 Agent**。如果未来发现检索任务确实可拆成彼此独立的维度（例如候选数据、球队阵容缺口、球员职责/角色画像），再做配对消融：比较并行子图是否提高有效证据覆盖和 shortlist 质量，及其额外延迟、工具调用和失败复杂度。

最值得从这些项目借鉴的，是下列产品机制：

1. **让调用工具的循环有限且可见**：每轮决策、工具、结果、停止原因写入状态；设置每轮决策、分页和总耗时上限。
2. **区分“没找到”“数据源失败”“还缺证据”**：这三种状态决定下一条边完全不同，不能压成空候选或一份正常报告。
3. **把不可协商的足球逻辑交给代码**：替代者排除参考球员、身份确认、位置族召回、样本门槛、证据来源和报告字段应由可验证逻辑兜底；LLM 负责解释需求、挑下一项调查并综合证据。
4. **只并行独立工作**：依赖前一工具结果的检索应串行；不同维度能独立查、也能独立失败的任务才值得并行。
5. **将“追问”视为图状态转换**：只有缺少会改变候选范围的必要信息才中断；答案由结构化 UI 提交并恢复对应 thread，而不是生成反复出现的泛化问题。
6. **将评测接到真正的整图链路**：测身份是否找对、替代者本人是否被错误纳入、空名单是否合理、证据覆盖、用户追问次数、耗时和失败恢复。仅测试单个 prompt 或单个节点，不能证明 Agent 的编排有价值。

当前图的主要优化判断因此不是“加更多 Agent”，而是让每个边的进入条件和结果语义更清楚、错误能显式收束、运行状态可以被用户理解，并通过整图消融证明每个动态循环或审查环节实际带来收益。

## 一手来源

- [Local Deep Researcher README：迭代流程、可配轮数和输出](https://github.com/langchain-ai/local-deep-researcher#how-it-works)
- [Local Deep Researcher graph.py：节点与路由](https://github.com/langchain-ai/local-deep-researcher/blob/main/src/ollama_deep_researcher/graph.py#L1790-L1858)
- [Open Deep Research README：评测配置、结果与归档状态](https://github.com/langchain-ai/open_deep_research)
- [Open Deep Research：主图、主管、研究员子图](https://github.com/langchain-ai/open_deep_research/blob/main/src/open_deep_research/deep_researcher.py)
- [Open Deep Research issue #283：子图异常可能被当作正常结束](https://github.com/langchain-ai/open_deep_research/issues/283)
- [Open SWE README：项目状态与自部署限制](https://github.com/langchain-ai/open-swe)
- [Open SWE：图入口与线程运行方式](https://github.com/langchain-ai/open-swe/blob/main/openwiki/quickstart.md#entrypoints-and-execution-boundaries)
- [Open SWE：Agent 组装、sandbox、tools 和 middleware](https://github.com/langchain-ai/open-swe/blob/main/docs/CUSTOMIZATION.md#customization-guide)
- [DeerFlow：Lead Agent、middleware 和子 Agent 结构](https://github.com/bytedance/deer-flow/blob/main/backend/README.md#core-components)
- [DeerFlow：Lead Agent graph factory](https://github.com/bytedance/deer-flow/blob/main/backend/packages/harness/deerflow/agents/lead_agent/agent.py)
- [SurfSense：主 Agent 编译、上下文和 checkpointer](https://github.com/MODSetter/SurfSense/blob/main/surfsense_backend/app/agents/chat/multi_agent_chat/main_agent/graph/compile_graph_sync.py)
- [SurfSense：专职子 Agent registry](https://github.com/MODSetter/SurfSense/blob/main/surfsense_backend/app/agents/chat/multi_agent_chat/subagents/registry.py)
- [SurfSense：主 Agent 小工具集与委派边界](https://github.com/MODSetter/SurfSense/blob/main/surfsense_backend/app/agents/chat/multi_agent_chat/main_agent/runtime/factory.py)
- [Chat LangChain：Agent 配置和 guardrail middleware](https://github.com/langchain-ai/chat-langchain/blob/master/agent.py)
- [OpenGPTs README：三种认知架构](https://github.com/langchain-ai/opengpts/blob/main/README.md#cognitive-architecture)
- [Deep Agents 架构：LangGraph、LangChain 和 harness 的分层](https://github.com/langchain-ai/deepagents/blob/main/libs/ARCHITECTURE.md)
- [TactiScout 主 LangGraph](../../../src/recruitment/conversation.ts)
