# 当前赛季球员表现来源：官方文档与访问边界复核

核查日期：2026-10-07。目的：为 TactiScout 寻找能补足 FPL 与 ASA 的当前赛季、具名球员表现来源。仅核对来源方官网、官方 API 文档、官方条款和发布方自己的开源仓库；没有创建账号或使用密钥，没有请求受保护 API，没有自动抓取球员资料，没有绕过错误页、机器人限制或隐藏接口。本报告是工程选型，不构成法律意见。

## 结论

**没有找到一条同时具备广泛的当前赛季球员池、可解释的进攻/推进/防守指标、免费访问、明确模型输入和公开展示许可的来源。**“网页上能看到”“接口能请求”“免费 API key”都不能单独证明可以把数据长期存入候选数据库、提供给 LLM，或放进公开作品集。

按 TactiScout 的当前需求排序：

1. **API-Football Free：最接近原始球员统计的下一条技术验证路线。**官方 API 给出球员赛季和单场统计、年龄、分钟、进球/助攻、传球/关键传球、抢断、拦截、盘带等；覆盖量大并有每联赛/赛季的 `coverage`。免费额度为每天 100 次、每分钟 10 次，并限制可用赛季；该赛季精确范围需在账号中验证。它不证明具备 xG 或渐进传球统计。更关键的是，条款没有授予把数据发布在应用中的许可，并要求使用者自行取得必要的赛事权利，因此推荐仅做小范围本地字段/覆盖核验；公开展示或稳定写入作品集前先解决许可，不把它当作已经准入的默认源。[套餐](https://www.api-football.com/pricing/) · [官方接入指南](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) · [条款](https://www.api-football.com/terms)
2. **PlayerElo Free：最适合验证跨联赛外部能力信号，而不是代替本项目评估。**官方称其覆盖 176 项赛事、约 79K 球员并每日更新，免费档每月 500 次、每分钟 10 次；提供球员 Elo、EAR 状态、逐场 rating history、估算身价和 playing-style/per-90 路由。它提供的是发布方计算的二级评分，不是可复算的原始比赛统计；勿把其 `/fit`、`squad-gaps` 等产品结论当 TactiScout 自己的 Agent 推理。免费档标注 evaluation/hobby，商业许可属于付费层；关于本地 LLM 输入、长期存储/展示的边界没有查到更具体的公开条款。[API 与套餐](https://playerelo.football/api-access) · [官方字段示例](https://playerelo.football/docs)
3. **OpenScores：适合 MCP 工具编排和赛程/阵容/近期出场上下文，不足以充当球员能力评估主源。**它免费、有 REST/MCP、60 次/分钟与 2,000 次/小时；条款明确允许自有产品、Agent、研究及应用内缓存/转换。公开文档只承诺球员档案、生涯聚合、近期出场和队伍当前赛季阵容，没有球员逐场能力数据 schema 或 xG/推进/防守字段保证。FAQ 说每日 ingest；Changelog 记载从 SofaScore/Flashscore ingest，但公开页面未证明上游数据许可链，因此不能仅凭 OpenScores 自己的条款认定底层来源也已授权。[文档](https://openscores.ai/docs) · [FAQ](https://openscores.ai/faq) · [条款](https://openscores.ai/terms) · [Changelog](https://openscores.ai/changelog)
4. **Understat：字段价值最高的网页候选之一，但自动接入暂不准入。**官网列出五大欧洲联赛和 RFPL，球员页面可见 xG、xA、每 90 分钟指标、xGChain/xGBuildup 等字段；2026-10-07 的普通浏览器人工核查记录显示 EPL 2026/27 页已有当前赛季球员行。没有发现官方 API 文档、数据许可或自动采集授权；`robots.txt` 在本次访问中被客户端拦截，无法判断其内容。不得由此推断允许抓取。先向官网联系取得自动读取、缓存、模型输入和报告展示边界的明确答复。[官网](https://understat.com/) · [球员页示例](https://understat.com/player/8260) · [当日人工核查记录](./current-season-understat-access-audit-2026-10-07.md)

**FotMob 与 SofaScore 不列入自动采集路线。**FotMob 官方 robots 文件禁止通用爬虫访问 `/api/*`，条款又禁止自动服务及系统性/定期访问；SofaScore 官方 FAQ 表示数据提供方协议不允许以 API endpoint 对外提供数据，条款限制自动请求、抓取和大规模数据库内容提取。[FotMob robots](https://www.fotmob.com/robots.txt) · [FotMob terms](https://www.fotmob.com/terms) · [SofaScore API FAQ](https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability?lng=pt-BR) · [SofaScore terms](https://www.sofascore.com/terms-and-conditions)

## 来源核对

| 来源 | 当前球员统计与指标 | 当前性、访问、免费层 | 本地存储 / LLM / 展示边界 | 结论 |
|---|---|---|---|---|
| **API-Football** | `/players?league=…&season=…` 按联赛与赛季分页，返回年龄及赛季表现；指南列出出场、分钟、进球、助攻、射门、传球/关键传球/准确率、抢断、盘带、犯规、牌和点球。`/fixtures/players?fixture=…` 提供单场球员表现、评分、拦截、对抗等。官方资料未列 xG、渐进传球、压迫或跑动字段。 | 需免费账号和 `x-apisports-key`。Free 为 100 次/日、10 次/分钟，免费层的可用赛季有限但未公布固定范围。先看 `/leagues` 中每个联赛/赛季的 `coverage`，它也不保证每场都有完整记录。球员页建议每日查；条款强调文档中的刷新频率不保证。[套餐](https://www.api-football.com/pricing/) · [官方指南](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) · [限流](https://www.api-football.com/news/post/how-ratelimit-works) | 官方指南建议用本地数据库或缓存节省配额，这是工程建议，不等于数据再用许可。条款明确不授予用户将数据发布到应用/网站/产品的许可，并把第三方赛事权利与必要授权责任交给用户；没有发现明确授权本地 LLM、RAG 或永久保存。[条款](https://www.api-football.com/terms) | **小范围本地 schema/coverage spike 的首选；公开报告先不准入。**限流适合按需或小范围定时同步，不适合免费层一次拉全欧洲球员池。 |
| **PlayerElo** | 官方说明覆盖 176 项赛事，约 79K 球员，含 player Elo、EAR（近期表现）、逐场 rating history、28 日走势、估算市值、style/per-90 profile；API 示例展示身份、位置、当前队/联赛、比赛数/分钟和 rating。字段不等同于原始 xG、传球、对抗统计；style 路由虽然有简介，完整可比字段定义需实际 schema smoke。 | REST + bearer key。Free 500 次/月、10 次/分钟，计划写明 evaluation & hobby。发布方称每日更新。覆盖规模和更新频率是服务商声明，不代表每个球员最新比赛都有完整记录。[API](https://playerelo.football/api-access) · [字段示例](https://playerelo.football/docs) | 官方将 Free 限为 evaluation/hobby；Pro 是 production app/dashboard，Business 明列商业许可。页面称这些自有派生评分可作为模型、球探工具或研究的输入，但没找到本地 LLM、持久向量索引、输出中逐球员公开展示的具体授权条文。 | **作跨联赛外部基准/挑战信号的备选。**需把 Elo/外部派生信号单独呈现，不能替代项目自己的职责评分或作为唯一依据。 |
| **OpenScores** | 9 个只读 MCP 工具覆盖联赛、赛季、fixture、lineup、team、player 搜索与 profile。`get_player` 是生涯聚合与近期出场；`get_team` 描述当前赛季 squad。无完整球员表现 schema；不能根据营销页上“xG chain / carries / aerials”等自然语言示例假设数据字段存在。[官方 docs](https://openscores.ai/docs) | 注册获取免费 API key；MCP Streamable HTTP 或 REST。官方默认 60 次/分钟、2,000 次/小时；FAQ 称每日 ingest，不推送实时逐分钟数据；宣称覆盖五大联赛与 2026 世界杯。[FAQ](https://openscores.ai/faq) | 条款允许用于产品、Agent、研究，也允许 cache/transform；禁止转售原始数据为竞争数据集/API。Changelog 公开记载 SofaScore 和 Flashscore ingest；没有找到公开的上游授权链条，故不能推断上游数据都获得面向下游 Agent/展示的许可。[条款](https://openscores.ai/terms) · [Changelog](https://openscores.ai/changelog) | **可做工具/MCP 工作流上下文，不是综合球探表现来源。**若以后用真实球员资料，先补上游授权与当前赛季 schema/freshness 证据。 |
| **Understat** | 官网首页说明欧洲顶级联赛 xG；球员页可见 G90、xG90、射门/90、助攻/90、xA90、关键传球/90、xGChain90、xGBuildup90。人工核查 EPL 2026/27 页面当前行，详见并沿用同日 audit，不把页面值视为全覆盖保证。[首页](https://understat.com/) · [球员页](https://understat.com/player/8260) | 人工浏览器网页；未找到官网公开 API 文档。普通网页展示当前赛季数据不等于 API 或批量下载权限。没有字段级更新时间或 SLA。 | 没找到 `understat.com` 官方条款/许可对自动读取、缓存、LLM、RAG 或再展示的明确说明。误域名 `understate.com` 是无关男装站，不能作为 Understat 条款证据；官方 `robots.txt` 本次无法读取。 | **等待官方访问/再用范围澄清；不做自动请求或页面导出批处理。**数据字段有价值，但授权与自动访问接口未解决。 |
| **FotMob** | 官网产品提供大量赛果、阵容、比赛统计和 xG 类数据，但没有发现官方开发者 API 文档/接口许可。 | 官网 robots 对通用 user-agent 禁止 `/api/*`；free API key/documented developer tier 未发现。[robots](https://www.fotmob.com/robots.txt) | 官方 terms 说不允许自动服务（robots/crawler/indexing）及系统性或规律性访问；因此不要爬页面/内部接口或自动同步。[terms](https://www.fotmob.com/terms) | **不自动采集。**只作为人工核查时的网页参考。 |
| **SofaScore** | 官网展示丰富球员和比赛统计，但没有公开的可授权外部 API schema。 | 官方 API FAQ 表示其数据源协议不允许它向外共享 sports-data API endpoints。[FAQ](https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability?lng=pt-BR) | terms 限制自动负载、抓取、聚合、重制/复制数据库内容；没有公开授予第三方本地存储或模型使用的接口许可。[terms](https://www.sofascore.com/terms-and-conditions) | **不使用非官方私有 endpoints 或抓取。** |
| **Football Soccer API** | 官网有逐场球员 stats endpoint：分钟、评分、进球、射门、传球、关键传球、拦截、抢断、对抗、盘带等。但它标为 Archive 套餐；Free 没有 statistics，也没有历史赛季，只能读昨天、当天和未来赛程。[球员统计文档](https://footballsoccerapi.com/documentation/match-players) · [定价](https://footballsoccerapi.com/pricing) | Free key：$0、50 次/日、60 次/分钟、覆盖 171 国赛程与结果；player statistics 返回 403，因为是 Archive（$49/月）。虽有当前赛程的免费入口，不能因此获得球员表现行。 | 新版 AUP 明确允许商业应用、展示给用户、保存到自己的系统并在取消后保留；不允许批量复制归档竞争数据，禁止绕限额和抓取 HTML。该许可优势不改变 Free 没有球员统计的事实。[AUP](https://footballsoccerapi.com/acceptable-use) | **不符合零成本球员表现数据要求；若以后用户愿意付费，才值得重审。** |
| **官方开放数据集** | 当前已有 ASA 2026 赛季的北美球员表现指标，适合保留作有效的本地真实数据链路；StatsBomb Open Data 与 SkillCorner Open Data 是精选历史比赛/赛季样本，可用于复现指标和评测，但没有广泛的当前转会市场名单。 | ASA 当前范围受地区/赛事限制。StatsBomb 与 SkillCorner 为静态/历史数据集，不等同于可每天更新的当前球员目录。[StatsBomb Open Data](https://github.com/hudl/open-data) · [SkillCorner Open Data](https://github.com/SkillCorner/opendata) · [ASA SDK](https://github.com/American-Soccer-Analysis/itscalledsoccer-js) | 各数据集许可应按自身仓库和数据文件来源理解；代码许可证不自动覆盖数据。 | **维持 ASA 当前基准 + StatsBomb/SkillCorner 历史基准，不宣称其覆盖欧洲现役候选市场。** |

## 推荐推进顺序

1. 先确认想验证的是“可解释原始 stats”还是“全球独立评级”。前者用 API-Football Free 做极窄验证；后者才试 PlayerElo。
2. API-Football 若做验证，仅选一个目标联赛和当前 season：查可用赛季与 `coverage`，记录行数、页数、空值、年龄/位置/队伍 ID、字段单位、最后一场统计日期以及 429 行为。不要先拉全赛季/全联赛；free 的 100/day 容量很小。
3. 在把 provider 记录长期缓存、送入 Ollama、构建向量索引、或显示在可公开访问的作品集前，先向服务方确认用途边界。API-Football 条款明确不提供发布许可；若不能得到清晰答复，就只把 schema 摘要、fixture 来源链接和合成数据用于公开演示。
4. 将第三方结果限定为**带来源、赛季、更新时间、指标原定义的证据**。本项目仍自行计算职责匹配和岗位分数，LangGraph 负责按需取证、追问、回退和 Reviewer 验证；不调用 PlayerElo 的引援 fit/gap 产品来代替自己的核心 agent。
5. Understat 字段最符合进攻 xG 研究，但在获得明确自动访问与再用权限前，仅保留为人工网页核查候选。FotMob/SofaScore 不进入自动化路线。OpenScores 只有在球员统计 schema 和上游授权链补齐后，才升级为表现数据源。

## 本轮直接核对的一手资料

- API-Football：[定价](https://www.api-football.com/pricing/) · [玩家 API 官方指南](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) · [限流](https://www.api-football.com/news/post/how-ratelimit-works) · [服务条款](https://www.api-football.com/terms)
- PlayerElo：[API 与计划](https://playerelo.football/api-access) · [JSON 文档/示例](https://playerelo.football/docs) · [公开数据与方法介绍](https://playerelo.football/)
- OpenScores：[MCP/REST 文档](https://openscores.ai/docs) · [FAQ 与 cadence/rate limit](https://openscores.ai/faq) · [条款](https://openscores.ai/terms) · [Changelog](https://openscores.ai/changelog)
- Understat：[首页](https://understat.com/) · [球员页字段示例](https://understat.com/player/8260) · [同日访问审计](./current-season-understat-access-audit-2026-10-07.md)
- FotMob：[robots.txt](https://www.fotmob.com/robots.txt) · [条款](https://www.fotmob.com/terms)
- SofaScore：[API 可用性 FAQ](https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability?lng=pt-BR) · [条款](https://www.sofascore.com/terms-and-conditions)
- Football Soccer API：[Free/Archive 定价](https://footballsoccerapi.com/pricing) · [球员统计文档](https://footballsoccerapi.com/documentation/match-players) · [Acceptable Use](https://footballsoccerapi.com/acceptable-use)
- 开放数据：[ASA JS wrapper](https://github.com/American-Soccer-Analysis/itscalledsoccer-js) · [StatsBomb Open Data](https://github.com/hudl/open-data) · [SkillCorner Open Data](https://github.com/SkillCorner/opendata)
