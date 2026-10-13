# TactiScout 当前数据源路线决策

核查日期：2026-10-06。按各服务/发布方公开页面、官方仓库和本机现有实现核对；没有注册账号、申请 key、调用需凭据的接口，也没有下载或保存球员数据。覆盖文档说明的是服务方宣称的能力，不等于本机账户 entitlement、完整阵容或数据权利证明。

## 建议

在这五个来源里，**OpenScores 是最适合下一步做低成本欧洲球员池试验的候选**：公开文档覆盖五大联赛，提供球队当前赛季阵容、球员搜索和球员档案；免费 key 即可调用；其条款允许把响应用于自己的产品与 Agent，并允许应用内缓存和转换。[官方文档](https://openscores.ai/docs) · [FAQ](https://openscores.ai/faq) · [条款](https://openscores.ai/terms)

它现在还不能直接标成“已验收的 2026/27 球探源”：文档最后更新于 2026-06-12，没有确认 2026/27 各队阵容是否已同步；也没有公开完整的球员统计 schema、年龄字段、字段新鲜度或 OpenScores 对上游数据拥有的授权范围。其 changelog 提及 Sofascore 与 Flashscore 的采集来源，但没有公开说明下游授权链。[OpenScores 文档](https://openscores.ai/docs) · [changelog](https://openscores.ai/changelog)

**现在最实际的推进：**等用户在本机自行配置 OpenScores 免费 key 后，只做一个球队的只读 schema smoke，核实 2026/27 阵容、身份 ID、年龄/位置以及实际存在的能力统计字段；不以一次 smoke 宣称完整球员池或推荐质量。OpenScores 条款明确支持 Agent 和产品内缓存，但没有单独写明持久 RAG/embedding，也没有公开证明上游来源授予了同样的权利。若目标是更宽的球员逐场指标，Sportmonks 的能力更强，但英德西意法五联赛至少需 Starter（€29/月）和本地 token；它的公开资料也没有明确回答 LLM 输入许可。[OpenScores terms](https://openscores.ai/terms) · [Sportmonks 价格](https://www.sportmonks.com/football-api/plans-pricing/) · [Sportmonks 服务条款](https://www.sportmonks.com/terms-of-service/)

在这五个来源里，**尚无一条可直接称为“范围符合、权利清楚、已验证可公开展示球员级资料”的完整路线**。ASA 是无需 key、已有真实当前赛季能力指标的低成本工程路线，但范围仅为北美赛事且不是注册阵容；它公开要求署名，公开逐球员展示、长期留存与 LLM/RAG 权限仍未由所查资料明确。不要把免费层、匿名访问或一次技术 smoke 当作上游数据许可。[ASA API wrapper](https://github.com/American-Soccer-Analysis/itscalledsoccer) · [ASA 数据应用](https://github.com/American-Soccer-Analysis/asa-shiny-app)

## 来源比较

| 来源 | 覆盖、调用方式与能力字段 | 费用与 key | 产品展示、缓存和模型边界 | 决策 |
|---|---|---|---|---|
| **OpenScores** | MCP Streamable HTTP；9 个只读工具，包括 search_players、get_player、get_team。文档宣称五大联赛和 2026 世界杯，get_team 提供当前赛季 squad；get_player 有生涯汇总和近期出场。工具响应有分页约定，但没有完整玩家字段 schema；年龄与渐进传球、压迫、xG/xA 等字段不能凭首页示例假设存在。FAQ 称每日 ingest，不是逐分钟直播。[Docs](https://openscores.ai/docs) · [FAQ](https://openscores.ai/faq) | 免费；需注册并创建 osk_live_ Bearer key。默认 60 次/分钟、2,000 次/小时。[Docs](https://openscores.ai/docs) · [FAQ](https://openscores.ai/faq) | 条款允许自有产品、Agent、缓存和转换，禁止转售原始数据/竞争 API。Agent 工作流是明确用途；未看到持久向量库、训练或具体 LLM/RAG 的独立条款。上游数据授权链未公开。[Terms](https://openscores.ai/terms) · [Changelog](https://openscores.ai/changelog) | **优先做免费 key 的受限联调**，不先承诺数据完整性或公开呈现逐球员事实。 |
| **Sportmonks** | REST/JSON，api_token 认证，支持按联赛/赛季取球队、阵容及球员表现。官方英超样例列出 63 类球员统计，包括分钟、传球/准确率、关键传球、盘带、对抗、抢断、拦截、射门、进球、助攻和评分；字段随联赛/比赛变化。xG/Pressure Index 等是高级附加项。[球员统计](https://www.sportmonks.com/football-api/football-stats-api/) · [API 入门](https://docs.sportmonks.com/v2/get-started/get-started) | 永久免费层仅丹麦 Superliga、苏格兰 Premiership；需账号/token。Starter 月付 €29，任选 5 个联赛，2,000 次/实体/小时。14 天付费试用要求银行卡。[免费层](https://www.sportmonks.com/football-api/free-plan/) · [价格](https://www.sportmonks.com/football-api/plans-pricing/) | 服务条款允许把数据放入自有应用、缓存和展示，禁止转售；公开资料未明确授权将数据发送给 LLM/Ollama、建立 embedding/RAG。没有逐球员数据的来源方许可证明或稳定性保证。[条款](https://www.sportmonks.com/terms-of-service/) · [Integrity](https://www.sportmonks.com/integrity-support/) | **丰富表现字段的工程主源候选**；欧洲五大联赛需付费、本地 key，并先确认 AI 用途。 |
| **API-Football** | REST，注册后以 API key 调用。官方指南列出 /players 按联赛/赛季或球队/赛季查球员档案与统计，包含年龄/国籍、分钟、进球/助攻、射门、传球、关键传球、抢断、盘带等，分页每页 20 人。覆盖页称有 1,247 项赛事，且明确覆盖随赛季/比赛变化；覆盖目录不代表免费账户可访问当前赛季。[指南](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) · [Coverage](https://www.api-football.com/coverage) | 免费 $0、100 次/日、不需信用卡；仍需账户和 key。官方价格页说免费层可用赛季受限，没有确认本机免费权限含 2026/27。[价格](https://www.api-football.com/pricing/) | 条款说 API-Football 不授予在用户应用/网站/其他产品发布数据的许可，相关授权须由使用者向权利方申请；没有明确的公开 LLM/长期缓存许可。[Terms](https://www.api-football.com/terms) | **不作为公开作品集数据源**；即使拿到 key 并成功返回，也只验证技术/账户覆盖。 |
| **ASA** | 官方 Python/JS wrapper 调用公开 API，无需 key；球员表现接口提供 xGoals、xPass、Goals Added。现有仓库记录了 2026 MLS、NWSL、USL Championship、USL League One、USL Super League 的当前赛季表现行；不是欧洲联赛，也不是完整注册名单。[本机 2026 覆盖核对](asa-current-north-america-coverage-2026-10-06.md) · [ASA Python wrapper](https://github.com/American-Soccer-Analysis/itscalledsoccer) · [JS wrapper](https://github.com/American-Soccer-Analysis/itscalledsoccer-js) | 免费公开 GET，无 key。 | ASA 数据应用请求署名/链接；未找到单独覆盖逐球员公开展示、长期留存或 LLM/RAG 的数据许可。wrapper 的 MIT 许可是软件许可，不应外推为球员数据许可。[ASA app](https://github.com/American-Soccer-Analysis/asa-shiny-app) · [wrapper](https://github.com/American-Soccer-Analysis/itscalledsoccer) | **目前可立即继续验证 Agent 的低成本实数路线**，但产品必须明确标为北美赛事数据；不是欧洲引援池，也不代表公开数据权利已全部确认。 |
| **Fantasy Premier League (FPL)** | 本机 provider 匿名 GET https://fantasy.premierleague.com/api/bootstrap-static/，从游戏目录映射当前球员、球队、宽位置、年龄及实测赛季统计。Issue 74 记载 2026-10-06 返回 667 条、20 个英超俱乐部；只证明当时接口返回这些行，不证明完整注册名单。没有官方稳定开发者 schema。[本机 provider](../../../src/data/premier-league-fantasy-provider.ts) · [Issue 74](../issues/74-premier-league-current-player-repository.md) | 当前接口不需 key；免费。 | **2026/27 官方 FPL 条款明确禁止用自动系统访问 Game 并提取信息，并声明 Game data 的 IP 属于 Premier League。**本机 agent 会把候选与统计作为工具证据交给本地模型；本地推理不消除自动提取限制。[FPL Terms](https://fantasy.premierleague.com/help/terms) · [Issue 74](../issues/74-premier-league-current-player-repository.md) | **停止将 FPL 作为运行中的自动候选池路线**。免费、可读、已通过 LangGraph 验收都不等于得到自动访问或公开使用许可。 |

## 本机 FPL 配置核对

- 当前 .env 中 TACTISCOUT_DATA_MODE=fpl；.env.example 示例值为 demo；代码未设置环境变量时也回退到 demo。所以 fpl 是此工作区的本地覆盖配置，并非代码默认值。[.env](../../../.env) · [.env.example](../../../.env.example) · [provider.ts](../../../src/data/provider.ts)
- FPL provider 对 bootstrap endpoint 发起自动 HTTPS 请求并缓存 15 分钟；Agent 工具链会将球员身份/球队/位置/赛季和实测统计返回给模型。Issue 74 记录已在 2026-10-06 用真实本地 Qwen/LangGraph 运行该链路。[FPL provider](../../../src/data/premier-league-fantasy-provider.ts) · [Issue 74](../issues/74-premier-league-current-player-repository.md)
- 2026/27 条款第 28(d) 款直接禁止自动系统访问 Game 并提取信息，第 29 款说明 Game data 的知识产权归 Premier League。故当前配置与官方条款之间存在实际冲突；本次只记录并建议停止使用该模式，没有改动 .env、代码或其他文件。[官方条款](https://fantasy.premierleague.com/help/terms)

## 下一步门槛

1. **欧洲免费试验：**由用户在本机自行创建 OpenScores key 并配置后，再做单队只读验证。记录工具版本/时间、球队和球员 source ID、赛季、年龄/位置字段、实际指标名/单位/样本分母、分页和缺失率；只记录结构与计数，不保存球员 payload。若没有可用的能力统计字段，停止把它当能力评分来源。
2. **公开展示：**OpenScores 自身条款允许产品/Agent 使用和应用级缓存，但需进一步确认 2026/27 字段和上游许可链；未经确认，不生成公开的完整逐球员资料库。Agent 单次上下文处理与持续 RAG/embedding 分开判定。
3. **丰富欧洲统计：**如果用户接受按月付费，用户在本机配置 Sportmonks token 后，才可验证 Starter 对选定五联赛的实际 roster、字段空值与当前赛季覆盖。先向服务方确认 Ollama/LLM 输入和报告输出用途，再启用模型数据路径。
4. **不要把 API-Football 免费账户当作发布许可；不要继续用 FPL 自动抓取替代缺失数据。**ASA 可继续作为无需凭据的 Agent 实数演示，但产品界面必须清楚标注赛事范围、指标来源和时间，且不能宣称覆盖欧洲或全球转会市场。

## 未验证

- OpenScores 的 2026/27 逐队名单完整性、年龄/能力统计实际字段、field-level 更新时间、上游授权链，以及长期数据库/RAG 使用范围。
- Sportmonks 任何具体账户的联赛 entitlement、套餐下真实统计字段/空值率、当前名单更新时间，以及 LLM 用途。
- API-Football 免费 key 是否能访问各目标联赛 2026/27 球员统计；当前账户无 key。
- ASA 数据是否获准用于本项目公开逐球员展示、长期保存和 LLM/RAG；当前研究只确认官方应用请求署名，没找到覆盖这些用途的数据许可。
- FPL 不是“未验证可否调用”：本机路径已真实调用并经 Agent 运行；未解决的是官方条款对自动提取的明确限制。
