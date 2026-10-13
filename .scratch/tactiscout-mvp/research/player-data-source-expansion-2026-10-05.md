# TactiScout 球员数据源扩展：近期能力证据与许可边界

核查日期：2026-10-05。仅查官方 API 文档、服务条款、数据发布页及官方仓库。没有申请 API key、调用需凭据的 endpoint、下载新数据集或联系供应商。本报告聚焦现役球员发现与可解释能力证据，不构成法律意见。

## 结论

**没有发现一个免费、近期、覆盖广、具名且有细粒度比赛指标、并明确允许公开应用和 LLM 处理的开放来源。**扩大来源应按用途分层，而不是把 roster、赛事统计和厂商评分拼成一个无差别球员库：

1. **主候选池继续验证现有 Sportmonks 路径。**仓库已有 adapter，且此前官方计划复核显示它是当前球员池的主要可行候选。真实账户的联赛 entitlement 与 Ollama 处理权仍未确认，先按 [issue 48](../issues/48-sportmonks-current-pool-smoke.md) 做无模型、可审查的本机验证。[当前球员池决策复核](current-player-pool-provider-decision-2026-10-04.md)
2. **PlayerElo 只做可选的外部信号验证。**官方称覆盖 176 项赛事、每日更新；API 有球员搜索/详情/历史/风格以及联赛球员端点。免费档是每月 500 次、每分钟 10 次的 hobby/evaluation 级别，页面没有明确承诺免费档可公开展示、长期缓存或发送给生成式 LLM。可作为 roster 线索或并列的外部 Elo/EAR 参考，不能替代 TactiScout 的可复算能力证据或评分。[API 与价格](https://playerelo.football/api-access) · [字段示例](https://playerelo.football/docs)
3. **若准备购买新数据，SportsDataIO 值得先询价，不值得用 scrambled trial 验证球员能力。**其官方 API 确有当前成员关系、球队名册、赛季与单场球员统计端点；但价格按 feed/联赛/用途报价。商业许可可按具体用途允许缓存、机器学习和衍生结果展示；通用 LLM 输入是否包含在许可内，仍应书面确认。[Soccer API 文档](https://sportsdata.io/developers/api-documentation/soccer) · [数据权利与许可 FAQ](https://sportsdata.io/help/data-rights-and-licensing-questions)
4. **开放表现数据最值得作为方法验证的是 DFL 授权发布的 IDSSE 七场比赛集。**它有 CC BY 4.0、具名球员、事件和跟踪数据，可支撑可解释事件/空间指标实验；它只有 2022/23 德甲及德乙七场，不能作为当前候选池或可靠的球员排名集。[官方数据论文与发布信息](https://www.nature.com/articles/s41597-025-04505-y) · [Figshare 数据项](https://doi.org/10.6084/m9.figshare.28196177)
5. **不抓取 FIFA、英超/FPL 页面补当前数据。**网页有统计，不代表有数据再利用许可。英超官方条款限制非私人用途的复制、再利用、数据库和再分发；英超官方指引将比赛数据许可引向 Football DataCo。若未来要买英超 feed，应走正式许可询价，并问清派生指标、缓存与 AI 使用权。[英超条款](https://www.premierleague.com/en/terms-and-conditions) · [英超比赛数据联系指引](https://www.premierleague.com/en/news/102426)

## 候选来源核验

### PlayerElo：可做小样本外部信号，不是原始比赛统计

- **接口与字段：**官方文档列出 `GET /v1/players?search=...`、`GET /v1/players/{id}`、`/history`、`/trend`、`/style`、`/value`、`GET /v1/leagues/{id}/players` 等。详情示例含 `player_id`、姓名、位置、当前球队/联赛、出场数、分钟、Elo 与多个时间窗 EAR；history 是逐场 Elo/EAR，不是逐场事件。[API 文档](https://playerelo.football/docs) · [endpoint 列表](https://playerelo.football/api-access)
- **覆盖和刷新：**服务方称 79K+ 球员、176 项赛事并每日更新。该范围是供应商自报覆盖，不代表 176 个联赛均有完整名册/统计或统一更新时间 SLA。[API 页面](https://playerelo.football/api-access) · [模型说明](https://playerelo.football/)
- **价格/调用：**Free €0、500 请求/月、10 次/分钟，标注 evaluation & hobby；Pro €19/月、10,000 次/月，标注 production apps & dashboards；Business €199/月、300,000 次/月，页面列有 commercial licence 与 SLA。所有端点均需 Bearer key。小样本可以用 free 验证；不能假设免费配额适合扫描所有候选或逐个案件全量查询。[计划与价格](https://playerelo.football/api-access)
- **产品边界：**姓名、provider ID、位置、球队/联赛可作为待核验的身份线索；当前球队只代表供应商记录，不能单独作为“已确认在册”。Elo/EAR/style 是供应商模型产物，适合单列为第三方信号，不能称作原始传球、推进或防守指标。`/fit`、`/prospects`、估值等是供应商模型结论，不应替代 TactiScout 的适配分析或预算事实。[fit/估值接口定义](https://playerelo.football/api-access)
- **权利状态：**官方页面写评分可作为模型、球探工具或研究的输入；付费计划允许商业使用，Business 另列商业许可。公开 API 页面未说明具体字段缓存期限、终止后的留存、公开作品集逐人展示，或向本地 Ollama/托管生成式模型传输数据的范围。把“model input”解释成生成式 LLM 授权仍属推断，需直接书面确认。[API 价格与用途](https://playerelo.football/api-access)

**判断：条件 GO——本地、小样本、只读验证；公开逐人展示或交给 LLM 前暂停。**保留来源 ID 和抓取时间；外部评分单独显示、不混入内部指标或排序。此判断与项目现有 PlayerElo 交叉身份实现方向一致，相关 map 已将真实 key、覆盖和权利验证列为未完成。

### SportsDataIO：商业 feed 有指标，价格与具体授权需先确认

- **接口与字段：**文档列出当前球队成员 `GET /v4/soccer/scores/{format}/ActiveMemberships/{competition}`、按球队取名册 `.../PlayersByTeamBasic/{competition}/{teamid}`、赛季球员汇总 `GET /v4/soccer/stats/{format}/PlayerSeasonStats/{competition}/{season}`，以及按日期取单场球员统计 `.../PlayerGameStatsByDate/{competition}/{date}`。名册和数据字典包括 provider player ID、姓名、粗位置、队伍、上场分钟；统计表包含进球、助攻、射门、射正、传中、抢断、拦截、犯规、传球/成功传球、触球等普通 box-score 项。它能补充具名球员常规表现，但文档未显示渐进推进、压迫、承压传球等细粒度战术事件指标。[Soccer API 文档](https://sportsdata.io/developers/api-documentation/soccer) · [官方字段字典](https://sportsdata.io/developers/data-dictionary/soccer)
- **刷新与查询：**文档给出的建议调用间隔分别为 ActiveMemberships 每日、Player Profiles by Team 5 分钟、Player Season Stats 15 分钟、Player Game Stats 5 分钟；这些是 endpoint 的调用间隔提示，不应误读成全球套餐限额或数据 freshness SLA。[Soccer API 文档](https://sportsdata.io/developers/api-documentation/soccer)
- **价格和试用：**商业计划按所需赛事、feed 和用途报价，官网未公布 Soccer 商业 feed 固定价格。free trial 文档仅开放 UEFA Champions League（competition ID 3），并明确用 scrambled 数据供集成验证；因此可以测响应结构，不可拿 trial 统计验证球员排名或公开报告。[API 测试方式](https://sportsdata.io/developers/apis) · [价格/数据需求入口](https://sportsdata.io/contact-us)
- **展示、缓存和模型处理：**官方许可 FAQ 称 commercial license 可允许将 API 响应缓存/存入自有数据库，也可许可作为统计模型、机器学习、预测、评分等派生分析的输入，并允许在约定产品中展示派生输出；许可按 use case 和 feeds 确定。个人非商业项目不需商业许可。官方材料未明确生成式 LLM prompt 是否属于上述 machine-learning use，故必须在合同中点名本地 Ollama/云 LLM、所发字段、缓存期限、展示与终止后保留。[权利与许可 FAQ](https://sportsdata.io/help/data-rights-and-licensing-questions) · [服务条款](https://sportsdata.io/terms-of-service)

**判断：条件 GO——只先询价/确认覆盖与许可，不开始生产接入。**询价应限定一至两个目标联赛和所需的球员 roster/season stats feed，并问清商用作品集展示、LLM 输入、缓存和合同结束后的数据处置。若报价仅含常规 box score，其能力评估增益可能小于现有 Sportmonks；不应为了“多一个 provider”购买。

### Stats API：AI-agent 条款较清楚，但当前球员数据覆盖页面互相矛盾

- **价格/许可：**新账户有一次性 1,000 请求、30 次/分钟；Starter $19.50/月、10 万次/月。有效账户条款允许在自己的 apps、analyses、internal workflows 和 AI-agent tools 中使用返回的 factual data，但受 plan limit 和具体上游 source 限制。[价格](https://stats-api.com/pricing) · [服务条款](https://stats-api.com/legal/terms)
- **覆盖和更新：**source ledger 明确列出 OpenFootball 的赛程/赛果、API-Football 的赛事/球队/赛程/赛果/球队比赛统计；自报 ingestion 当前无最大数据年龄、无刷新间隔保证，`source_updated_at` 为空且 `freshness_guaranteed=false`。[source ledger](https://stats-api.com/data-sources) · [coverage](https://stats-api.com/coverage)
- **不确定处：**pricing 概述称当前 25 个接口含 squads、match and player statistics、lineups、injuries；但 coverage 页把 lineups & players 列为需要授权源/roadmap，source ledger 当前启用数据中也没有球员赛季/单场表现字段。它处于 beta，当前公开材料不足以确认某个目标联赛的实名球员、现役队籍及字段数据真的能用。[pricing](https://stats-api.com/pricing) · [coverage](https://stats-api.com/coverage) · [OpenAPI](https://stats-api.com/openapi.json)

**判断：NO-GO 作为当前候选/表现来源；保留观察。**AI-agent 用途措辞有价值，但只有在服务商公开一致的球员 coverage/字段、更新时间和 source rights 后才重新评估。

### DFL / IDSSE 七场比赛：许可清楚的战术指标 benchmark

论文说明 DFL 原始比赛数据经授权以 CC BY 4.0 发布，包含 2022/23 德甲 2 场、德乙 5 场，数据包括实名球员/球队/阵型、逐事件及球员/球/坐标跟踪。发布规模为 207 名球员、10 支球队、11,137 个事件和 1,002,644 帧位置数据；事件字段含逐射门 xG，跟踪帧含坐标、跑动距离、速度和加速度。[论文、字段与样本](https://www.nature.com/articles/s41597-025-04505-y) · [原始 release](https://doi.org/10.6084/m9.figshare.28196177)

**判断：GO 作为本地/公开方法验证样本，按 CC BY 4.0 署名并记录改动；NO-GO 作为当前候选池、完整赛季球员评价或代表性排序。**七场样本很适合验证事件 schema、空间量计算与报告 provenance，不足以校准稳定球员水平或跨联赛排名。

### OpenFootball：授权宽松，但没有球员能力统计

`football.json` 覆盖英超、德甲、西甲、意甲、法甲等赛事的 fixtures/results，并自称 CC0；最新赛季 JSON 每日生成更新，但上游 Football.TXT 暂无每日自动更新，仍依赖社区维护。数据结构是赛事、轮次、日期、主客队和比分，不是球员比赛表现。[football.json 文档、示例与更新说明](https://github.com/openfootball/football.json)

独立 `openfootball/players` 仓库列出球员姓名、粗位置、身高、出生信息；没有当前俱乐部关系、赛季出场和能力指标。[Players 仓库](https://github.com/openfootball/players)

**判断：只适合作赛程/球队/基础实体上下文，不加入推荐评分，也不替换 current roster provider。**

## 抓取边界与明确非目标

- FIFA 的世界杯球员统计网页确有进攻、传球、防守、移动、身体等赛事统计分类，但 FIFA 条款将其平台 feed、API 和 data 定义为受其知识产权控制的内容，默认只允许私人非商业访问/使用；网站展示条款不能推导出可将页面 scrape 后存入 TactiScout。无单独数据许可时不自动抓取或送入模型。[FIFA 统计页](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/statistics/player-statistics?searchOverlay=1) · [FIFA Terms §§5.1–5.3、6.2–6.4](https://legal.fifa.com/terms-of-service)
- 英超/FPL 官方条款限制未经书面许可的商业使用、复制、再利用、数据库建设和再分发；英超官方将比赛数据授权咨询指向 Football DataCo。不要因为 endpoint 可访问或统计网页可见就建立自动采集器。[英超条款](https://www.premierleague.com/en/terms-and-conditions) · [比赛数据许可联系指引](https://www.premierleague.com/en/news/102426)
- 不以“搜索引擎能看到”或“API 无 key”替代数据权利登记；不爬绕过授权的网站、CDN 或内部前端接口。Scraping 只有在目标站点的许可和服务条款明确允许自动访问、字段储存、AI/RAG 处理与公开展示后才进入 implementation。
- 不把厂商的 Elo、transfer-fit、market-value 估算当成 TactiScout 自算的原始能力指标、实际转会预算或客观推荐真值；不把 DFL 七场、Wyscout 2017/18 或其他历史样本包装成现役全球转会池；不把一次性 API smoke 说成整体覆盖已验证。

## 可执行建议

1. **当前路线：**完成已开 issue 的 Sportmonks 单队/当前赛季无模型 smoke 和用户账户覆盖核对；确保报告保留 provider、赛季和抓取时间。权利确认前不让球员统计进入 Ollama。
2. **低成本对照：**有用户自己的 PlayerElo key 后，再在一项目标联赛做低频抽样；只核对实体匹配、当前队线索、分钟样本和 Elo/EAR 缺失率。先 report-only，不混评分；公开展示/LLM 处理另行取得明确授权。
3. **能力评估展示：**可把 DFL 数据列为第二条开放 benchmark 路径，在小样本上计算带公式/样本限定的事件与跑动证据；不让它新增当代候选人。
4. **只有在想购买新的商业 feed 时：**先向 SportsDataIO 询价和问许可。请求针对一个具体联赛样本报价与数据字典，要求对方书面回答本地模型/生成式 LLM、public portfolio display、缓存、保留和合同终止后的权利；报价和答案出来前不新增 adapter。

更早的 provider 对比、TheSportsDB、Afriskaut、Reep、Wikidata、FPL 与已实现来源限制，分别见[当前球员数据源与自建路径复核](current-player-data-source-options-2026-10.md)、[新增球员与表现数据源调查](additional-player-data-options-2026-10.md)和[近期开放球员表现数据复核](recent-open-player-performance-data-2026-10.md)。
