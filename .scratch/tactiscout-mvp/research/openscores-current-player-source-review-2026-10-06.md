# OpenScores 作为当前球员候选源的官方资料复核

核查日期：2026-10-06。目的：寻找能供 TactiScout 免费/低成本验证、提供当前球员池并允许 Agent 使用的数据来源。只核查发布方和上游网站的一手页面；未注册账户、未索取密钥、未调用受保护 API、未下载球员数据。本记录中的接口能力是文档证据，不是本机 live API 验收。

## 结论

**OpenScores 是近期发现中最贴合 TactiScout Agent 工作流的技术候选，但目前仍是“有条件研究候选”，不能登记为默认可用的数据源。**它提供 MCP 与 REST API，文档列出球员搜索、球员档案、球队当前赛季 squad、逐场阵容/事件/统计；条款明确允许将响应用于产品、Agent 与研究，允许应用内缓存/转换，并允许向产品用户展示数据，不要求署名；免费 key 的默认限额为 60 次/分钟、2000 次/小时。[OpenScores 文档](https://openscores.ai/docs) · [条款](https://openscores.ai/terms) · [FAQ](https://openscores.ai/faq)

它还没有证明是引援评估所需的完整球员表现源：公开的 MCP 工具只有 9 个，`search_players` 支持姓名/国籍/位置搜索，`get_player` 说明提供职业聚合和近期出场，`get_team` 说明提供当前赛季 squad；文档没有列出年龄、合同或球员表现字段字典。`get_fixture` 有阵容、事件时间线和球队统计，但没有公开承诺球员级 xG、推进传球、压迫、对抗、跑动等逐场指标的返回 schema。首页上的 carries、shot quality、minutes 等球探 prompt 示例不是 API 契约，不能据此在推荐中声称这些指标可查。[OpenScores MCP 文档](https://openscores.ai/docs) · [首页能力介绍](https://openscores.ai/)

**两个准入缺口必须先补：**其一，FAQ/changelog 说明当前公开覆盖为五大联赛和 2026 世界杯、顶级联赛初始 ingest 是每日更新；文档/Changelog 页面最后更新时间为 2026-06-12，没有证明 2026/27 球员名单已进入数据集或任何字段的新鲜度 SLA。首页称“live”，FAQ 则明确是 daily ingest、没有实时逐分钟比赛推送。其二，OpenScores changelog 说明曾使用 Sofascore 与 Flashscore 作为 ingest 源，但其公开条款没有给出上游数据许可链。Sofascore 条款限制未经明确同意的 scraping、aggregation、reproduction 和大规模数据库提取；Flashscore/Livesport 条款限制未书面授权复制、下载、展示、分发或其他使用内容。未找到 OpenScores 声明其持有适用于本项目的上游授权。因此，OpenScores 自己授予的 API 使用许可不足以证明底层数据可公开进入作品集。[OpenScores Changelog](https://openscores.ai/changelog) · [OpenScores FAQ](https://openscores.ai/faq) · [Sofascore 条款 §§2.8–2.9](https://www.sofascore.com/terms-and-conditions) · [Flashscore/Livesport 通用条款 §§2、7](https://docs.livesport.services/terms/terms-of-use/tou_2_web_en_v3.pdf)

**建议：**保留为待核实的候选，不接入现有候选发现链、不把响应交给模型或 RAG，也不以其公开数据生成逐球员作品集页面，直到供应方提供上游权利说明并确认 2026/27 赛季、完整响应字段、年龄字段及本地存储/LLM/RAG 范围。若后续满足准入，先做单一联赛、限定请求量、短期本地 smoke；如只验证 MCP 编排，可用合成 fixture 替代真实球员资料。这个决定符合项目的 `来源许可登记` 与 `受限数据源 smoke` 边界：可访问性或供应方自有条款不自动代表上游数据授权或 Agent 准入。[CONTEXT.md](../../../CONTEXT.md)

## 对 TactiScout 需求的逐项核对

| 需求 | 官方材料能证明什么 | 仍缺什么 | 当前判断 |
|---|---|---|---|
| 当前候选池 | `get_team` 描述含“current-season squad”；2026-06-12 changelog 说其返回“roster ∪ appearances”，包括尚未出场的队内成员；官网与 FAQ 宣称覆盖五大联赛及 2026 世界杯，首页展示约 4.6k player records。 | 没有公开队伍名单 schema、squad 的精确定义、注册资格/一线队与青年队边界，也没有证明 2026/27 名单已更新。数字是供应方首页实时声明，不能证明每队完整。 | 有候选池形状，当前季及完整性未验证。不能称为完整现役转会市场。 |
| 搜索与身份 | `search_players(q, nationality?, position?)`；`get_player(id)` 提供球员档案、效力队伍、职业聚合和近期出场。分页工具返回 `{items, pagination}`。 | 文档没有说明姓名/来源 ID 字段、球队 ID、日期格式、位置枚举、身份跨源规则及结果分页参数；未见 DOB/年龄字段。 | 技术上有搜索/档案接口；年龄硬约束当前无法证明可做。 |
| 球员表现指标 | API 工具描述覆盖比赛阵容、事件时间线、比赛统计和球员 career aggregates/recent appearances。 | 没有球员表现 stats endpoint 的明示名称、完整字段/单位/口径/样本分母。关键的角色指标（渐进传球/带球、抢断压迫、空中对抗、xG/xA、跑动）没有 schema 证据。首页里的能力问句不能替代返回字段契约。 | 不能据公开文档实现职责能力分或百分位比较；至多可在响应字段核实后考虑出场/职业聚合背景。 |
| 覆盖与新鲜度 | 五大联赛与 2026 世界杯；changelog 记载 5 月 14 日 top-5 初始管线为 daily cadence、6 月 11 日导入 World Cup 的 48 队/1,258 名球员；FAQ 称 ingest daily。默认 key 限额为 60 次/分钟、2000 次/小时。 | 当前页面未给出 top-5 各联赛逐项赛季、最近成功 ingest、球队数/球员数、字段级更新频率或 SLA；World Cup roster 是赛事前名单。 | 覆盖面概览看似对路，但不是实时且与 2026-10-06 当前赛季可能错位；真实 freshness 未验。 |
| API / Schema | MCP Streamable HTTP，端点 `https://api.openscores.ai/mcp/`，Bearer key；9 个只读工具。FAQ 另称 REST mirror 在 `/v1`。官方示例展示 JSON-RPC `tools/call`，提供 Python/TypeScript/Claude 客户端示例。 | 公开 docs 只列工具参数和概括性返回内容，没有工具输入 JSON Schema、完整 player/team 返回示例或公开 OpenAPI。网站 GitHub 链接指向 `mobinzk/openscores-api`，研究时返回 404；无法在代码中静态核验 schema/导入逻辑。未拿 key，因此不能做受保护 endpoint live smoke。 | 可按 MCP 集成；开发前需要稳定接口 schema 和 key 下受限 smoke。 |
| 免费访问 | 官方称免费、无需信用卡，注册账户后可自行创建 key；无免费层商业限制，默认 60/min、2000/hour。 | 本次没有创建账户或请求 key；限额可因公平使用和服务负载被更改。 | 可供用户自己的环境申请 key 后评估；不要把 key 放在浏览器端或公开仓库。 |
| 本地存储 | 条款明确允许在应用中 cache 或 transform API response，没有给出缓存期限。 | 没有单列永久保留或账户终止后继续持有的期限规则；“cache”是否覆盖长期完整球员数据库未写明。批量构建替代数据集会碰到条款禁止 resale/raw dataset。 | 普通应用级缓存有文字支持；长期快照、完整名单库和永久保留需确认。 |
| 展示/归因 | Acceptable terms 明确允许向自己产品的用户展示 API 数据；归因不是必需，仅表示欢迎链接回去。禁止把原始数据作为自己的 dataset 或竞争 API 转售。 | 上游供应者是否授权 OpenScores 允许下游公开逐人展示，公开文件未说明；姓名/个人信息和标志图片也需单独确认来源权利。 | OpenScores 层面支持产品内展示且不强制归因；上游授权链未证，故当前不能视作安全公开许可。 |
| LLM / RAG | 条款允许“agents / agent workflows”；官方文档定位为面向 AI agents 的 MCP；官方示例明确展示先让 Claude 调用工具取足球数据，再生成比赛报告。这对受控的推理时上下文是强烈的官方用例证据。 | 条款没有逐字写“LLM inference”“embedding”或“RAG”，也没有明确允许将完整球员资料做持久向量索引。供应方对响应的使用许可也不能证明它有权为 OpenScores 的上游内容开放生成式 AI 使用。 | Agent/LLM 单次推理是其明确产品场景；向量库、持久 RAG 与上游权利仍需答复前不启用。 |
| 可用性与准确度 | 供应方公开承认没有 uptime、准确性、完整性或特定用途保证，服务按 AS-IS 提供。 | 没有 SLA 或覆盖完整性承诺。 | 除非有本地缓存的许可与来源失败策略，不宜作为唯一关键路径。 |

## 许可链与来源事实

- OpenScores 2026-06-12 Changelog 的“Multi-source ingest”记载 Sofascore + Flashscore 两路采集及跨源去重；同页称最初 top-5 pipeline daily 更新，6 月将 World Cup 队伍 roster 导入数据库。[官方 changelog](https://openscores.ai/changelog)
- OpenScores 自己的 [Terms](https://openscores.ai/terms) 许可访问者使用 OpenScores API 结果来支持自己的产品、Agent 和研究，允许缓存/转换，并禁止转售原始数据为竞争 feed；[FAQ](https://openscores.ai/faq) 明确 60 次/分钟、2,000 次/小时以及每日采集频率。
- Sofascore [官方条款](https://www.sofascore.com/terms-and-conditions) §2.8 将其数据库内容定义为受数据库权利保护，并规定未经许可不得提取/公开数据库内容的大部分；§2.9 明确禁止未经同意 scrape/aggregate/reproduce 网站内容及自动请求负载。Sofascore [API 可用性 FAQ](https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability?lng=pt-BR) 说其与数据提供者的协议不允许将该数据以 API endpoint 提供给外部。
- Flashscore 的服务提供方 Livesport [General Terms of Use](https://docs.livesport.services/terms/terms-of-use/tou_2_web_en_v3.pdf) §§2、7 约定：未经 Provider 书面授权，用户无权复制、修改、分发、传输、展示、复制、下载或以其他方式使用 App 内容。是否 OpenScores 与来源方另有许可不在公开材料中。
- 以上只表示“公开文档未证明权利链”，不推定 OpenScores 一定没有私下授权。需要供应方书面说明其每个来源的授权，以及授权是否包含下游本地存储、用户界面展示和生成式模型推理。

## 其他被核查的新候选

| 来源 | 可验证事实 | 对当前球探 MVP 的限制 |
|---|---|---|
| [Football Soccer API](https://footballsoccerapi.com/) | 其条款对自有 API 数据有明确的应用展示、本地存储和模型用途许可；归因可选。其文档列 62 个 endpoint、158 个国家、966 项赛事；OpenAPI 地址公开。 | 免费 key 明确不含统计或历史，18/62 endpoints；有统计的 Archive 计划收费。官方文档没有 player search、current squad 或 player stats endpoint。因此即使使用其免费 API，也不能提供引援候选池和能力评估。[价格](https://footballsoccerapi.com/pricing) · [API 文档](https://footballsoccerapi.com/documentation) · [Acceptable Use](https://footballsoccerapi.com/acceptable-use) |
| [Sports Data Vault](https://sportsdatavault.com/en/data/) | 站点显示 2026/27 season ZIP 于 2026-10-05 构建；包含逐场 xG 球员记录、位置、分钟、xG/xA、射门和传球等球员统计，并按日重建当前季。 | 当前季月费 US$10、单季 US$19；7 天 sample 不是免费全库。数据页许可仅写 single-user research、不允许再分发/转售/公开 re-hosting；站点说明其从公开页面采集且不隶属 Livescore。页面没有明确允许作品集公开展示、云端/本地 LLM、向量入库或再分发派生球员报告；也没有呈现 current roster 或 DOB schema。只能视作付费私有研究数据，不满足可直接集成的公开 portfolio 数据源。[数据与价格](https://sportsdatavault.com/en/data/) |

## 建议的验证顺序

只有在供应方确认上游授权后，再由本机使用者自愿申请 key 做第一轮 schema smoke，至少按下列顺序验证：

1. `list_leagues` / `list_seasons` 是否明确返回 EPL、Bundesliga 等的 2026/27 season id 与日期范围；否则标记为上一季资料。
2. `get_team` 对 2–3 个知名俱乐部返回队伍 ID、squad season、position、nationality、DOB/age（若有）、球员外部 source IDs 和最后更新时间；区分 registered roster 与 appearance-derived member。
3. `search_players` position/nationality 过滤是否稳定分页，校验同名实体与跨队球员的唯一 ID；不能通过姓名做隐式跨源身份合并。
4. `get_player` / `get_fixture` 逐字段记录球员逐场 stats 有无分钟、xG、传球/向前传球、盘带/推进、对抗、防守与位置；每项都要求单位、定义、赛季、比赛样本和源 ID。只展示实际存在的字段，任何缺失能力保持 unknown。
5. 问清 API response 是否可以存入本项目本地 DB/checkpoint、是否可以将挑选出的字段作为 Ollama 推理上下文、是否可创建持续更新的 RAG embedding；问清 AI 输出中公开展示球员姓名/统计的边界，保留 provider attribution 即使其条款称可选。
6. 如获准接入，先用一联赛、少量球队只读导入；生成脱敏的 schema、freshness、完整性和重复 ID 摘要，不能将一次 smoke 描述为可靠全联赛 roster 或推荐质量验证。

## 主要一手来源

- OpenScores：[MCP Docs](https://openscores.ai/docs) · [FAQ](https://openscores.ai/faq) · [Terms](https://openscores.ai/terms) · [Changelog](https://openscores.ai/changelog) · [Examples](https://openscores.ai/examples) · [Home / coverage claims](https://openscores.ai/)
- 上游网站：[Sofascore Terms & Conditions](https://www.sofascore.com/terms-and-conditions) · [Sofascore API FAQ](https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability?lng=pt-BR) · [Flashscore/Livesport General Terms](https://docs.livesport.services/terms/terms-of-use/tou_2_web_en_v3.pdf)
- 备选：[Football Soccer API Docs](https://footballsoccerapi.com/documentation) · [Football Soccer API Pricing](https://footballsoccerapi.com/pricing) · [Sports Data Vault Data and Pricing](https://sportsdatavault.com/en/data/)
