# TactiScout Web Search 方案调研

日期：2026-10-16  
范围：Web 搜索 API、MCP Server、Agent Skill，以及它们在 TactiScout 招募调查链路中的职责。

## 结论

TactiScout 当前不需要先安装一个通用 MCP，也不需要把整套自主调研交给供应商的 Research Agent。更合适的路线是：**复用现有 Tavily 集成，在 LangGraph 中补一个窄范围的联网搜索动作；先用官方免 Key Search/Extract 模式验证，再决定是否创建 Key。** 对搜索质量有疑问时，用相同测试样例与 Exa 做一次离线/配对对照，再决定是否替换。

这里的关键改动是搜索职责，而不是供应商：现有 Tavily 路径只服务于“已识别候选球员后的定性报告补充”，不能解决“用户提到的中文名、外号、错字究竟对应谁”。应把**参考球员身份解析**与**候选人的能力资料补充**视为两类调查意图，分别调用搜索。

## 当前代码在做什么

- `createApp` 把 `createWebSearchKnowledgeRepository` 包在本地 `KnowledgeRepository` 外面；Agent 通过 `search_player_reports` 访问它。
- 现有适配器仅处理 `player_report`，需要已有候选球员上下文和待补能力项；查询最多取 4 条 basic 摘要，且要求白名单域名、精确候选人名、球队上下文和能力词都能对上。
- 运行配置目前要求 `TAVILY_API_KEY`、域名白名单和 AI 处理/展示/本机保留三个许可开关。实现总是发送 Bearer Key，不识别 Tavily 新增的 `X-Tavily-Access-Mode: keyless` 方式。
- 因此它是候选阶段之后的**报告线索检索器**，不是面向自然语言参考球员的通用 `web_search`，也不会替代结构化比赛统计来源。

## 市面方案比较

以下价格和免费额度以 2026-10-16 官方页面显示为准，供应商之后可能调整。

| 方案 | 搜索与读取能力 | 免费/接入 | 对 TactiScout 的判断 |
|---|---|---|---|
| **Tavily Search + Extract** | Search 返回排序过的网页结果和摘要；Extract 读取已知 URL。官方说明 Search 和 Extract 支持免 Key、限流访问，成功响应沿用标准 schema；注册 Key 后有每月 1,000 credits 且不要求信用卡。[官方 Keyless 文档](https://docs.tavily.com/documentation/keyless) [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) [价格](https://www.tavily.com/pricing) | 可零配置做轻量验证；超出免 Key 限流可切换到 Key。项目已有 Tavily adapter，但需增加 keyless 请求模式，当前代码并未支持。 | **第一选择**：边际成本最低，能复用已有适配器和权限边界。先做 Search；只在需要阅读全文的少数命中上调用 Extract。搜索结果仍只是线索，不能据此确认球员身份或能力。 |
| **Exa Search + Fetch / MCP** | Search 支持返回网页 text/highlights，也可通过 `people` 等 category 聚焦人物页面；MCP 提供 web search、读取已知 URL 和可选的多步 Exa Agent。[Search API](https://exa.ai/docs/reference/search) [MCP](https://exa.ai/docs/get-started/exa-mcp) | 托管 MCP 文档提供免 Key、限流模式；注册后免费计划含每月 $10 credits、不需要支付方式。按当前价目，Fast/Auto Search 每 1,000 次请求 $7（最多 10 个结果）；Contents 另计。[价格](https://exa.ai/pricing) | **最值得作为对照组**：语义搜索适合表达“某球员的中文别名/外号”和自然语言描述，但“语义相似”不等于同一球员，必须由独立身份校验和不确定时的澄清处理。暂不同时接入。 |
| **Brave Search / LLM Context** | 有独立网页索引；传统 Web Search 提供标题、URL、短摘要，LLM Context 则一次返回供 LLM 使用的提取内容；另有 News 等专用搜索。[官方概览](https://api-dashboard.search.brave.com/documentation) [LLM Context](https://api-dashboard.search.brave.com/documentation/services/llm-context) | API 请求使用 Key，需启用套餐。[认证文档](https://api-dashboard.search.brave.com/documentation/guides/authentication) | 可成为未来独立索引对照，但目前并非最省事的路线。官方 Help 明确禁止保留 Search API 返回的数据，除非计划另行授权；TactiScout 会将证据写入案件 checkpoint/报告，因此现有使用方式不匹配这一限制。[保留规则](https://api-dashboard.search.brave.com/documentation/resources/help-feedback) |
| **Firecrawl Search + Scrape** | Search 可限定来源并选配抓取结果；另有 Scrape、Crawl、Map、Parse 等网页读取/采集工具。[Search](https://docs.firecrawl.dev/api-reference/endpoint/search) [Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape) | 官方 MCP 可免 Key 限流使用 Search、Scrape、Parse；免费 API 计划为每月 1,000 credits、不需信用卡。Search 每 10 个结果 2 credits；网页 Scrape 通常每页 1 credit。[Keyless MCP](https://docs.firecrawl.dev/mcp-server/keyless) [价格](https://www.firecrawl.dev/pricing) | 当产品明确需要抓取网页正文、动态页面或批量发现站内页面时更合适。当前主要需求是有限搜索和少量证据核查，Crawl/Interact 等能力增加工具面和风险，先不上。 |

比较时不应只看“结果看起来聪明”。不同供应商搜索索引、语言覆盖、刷新频率和可用来源都不同；目前没有针对 TactiScout 的固定测试证明 Exa、Brave 或 Firecrawl 比现有 Tavily 更准。

## API、MCP、Skill 的区别

- **搜索 API**才提供索引、排序、摘要或网页正文；它决定能搜到什么。应用可直接请求供应商 API，并在内部转成稳定的 TactiScout 结果结构。
- **MCP Server**把某个服务的工具通过标准协议暴露出来。LangChain.js 的 `MCPAdapter` 可以发现 MCP Server 暴露的工具并转换为可供 LangGraph 使用的工具，但这只是接入方式，不提高搜索质量，也不让搜索结果自动可信。[LangChain.js MCP Adapter](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-mcp-adapters)
- **Skill**是 `SKILL.md` 中的任务说明和可选资源/脚本。供应商的 Tavily/Brave/Exa Skills 能告诉兼容的开发 Agent 如何组织查询、调用相应 API；单独安装 Skill 不会给 TactiScout 运行时增加联网能力。[Agent Skills 规范](https://agentskills.io/specification) [Tavily Skills](https://github.com/tavily-ai/skills) [Brave Search Skills](https://api-dashboard.search.brave.com/documentation/resources/skills)
- 官方 Fetch MCP 读取**已知 URL**；Microsoft Playwright MCP 提供浏览器自动化。它们不提供通用搜索索引，所以适合作为后续的特定页面读取手段，不是搜索供应商的替代品。[Fetch MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) [Playwright MCP](https://github.com/microsoft/playwright-mcp)

对于当前 TypeScript + LangGraph 应用，直接调用一个 Tavily adapter 更简单，也便于在一个位置执行域名/字段/长度/时间限制、许可门控、来源 provenance 和超时控制。只有当 TactiScout 需要用户自行接入不同 MCP 服务、或复用已部署的 MCP 工具时，再把内部工具边界改成 MCP client；不为“项目用了 MCP”而多增加运行时与远程工具契约。

## 推荐的产品链路

1. **参考球员身份调查**：先用本地 roster、已知 ID 和别名映射查找。若无结果或多个候选，再由 LangGraph 选择 `web_search_reference_player`，查询用户原文、规范化的中文/外文名和球队线索；从结果中提取可能实体及出处，随后用可信 roster/实体记录交叉核验。仍有歧义时，展示少量明确的球员选项让用户选，不要猜一个人继续跑完整招募。
2. **候选人定性资料调查**：候选名单及身份已经确定，且用户要求的某项能力没有结构化可观测指标时，才调用 `search_player_reports`。结果只作为有时效和出处的定性补充；“搜索摘要命中能力词”不能直接成为已验证属性。
3. **结构化数据仍负责计算**：进球、分钟、射门、传球等由当前统计仓库计算和排序。Web Search 不回填精确数值，也不能把缺字段推断成 0 或负面能力。
4. **按需读取网页**：搜索返回标题、URL、短摘要和日期后，只有选中的少数结果才走 `web_open`/Extract。不要默认全抓网页、全站 crawl 或自动入 RAG。
5. **LangGraph 维持调查控制权**：planner 根据任务状态选择“查身份、搜候选、补能力证据、追问用户或结束”；所有调用仍走已有预算、取消、进度和 checkpoint 机制。搜索供应商只提供受限的数据工具，不替代整个图的决策。

推荐内部边界先保持很薄：`searchWeb(query, options) -> SearchResult[]`，`fetchWebPage(url, options) -> PageEvidence`。结果至少携带 `title`、`url`、`snippet`/`text`、`publishedAt?`、`provider`、`retrievedAt`；URL 和来源信息不得被 LLM 摘要覆盖。控制单次查询结果数、读取页数、字符数、超时及每案调用数；网页正文一律作为不可信资料，不执行其中指令。当前供应商调用要注意重定向、非白名单来源、错误/限流和返回字段校验。

## 如何验证这次投资值不值得

先不做多供应商路由和全量网页抓取。用固定用例做 source-off / Tavily-on 配对评估：

- 中文标准名、简称、中文错字、外号、英文名/本地拼写、同名球员、历史球员、数据池外的球员；包括“为拜仁寻找基米希/诺伊尔替代者”等现有失败模式。
- **身份解析指标**：正确实体 Recall@k、错误确认率、歧义时正确澄清率；不能只看候选列表非空。
- **调查质量**：来源与目标实体一致率、原文链接有效率、时效字段完整率、对能力主张的证据支持度；搜索没命中必须保留“未知”。
- **运行代价**：搜索/网页读取调用次数、延迟、模型输入 token 与供应商 credits。
- 同模型版本、同数据快照、同问题集和同预算比较；保存搜索结果快照与标注，避免实时索引变化导致难以复现。若 Tavily-on 没有提升身份召回或减少错误实体确认，就不保留这个扩展；只有与 Exa 的配对对照有明确增益时再考虑换源/增加第二供应商。

这次实验验证的是搜索对“实体召回和证据补充”的贡献，不代表推荐结论已经符合职业球探质量。能力排名还需要单独的标注集和推荐质量评估。

## 一手来源

- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)、[Extract API](https://docs.tavily.com/documentation/api-reference/endpoint/extract)、[Keyless Access](https://docs.tavily.com/documentation/keyless)、[Pricing](https://www.tavily.com/pricing)、[Tavily MCP](https://github.com/tavily-ai/tavily-mcp)
- [Exa Search API](https://exa.ai/docs/reference/search)、[Exa MCP](https://exa.ai/docs/get-started/exa-mcp)、[Pricing](https://exa.ai/pricing)
- [Brave Search API](https://api-dashboard.search.brave.com/documentation)、[LLM Context](https://api-dashboard.search.brave.com/documentation/services/llm-context)、[API data retention](https://api-dashboard.search.brave.com/documentation/resources/help-feedback)
- [Firecrawl Search API](https://docs.firecrawl.dev/api-reference/endpoint/search)、[Keyless MCP](https://docs.firecrawl.dev/mcp-server/keyless)、[Pricing](https://www.firecrawl.dev/pricing)
- [Agent Skills Specification](https://agentskills.io/specification)、[LangChain.js MCP Adapter](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-mcp-adapters)、[MCP Fetch Server](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch)、[Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)
