# TactiScout 当前赛季球员表现数据源复核

核查日期：2026-10-07。范围：复核仓库现有 provider 路由，并比较可扩展候选池/球员表现能力的公开 API、官方数据仓库、官方方法说明与服务条款。只引用数据发布方或服务方的一手材料；未使用用户凭据、未调用需凭据接口、未抓取球员数据、未修改产品代码。本报告是工程选型，不构成法律意见。

## 结论

当前应用已经有 FPL、ASA、FBref、Sportmonks、StatsBomb、SkillCorner、Wyscout 和本地整理数据等路由；这并不代表它们都是等价、可持续或可交给 LLM 的来源。[provider 路由](../../../src/data/provider.ts) · [各数据集范围](../../../src/domain/dataset-scope.ts)

**当前已验证的“新鲜表现证据”是 ASA 2026 北美赛事，覆盖有实际球员统计的 MLS、NWSL、USL 等赛事；它能提供 xG/xA、xPass 和 Goals Added，但不是欧洲转会候选池，也不是完整注册名单。**当前工作区仍保留 FPL 自动采集路由；Premier League 条款限制未经书面批准复制、再利用或再分发网站内容并禁止由此建立数据库。FPL 另有自动系统访问/提取限制，自动提取不能仅凭非商业作品集或本地 Ollama 推理而获得许可。应将 FPL 标为待替换的实验路由，不能把它当作干净的公开演示数据源。[ASA 官方 JS wrapper](https://github.com/American-Soccer-Analysis/itscalledsoccer-js) · [Premier League Terms](https://www.premierleague.com/en/terms-and-conditions) · [FPL Terms](https://fantasy.premierleague.com/help/terms)

**面向下一次零成本、广覆盖的试验，首选 PlayerElo 作“外部能力信号”准入 spike；它不是新的权威比赛数据源，也不应替代 TactiScout 自己的证据分析。**发布方称数据覆盖 176 项赛事、79K+ 球员并每日更新，提供球员 Elo、近期表现 EAR、历史、位置/风格画像及按 90 分钟的指标；免费层每月 500 次请求、10 次/分钟，标为 evaluation/hobby，适合先做受控 schema 验证。它也公开提供面向 AI agent 的 MCP/API。文档没有说明其风格指标的底层比赛源、逐字段赛季与时间戳、球员年龄/API 字段覆盖，也未找到覆盖本地 LLM、公开报告和持久缓存的完整许可文本；所以在确认这些点前，数据只能作为待核验的外部辅助信号，不能进入公开报告或自动排名。[PlayerElo API 与计划](https://playerelo.football/api-access) · [API schema 示例](https://playerelo.football/docs) · [玩家风格页面示例](https://playerelo.football/players/133609)

**若目标是可追溯的当前赛季原始比赛表现统计，Sportmonks 是目前技术上最强的现成路线，但它需要账号/赛事权限、付费覆盖和模型处理许可核验。**Starter 当前列为月付 €29、任选 5 个联赛；球员比赛统计有传球、触球、盘带、对抗、抢断、拦截、射门、进球、助攻、分钟等，xG/Pressure Index 在独立附加包。仓库已经有其 TypeScript adapter，但它要求显式的模型处理许可开关；公开条款允许把数据存储、传输、分发到自有产品但禁止直接转售，没有查到将数据交给 LLM 的专项授权。故不应仅为跑通现有代码就把模型许可开关打开。[官方统计字段](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/statistics/players-statistics) · [套餐](https://www.sportmonks.com/football-api/plans-pricing/) · [条款](https://www.sportmonks.com/terms-of-service/) · [本地 adapter](../../../src/data/sportmonks-provider.ts)

没有找到一条同时满足“跨洲广泛当前阵容、原始且可解释的球员能力数据、日常更新、免费、明确允许公开展示和 LLM 处理”的单一来源。建议把“现役候选池”“可追溯表现证据”“第三方综合评分”分成不同能力，不再期待一条源全包。

## 数据源比较

| 来源 | 当前覆盖与可用球员信号 | 新鲜度证据 | 访问与成本 | 再用/模型边界 | 对 TactiScout 的判断 |
|---|---|---|---|---|---|
| **ASA** | 当前已有 adapter 和真实 2026 season 行。xGoals 含 xG、xA、射门、关键传球、分钟；xPass 有传球完成表现；Goals Added 有六类动作贡献。主要覆盖美国职业赛事，不包含五大联赛，也不是完整俱乐部注册 roster。[官方 wrapper](https://github.com/American-Soccer-Analysis/itscalledsoccer-js) · [g+ 方法](https://www.americansocceranalysis.com/what-are-goals-added) | API 记录按赛季汇总；官方接口没有每行最后更新比赛时间 SLA。仓库 2026-10-06 的受限 live 核查读到 2026 MLS xGoals/xPass 各 889 行、g+ 833 行，具体已记录在[ASA 覆盖核查](./asa-current-north-america-coverage-2026-10-06.md)。 | 官方 JS wrapper 可直接在 Node 使用；公开 API 不需 key。 | 官方应用 README 要求署名/链接；wrapper 软件 MIT 不等于球员数据许可。对逐球员公开展示、持久存储、LLM/RAG 的数据许可未找到明确的一手文本。[官方 app repo](https://github.com/American-Soccer-Analysis/asa-shiny-app) | **保留当前实数链路和评估基准。**报告必须写明北美赛事和赛季；不用于拜仁、巴萨等欧洲候选搜寻。 |
| **PlayerElo** | 官方 API 称有 176 项赛事、79K+ 球员、current club/league、Elo、EAR（近期状态）、历史、身价估算及 style/per-90 画像。公开球员档案可见非点球进球/90、助攻/90、关键传球/90、传球/90、抢断+拦截/90、盘带/90及同位置/同联赛百分位；这比 FPL/ASA 的地域或指标范围更宽，但属于服务商计算的二级分析，不是可复算的原始比赛事件。[API](https://playerelo.football/api-access) · [Player profile example](https://playerelo.football/players/133609) | 服务方称每日更新、球员 Elo 在比赛后更新；API 示例返回 match history。没看到每个 style/value 记录的字段级 `updated_at`、样本赛事赛季或覆盖完整率承诺。[评分说明](https://playerelo.football/player-ratings-api) · [API docs](https://playerelo.football/docs) | Free €0、500 请求/月、10/min，写明 evaluation & hobby；Pro €19/月写明 production apps/dashboard；Business €199/月列有 commercial licence/SLA。[计划](https://playerelo.football/api-access) | 页面说评分可作为 model/scouting tool/research 输入，另称其自有派生分析而非原始比赛数据转售；免费版条目并不等于明确准许公开部署、长期缓存或把数据交给本地 LLM。没有看到公开的通用完整 API 数据许可证。应书面确认后再走报告模型路径。 | **推荐下一个免费准入 spike。**只当作可比较的外部能力信号/研究线索；不要调用其 `/fit`、`squad-gaps` 直接生成引援结论，否则核心筛选和适配判断就外包给别家产品。用 TactiScout 自己的需求解析、缺口评估、LangGraph 工具编排及 Reviewer。 |
| **OpenScores** | MCP/REST 覆盖文档宣称五大联赛和 2026 世界杯；有 `get_team` 当前赛季 squad、`get_player` 球员生涯汇总与近期出场、fixture 事件统计。文档未公开足以预判的球员表现字段 schema；暂不能断言有可靠年龄、xG、推进、压迫等属性。[官方 MCP docs](https://openscores.ai/docs) | FAQ 称 live，terms 不给精度/完整性/可用性保证。文档/Changelog 均停在 2026-06-12，虽然当时建立每日 ingest，但它们没有证明五大联赛 2026/27 的当前 roster 或统计已经更新。[FAQ](https://openscores.ai/faq) · [Changelog](https://openscores.ai/changelog) | 免费 API key；MCP Streamable HTTP；默认每分钟 60 次、每小时 2,000 次。MCP-first 与 LangGraph tool harness 的调用边界吻合。 | OpenScores 自身 Terms 允许在自有产品、agent、研究中使用，并缓存/转换其响应；但其 Changelog 明确提到从 Sofascore/Flashscore 入库，部分世界杯 roster 由 Flashscore 页面解析。没有公开其对这些上游数据的许可链。自己的条款不自动证明上游授权。[Terms](https://openscores.ai/terms) · [Changelog](https://openscores.ai/changelog) | 可做**候选池/近期出场 schema 检查**，不能单独做战术能力评估；当前性和上游来源许可仍未确认。比无边界爬网页更易控，但不能称权威源。 |
| **Sportmonks** | 2,200+ league API，按账号联赛 entitlement 返回 roster、球员档案、按比赛/赛季统计。官方示例称单场最多见 63 个球员统计种类，文档包含 shots、passes、crosses、tackles、interceptions、clearances、duels、dribbles、fouls、big chances、minutes、rating 和 xG。非 GPS/追踪数据；xG/Pressure Index 独立 add-on。[官方 player stats docs](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/statistics/players-statistics) · [套餐特征](https://www.sportmonks.com/football-api/plans-pricing/) | 官方宣传 live event 平均约 15 秒；这不等于球员赛季统计或 roster 有逐字段更新 SLA。实际目标联赛季与字段须用账户核验。 | Free 仅丹麦 Superliga 与苏格兰 Premiership。Starter €29/月选 5 联赛；xG/Pressure Index Bundle 起 €29/月；付费试用要求银行卡。[Free](https://www.sportmonks.com/football-api/free-plan/) · [Pricing](https://www.sportmonks.com/football-api/plans-pricing/) | Terms 允许将服务数据存储/传输/分发在自有产品里，允许基于数据构建应用，禁止直接转售；没有看到 AI/LLM/embedding 专门条文。[Terms](https://www.sportmonks.com/terms-of-service/) | **可追溯数据的优选生产路线，但需预算与书面模型处理确认。**TS adapter 已存在，需要验证真实 entitlement/payload，再分离“抓取与确定性评估”和“允许模型处理”的 gate。 |
| **FPL** | 当前 FPL 目录、位置/球队及游戏赛季字段；不等于 EPL 官方注册 roster，指标为 fantasy game 统计。 | 随游戏更新，但官方没有稳定开发者 API schema/SLA。 | 当前 adapter 无 key 请求 bootstrap endpoint。 | FPL Terms 明确限制自动系统访问/提取 Game 信息；公开站点再利用也受 PL 权利条款约束。[FPL Terms](https://fantasy.premierleague.com/help/terms) · [PL Terms](https://www.premierleague.com/en/terms-and-conditions) | **不应保留为默认自动球员源。**代码可暂留本机实验，但生产/演示前应把路由关掉或替换，记录这是条款准入问题而非网络错误。 |
| **FBref** | 五大联赛当前球员赛季页有年龄、宽位置、球队、分钟、进球/助攻及若干普通技术统计；不能代表完整注册阵容。2026 年官方公告已说明高级足球数据范围被移除/缩减，不宜把旧 scraper 指标列表当今天的能力字段。[FBref coverage](https://fbref.com/en/stathead/stat_coverage.cgi) · [2026 数据公告](https://www.sports-reference.com/blog/2026/01/fbref-stathead-data-update/) | 首页自述每日更新，但 Terms 免责声明称不保证内容最新、准确或完整。 | 网页抓取；官方说明无 API 的原因与上游数据合同有关。[bot/access FAQ](https://www.sports-reference.com/bot-traffic.html) | Sports Reference Terms 直接禁止将站点内容用于 AI 模型 prompting/instructing，以及可能影响访问的未授权自动化。即使个人、非商业或只用本地模型，也不能按公开条款默认允许。[Terms](https://www.sports-reference.com/termsofuse.html) | **不作为当前 Agent 自动候选数据路由。**可给人工复核者提供链接；取得明确书面授权才考虑自动接入。 |
| **SkillCorner Open Data** | 2024/25 澳大利亚 A-League 的季节聚合包括身体表现、无球跑动、传球；另有 10 场 tracking/events。指标维度很贴合战术适配，但它是历史单联赛样本，并且聚合筛选仅保留单次出场超 60 分钟。[官方 repo](https://github.com/SkillCorner/opendata) | 静态 GitHub 文件，无线上刷新或当前 roster。 | 公开仓库带 MIT 标识；README 同时要求署名，但没有专门声明所附球员比赛数据的完整再分发/AI 权利。不可把 repo 的代码许可证无条件外推成数据许可。 | **适合作为离线战术评估样本，不适合作现役市场源。**可用于角色模板、字段映射和历史回归测试，不应把 2024/25 说成当前表现。 |
| **StatsBomb Open Data / Wyscout 本地历史集** | 选定赛事的细粒度比赛事件/阵容，可复算推进/射门/动作指标；仓库 Wyscout 快照是 2017/18。它们能丰富可解释历史 benchmark，但不是当前球队 roster。[StatsBomb repo](https://github.com/hudl/open-data) · [本地范围](../../../src/domain/dataset-scope.ts) | 本地数据集；更新和覆盖依赖本机准备的文件。 | StatsBomb 要求发布分析注明来源并使用 logo，受 User Agreement 约束；Wyscout 文件沿 CC BY 4.0 用途保留来源署名。各自权利以对应发布条款为准。[StatsBomb README](https://github.com/hudl/open-data/blob/master/README.md) | **保留为历史可复现评估集和指标定义来源。**不满足当前赛季球员候选发现。 |

## 选型与 LangGraph 接入建议

### 下一步选哪条

建议先走 **PlayerElo 的有限免费 schema/许可 smoke**，而不是立刻把它的转会 fit API 作为一键 shortlist。理由是：它的产品明确提供球员层级的评分、近期状态、逐场历史和 per-90 风格信号；免费档够验证接口是否给项目带来实际增量；它还同时提供 REST 与 agent/MCP 入口，能验证 Agent 如何在需要时获取第二类证据。它最容易测试“外部估值是否能帮助 TactiScout 补全全球候选评估”，但是否足以成为生产来源仍未知。

Sportmonks 是后续可解释表现主源选项：若用户确定接受按月订阅，先用当前既有 adapter 对 1 个目标联赛/赛季做账号 entitlement 与字段覆盖 smoke；在模型处理权限没确认前，数据可由确定性代码计算但不交给 Planner/Reviewer。OpenScores 可作为免费 roster/近期比赛备选，但其公开 schema 和 2026/27 fresh-ness 比 PlayerElo 更不清晰，且 ingest 依赖的上游来源许可未证实。

### PlayerElo spike 验收步骤

1. 用户自行创建免费 API key；放在服务端环境配置 `PLAYER_ELO_API_KEY`，不进 Vite/browser/localStorage、git 或日志。
2. 只做受限请求：一个目标俱乐部 roster、目标联赛 1 页候选、最多 3 名球员的 profile、style 与 history；遵守 500 请求/月和 10 次/分钟限制。[官方计划与 endpoint](https://playerelo.football/api-access)
3. 不保留整包原始数据；只记录 endpoint/schema、球员 ID、联赛/球队/赛季关联字段、style 数值与单位、比较人群、统计时间、返回行数/空值率和 API 更新信息。年龄/惯用脚/位置等字段没有实际响应证明前必须标为未知。
4. 测试前先核对并记录用途范围：免费 evaluation/hobby 是否允许公开简历 demo；本地 Qwen 作为模型输入是否被允许；逐球员展示、派生指标、缓存/留存期限、终止后删除、上游数据来源与 attribution。API 描述提到“model/scouting tool”是正面信号，但不是完整的针对 TactiScout 使用场景的书面许可。
5. 验收通过后，把它接成**只读的外部证据工具**，由 LangGraph Planner 在用户需求确实缺近期表现/跨联赛对照时调用；工具输出保留 `providerPlayerId`、来源页面/API、赛事、赛季、retrievedAt 与原始指标定义。Ranker 仍由本项目的确定性指标计算、岗位模板和规则完成，Reviewer 检查数据缺失/异源不可比/小样本；报告把 PlayerElo 评级和 TactiScout 直接计算的统计分栏展示。不要按姓名悄悄把它跟 ASA/StatsBomb/FPL 同源合并。

**停止条件：**如果 free plan 只允许私人工具试验；style 行没有样本季/人群/时间语义；或者供应商无法说明模型处理/公开报告用途，就把它留在本机隔离 smoke 或彻底放弃，不将其列为候选评分证据。此时下一条可行路线是争取 Sportmonks AI 用途书面确认，或者继续用 ASA+历史 StatsBomb/Wyscout/SkillCorner 做透明的“有限范围”作品，而不是改成无边界网站爬虫。

## 对本项目的具体影响

- 目前有一处实质数据准入问题：代码保留 `fpl` 和 `fbref` 自动 provider；官方条款与自动提取/LLM 输入相冲突。此报告不改环境变量或代码，下一产品 issue 应先将路线状态标为 `not-admitted` 并避免默认运行，再由主任务决定是否移除它们。
- 当前 ASA 端到端 LangGraph 验收证明了真实外部数据可被 Agent 调用、追问和引用，不证明跨联赛推荐准确率；范围是北美当前赛季且不是 roster 全集。[ASA 2026 现场核查](./asa-current-north-america-coverage-2026-10-06.md)
- Sportmonks adapter 有意要求 `TACTISCOUT_SPORTMONKS_AI_PROCESSING_ALLOWED=true`，在没有模型许可前不能为方便验收而设置 true；可把一次调用拆成 source fetch/确定性分析和 LLM reasoning 两种权限。[代码](../../../src/data/sportmonks-provider.ts)
- 任何新来源都须给出来源 ID、赛季/赛事、可追溯字段、时间范围与缺失率。provider 的覆盖宣传、公开 HTTP 响应、`MIT` 字样、免费 key 或一次 API smoke 都不能单独证明 roster 完整、统计是 current season，或允许 prompt/公开持久缓存。

## 官方一手来源

- PlayerElo：[API/价格/用途](https://playerelo.football/api-access) · [API docs](https://playerelo.football/docs) · [评分方法说明](https://playerelo.football/player-ratings-api) · [profile/style 示例](https://playerelo.football/players/133609)
- OpenScores：[MCP docs](https://openscores.ai/docs) · [FAQ / 限额](https://openscores.ai/faq) · [Terms](https://openscores.ai/terms) · [Changelog / 上游采集](https://openscores.ai/changelog)
- Sportmonks：[球员统计 schema](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/statistics/players-statistics) · [免费赛事](https://www.sportmonks.com/football-api/free-plan/) · [价格](https://www.sportmonks.com/football-api/plans-pricing/) · [Terms](https://www.sportmonks.com/terms-of-service/)
- ASA：[官方 JS wrapper](https://github.com/American-Soccer-Analysis/itscalledsoccer-js) · [Goals Added 方法](https://www.americansocceranalysis.com/what-are-goals-added) · [数据 app attribution](https://github.com/American-Soccer-Analysis/asa-shiny-app)
- Premier League / FPL：[Premier League Terms](https://www.premierleague.com/en/terms-and-conditions) · [FPL Terms](https://fantasy.premierleague.com/help/terms)
- Sports Reference / FBref：[Terms](https://www.sports-reference.com/termsofuse.html) · [bot traffic](https://www.sports-reference.com/bot-traffic.html) · [2026 data update](https://www.sports-reference.com/blog/2026/01/fbref-stathead-data-update/)
- 历史公开样本：[StatsBomb Open Data](https://github.com/hudl/open-data) · [SkillCorner Open Data](https://github.com/SkillCorner/opendata)
