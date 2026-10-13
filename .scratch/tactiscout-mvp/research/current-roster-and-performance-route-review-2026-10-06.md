# 现役候选池与可观测表现指标路线复核

核查日期：2026-10-06。目的：在无需付费订阅、尽量少凭据的情况下，判断下一条能进入 TactiScout 技术验证的“当前球员范围 + 表现指标”路线。仅查看公开文档、发布者页面、公开源码目录和搜索索引；没有注册账号、申请 key、调用球员数据接口、下载或保存球员数据，也没有修改代码。

## 结论

**下一步最值得做的是用一把免费 OpenScores key 完成小范围 live schema smoke，但先把它视为“候选池来源验证”，不要预设它也有足够的球员能力指标。** OpenScores 是本轮找到的最低集成摩擦候选：官方提供免费只读 MCP/REST、覆盖英超及其他四大欧洲联赛、允许在应用/Agent 中使用并缓存；`get_team` 文档标明返回当前赛季阵容，`get_player` 标明返回职业汇总和近期出场。它的页面称每日摄取，但并未公开 squad、player-stat 的完整输出 schema、字段定义、单联赛完整率、年龄字段或逐字段更新时间。因此 smoke 必须验证同一球员 ID 能否从 squad 延续到 player/recent appearances，以及实际有哪些有用数值，不应把“支持球员统计”当作指标充分的证明。[OpenScores docs](https://openscores.ai/docs) · [FAQ](https://openscores.ai/faq) · [terms](https://openscores.ai/terms)

**英超官方 Stats Centre 是表现字段最扎实的免 key 页面路线，但不是现成的球员数据库接口。** 页面展示 2026/27 当季排名；官方解释页列出分钟、射门、传球、关键传球、抢断、拦截、解围、空中对抗等传统比赛指标，xG 从 2012/13 起可用，数据由 Opta 采集。公开资料没有给出可供第三方使用的官方 API/schema，也没有证明排行榜页面涵盖所有当前注册球员。它可作为用户明确愿意尝试网页抓取时的 **英超限定技术实验**，但完整球员候选覆盖、页面结构稳定性和来源授权都还需要分开验证。[官方 Stats Centre](https://www.premierleague.com/en/stats?co=1&se=578) · [官方字段解释](https://www.premierleague.com/en/stats/clarification)

**FPL JSON 是技术上诱人的免 key 快照，却不应成为自动抓取主链路。** 社区文档记录了官方站点的 `/api/bootstrap-static/`、`/api/element-summary/{id}/` 等端点与球员 ID/球队/位置/FPL 赛季统计，但 Premier League 没有发布该 API 的正式 schema；2026/27 FPL 条款明确禁止自动系统访问游戏并提取信息。即使只考虑技术，FPL 玩家集合和 points/ICT/xG 等游戏指标也不是完整的俱乐部注册名单或战术能力画像。[非官方 FPL API 参考（2026/27）](https://github.com/jakesmith1997-sfc/fpl-api) · [2026/27 FPL terms](https://fantasy.premierleague.com/help/terms)

**SofaScore 不应作为本次自动抓取路线。** 公开网页可见赛果和统计，但本次没有找到 SofaScore 发布的第三方公共 API/schema；其官方条款限制 scraping、aggregation、复制和数据库重要部分抽取。尽管抓取技术未必困难，隐藏接口/网页调用的稳定性、玩家/赛季覆盖和可重复性都不符合本项目要做成可审查数据产品的要求。[SofaScore terms](https://www.sofascore.com/terms-and-conditions)

## 来源对比

| 来源 | 候选池 / 赛季覆盖 | 能力指标与身份字段 | 更新 / 凭据 | 产品与工程判断 |
|---|---|---|---|---|
| **OpenScores MCP/REST** | 官方 FAQ 声称涵盖英超、西甲、意甲、德甲、法甲和 2026 世界杯。`get_team` 描述含“current-season squad”；6 月 changelog 说明该 squad 是“roster ∪ appearances”，不只已出场者。MCP catalog 没有 `list_teams`：需要从联赛/赛季、赛程或已知俱乐部目录组织球队，再逐队读取 roster。 | 文档列 `get_player` 为 profile、teams played、career aggregates、recent appearances；`get_fixture` 有 lineups、event timeline、statistics。没有公开球员行 JSON schema、完整字段定义或指标口径。工具参数示例用 team/player ID；尚未说明 namespace、稳定性或跨源 ID crosswalk。`search_players` 只按姓名查询，可选 nationality/position，不是全员列举端点。 | 免费；需注册并创建一把 Bearer key（官方提供 REST 和 MCP，推荐 API key）；FAQ 默认 60 次/分钟、2,000 次/小时。FAQ 称每日 ingest，不是逐分钟 live。页面和 changelog 仅标注 2026-06-12 更新，未给出 2026/27 某联赛逐项刷新时间或 SLA。 | 条款允许产品、Agent、内部工具和研究用途，允许应用内缓存/变换；不允许转售原始数据集。技术优点是官方支持当前 roster 且可被 Agent 直接调用。关键未决项是实际响应字段是否足够、全联赛名单需要多少调用、上游从 Sofascore/Flashscore 摄取的来源授权链和每项球员记录的新鲜度。**第一优先 smoke；当前不是已验证正式来源。** |
| **Premier League Stats Centre** | 官方网页可选择 2026/27 赛季与球员统计分类，并呈现当前赛季排名；页面未证明名单包含所有注册/未出场球员，排名/leaderboard 可能只返回有统计值的玩家。 | 官方解释页涵盖分钟、射门、射正、传球、关键传球、长传、直塞、传中、抢断、抢断成功率、封堵、拦截、解围、空中对抗等；xG 从 2012/13 可用。数据由 Opta / Stats Perform 收集分析。所查公开页面未给出可依赖的球员 master schema、稳定 ID、DOB 或批量 API。 | 页面公开可访问；没有 key。页面随当季比赛更新，但没有公开机器接口更新 SLA；没有对爬取/结构化快照稳定性的承诺。 | Premier League 网站条款称 Rights 由 PL 和供应商持有；除合理私人使用外，未经书面批准不得复用/再分发或创建包含从网站取得材料的数据库。用户已允许探索爬取，因此可以作为**低请求、EPL-only 技术原型**考察页面是否足以导出排名数据；但工程上排行榜覆盖不等同候选池、HTML schema 未承诺稳定、source/player ID join 未验证。条款是风险之一，另有覆盖与 schema 的独立技术缺口。[Terms](https://www.premierleague.com/en/terms-and-conditions) |
| **Fantasy Premier League 公共 JSON** | 常见公开端点 `/api/bootstrap-static/` 列当前游戏玩家、球队、事件；`element-summary/{id}` 列单玩家本赛季历史。社区说明这些只读端点无需认证，但并非 PL 正式 API 产品或公开 schema。FPL 玩家集并不等于完整俱乐部注册名单。 | 社区记录的常见字段含 FPL player ID、球队/游戏位置、分钟、进球、助攻、射门与预期进球/助攻、ICT、积分、游戏状态/价格等。适合游戏表现维度，不提供完整战术表现解释；年龄/DOB schema 在官方文档中未证实。 | 技术上社区可匿名 GET；官方 API 更新频率、配额和 schema 稳定性未承诺。 | 2026/27 FPL 条款明确禁止“use automated systems to access the Game and extract information”，并声明 Game data 的 IP 属于 PL。即使可匿名访问，也不符合自动 Agent/数据仓库路线；不建议接入。|
| **SofaScore 公共网页 / 未公开 API** | 官方面向用户的网页提供多赛事结果与统计；未找到官方面向开发者发布的当前 roster API/schema 或公开的数据字典。 | 网页和 App 有球员统计；未能依据官方开发者 schema 确认 player/season 字段、覆盖范围、ID crosswalk 或稳定更新契约。 | 用户网页可查看；本次未找到免 key 的受支持开发者数据接口。 | 官方条款将其作为个人使用平台；限制未经同意的抓取/聚合/复制，禁止未经同意抽取或公开数据库重要部分。不要依赖私有移动端/网页接口。可作为人工核对界面，非自动数据管线。 |
| **ASA / itscalledsoccer（近季替代，MLS）** | 官方 API wrapper/repo 覆盖 MLS 等北美联赛；2026 MLS 赛季接口有实时/当季表现行。官方 roster profile 最新在 repo 的 2026-02-27 release，`release_date` 为 2026-02-26，不足以证明 10 月当前注册名单。 | 本项目先前核实的官方接口包括 2026 MLS `xgoals`、`xpass`、`goals-added`；表现层比 FPL 有更直接的 xG、传球预期、Goals Added 证据。player/team ID 和 minutes 可连接同源表现行；不是欧洲主要联赛候选池。 | 官方 wrapper 描述 API 免费公开、无认证；具体更新/SLA 未给出。 | 若将演示联赛收窄到 MLS，它是本轮数据指标上较强、免 key 的近季备用路线；不能解决拜仁/巴萨/英超需求，也未核实其数据在公开作品集中的保存、显示、LLM/RAG 权限。已有复核详见 [current-season-player-source-path](current-season-player-source-path-2026-10-06.md) 和 [open-data-tracking-and-current-repositories](open-data-tracking-and-current-repositories-2026-10.md)。 |

## 建议的可执行决策

### A. 先把 OpenScores 验成当前球员池候选

沿用 issue 73 已有的“本地限量 smoke”原则，但下一次 live 验收需要把范围从 squad 字段存在性扩到至少一个球员的表现 schema：

1. 操作者本地创建一把免费的 OpenScores key；key 留在本地环境，不提交、不写入报告。
2. 最多 4 次顺序 MCP 调用：`tools/list`、按精确俱乐部名 `search_teams`、对唯一 team ID 调 `get_team`、从 roster 取一个 provider player ID 调 `get_player`。这能核验从球队 roster 到 player profile/recent appearances 的 ID 连续性。
3. 只输出 league/season/team 标识、roster 总数、各 allowlist 字段非空覆盖数、出现的赛季/比赛时间范围、profile ID 一致性；不保留或打印球员样例、原始响应或单项值。无模型、无数据库、无浏览器存储。
4. 评估一组指标是否能对应能力维度：minutes、goals/assists 只能说明上场和产出；若没有传球/推进/防守等可观测指标，OpenScores 暂只登记为 current-pool provider，不进入能力评分。
5. 若单队 smoke 通过，再用目标联赛的球队清单估算 roster 查询量和数据缺失；记录每个队读取成功/失败/零名单/字段缺失。`search_teams` 是全库文本搜索，不要把它当联赛过滤器；来源失败和空名单仍需分开。

公开 docs 对 OpenScores 使用 Agent 和 app caching 给出明确支持；上游抓取数据的授权链和数据质量无 SLA，另作为来源风险在 UI/报告披露，而不是混同于接口 schema smoke 结论。

### B. 指标不够时有两个不同方向

- **目标联赛必须是 EPL：**为官方 Stats Centre 做一份隔离的、低频、页面级 HTML 技术原型，观察公开排行页是否能稳定拿到完整分页、赛季、统计名、player/team 官方页面 ID。不要改用隐藏 FPL/SofaScore endpoint。需要严格显示这只是页面抓取观测，不是受支持 API；若页面仅返 top-N 或指标分页无法完整拉取，立即止步。公开作品集展示/存储之前另行记录用户已知的 PL 条款风险和项目可见范围。
- **可以把第一条近季能力评估限定为 MLS：**对 ASA 2026 赛季做一次同源 roster/metric coverage 对照，利用 xG/xPass/Goals Added 等表现字段构建近季能力证据，但先核对 roster release 的时效及 LLM、公开展示和留存边界。它不能宣称是拜仁/巴萨的候选市场。

## 供后续产品与数据模型采用的边界

- `OpenScores` 的 current-season squad 可作为候选池来源，但其“top-5 coverage”是服务目录覆盖，**不是每个俱乐部名单完整率或当前转会市场覆盖证明**。
- OpenScores 的每日 ingest 声明只支持“日级刷新预期”，没有球队或球员记录级 `updated_at` 的公开 schema；未来报告应记录请求时间与 API 公布的赛季字段，未返回则显示未知。
- provider player ID 只在同一个 provider namespace 内使用。不要按姓名将 OpenScores 与 PL/ASA/StatsBomb/Wyscout 自动合并；若以后需要合并，须构建人工或官方 ID crosswalk 并保留出处。
- 先区分“当前 roster”“本赛季已出场球员”“球员近期比赛表现”和“赛季汇总”。不得从射手榜或 FPL 玩家列表推断完整注册名单。
- TactiScout 的报告应列每个指标实际来源和赛季/比赛样本；拿不到渐进传球、带球、压迫或夺回球等字段时，将对应能力标为数据缺口，不以评分、积分或邻近指标替代。
- 现有 issue 73 的 smoke 验收仅检查单队 current-squad field 与字段存在性；它不能证明有足够的表现指标，也没有做 2026/27 的 live 覆盖验证。建议把下一条 task 定义为“OpenScores one-player profile/stat-schema live smoke”，与正式 provider integration 分开。

## 一手来源

- Premier League：[2026/27 Stats Centre](https://www.premierleague.com/en/stats?co=1&se=578) · [Player & Club Statistics, Stats Explained](https://www.premierleague.com/en/stats/clarification) · [Terms of Use](https://www.premierleague.com/en/terms-and-conditions)
- Fantasy Premier League：[2026/27 Terms & Conditions](https://fantasy.premierleague.com/help/terms)。端点和字段形状目前只能引用社区维护的非官方 catalog：[FPL API 2026/27 reference](https://github.com/jakesmith1997-sfc/fpl-api)；该 catalog 不是数据授权或 PL 发布的正式 API 文档。
- SofaScore：[Terms & Conditions](https://www.sofascore.com/terms-and-conditions)
- OpenScores：[MCP/API docs](https://openscores.ai/docs) · [FAQ / leagues, cadence and rate limits](https://openscores.ai/faq) · [terms](https://openscores.ai/terms) · [changelog / squad union, upstream sources and ingest](https://openscores.ai/changelog) · [examples](https://openscores.ai/examples)
- ASA：[official itscalledsoccer repository](https://github.com/American-Soccer-Analysis/itscalledsoccer) · [2026 MLS xGoals API](https://app.americansocceranalysis.com/api/v1/mls/players/xgoals?season_name=2026) · [2026 MLS xPass API](https://app.americansocceranalysis.com/api/v1/mls/players/xpass?season_name=2026) · [2026 MLS Goals Added API](https://app.americansocceranalysis.com/api/v1/mls/players/goals-added?season_name=2026&above_replacement=true) · [MLS roster profile repository](https://github.com/American-Soccer-Analysis/mls-roster-profiles)

## 对当前方向的回答

如果目标仍是“尽快让 Agent 能找到现役候选，并在 LangGraph 中根据指标缺口继续调用工具”，**下一步不是直接把 FPL 或 SofaScore scraper 塞进工具列表；而是取得一把免费的 OpenScores key，做最多四次调用的 squad-to-player-schema smoke。**它是目前最接近当前候选池、许可文字也支持 Agent/app cache 的方向。若 smoke 表明 player endpoint 只有身份/进球汇总，就把 OpenScores 限定为候选池并测试一个独立表现数据源：首选是隔离的 EPL 官方 Stats 页面原型（若接受页面脆弱性与使用条款风险），或 MLS 范围的 ASA 表现链路。任何一个路径均须实际验证覆盖和 ID 链接后，才能声称 current candidates 与 measured performance 在同案端到端可用。
# ASA 2026 MLS follow-up audit (2026-10-06)

This follow-up verified the official ASA API response shape against bounded, read-only requests. ASA's first-party JavaScript wrapper documents `getPlayersXgoals`, `getPlayersXpass`, `getPlayersGoalsAdded`, player/team entity lookup by exact IDs, and the `seasonName`, `splitBySeasons`, `splitByTeams`, and `minimumMinutes` parameters: [wrapper README](https://github.com/American-Soccer-Analysis/itscalledsoccer-js) · [wrapper implementation](https://github.com/American-Soccer-Analysis/itscalledsoccer-js/blob/main/src/index.ts). The official API reference lists a 1,000-row response cap and the g+ action types `Dribbling`, `Fouling`, `Interrupting`, `Passing`, `Receiving`, and `Shooting`: [API reference](https://american-soccer-analysis.github.io/itscalledsoccer/reference/).

For requests to `/api/v1/mls/players/{xgoals,xpass,goals-added}` with `season_name=2026`, `split_by_seasons=true`, `split_by_teams=true`, and `minimum_minutes=0`, the live responses on 2026-10-06 contained respectively 889, 889, and 833 player-team rows. Every response contained only season `2026`; each had 30 team IDs, unique player-team keys, and no missing player/team IDs. Player ID entity lookup returned the exact requested ID and fields including `player_name`, `birth_date`, `primary_broad_position`, `primary_general_position`, and `season_name`; exact team lookup resolved the 30 current MLS clubs. The three stat endpoints expose different field sets; g+ nests source action rows with `goals_added_raw`, `goals_added_above_avg`, and `count_actions`. No raw player names or metric values were written by the audit.

An earlier unsplit request returned 66 team IDs, of which only 30 resolved against the current team directory. Therefore both split flags are mandatory and the adapter must join on `(player_id, team_id, season_name)` only. The API rows give a current-season aggregate, not a guaranteed match-by-match freshness timestamp or a registered-roster/transfer-availability list. Do not label retrieval time as the provider's update time. ASA's app describes its summary-level data as downloadable, and asks users to credit and link to ASA: [official app repository README](https://github.com/American-Soccer-Analysis/asa-shiny-app#attribution). This is an attribution request, not a separately verified data licence.

ASA describes g+ as a measure of a player's total on-ball contribution in attack and defense, using goals as the common unit: [official g+ overview](https://www.americansocceranalysis.com/what-are-goals-added) · [methodology](https://www.americansocceranalysis.com/home/2020/5/4/goals-added-deep-dive-methodology). The six action-specific values and aggregate can enrich reports, but they are not a club-fit label. xGoals fields include `xgoals`, `xassists`, `shots`, `key_passes`, and `minutes_played`; xPass fields include attempted passes, completion percentages, passes completed over expected, and `count_games`. Interpret each within ASA's model and the 2026 MLS competition scope.
