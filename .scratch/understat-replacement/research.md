# Understat 替代数据源调研

**调研日期：2026-10-23**<br>
**范围：**只比较 Reep Coverage 当前列出的数据源；优先核实官方公布的免费额度、球员级表现字段、Reep ID 对照与使用限制。以下信息来自各提供方或 Reep 自己的页面；页面和套餐可能变化。

## 先明确要替代的字段

项目现在从本地 Understat 快照取球员、球队、联赛/赛季、分钟、进球、xG、npxG、助攻、xA、射门和关键传球。[当前读取逻辑](../../src/utils/tools.ts)

所以“替代 Understat”至少有两种含义：

1. 只找免费且稳定的球员/赛季表现数据：分钟、进球、助攻。
2. 尽量保留分析字段：还要 xG 和 xA，并希望覆盖多个联赛与赛季。

没有查到一个**公开写明免费额度、又能完整覆盖上述字段和所需赛事/赛季**的 Reep 已列数据源。尤其要注意：同名统计字段不代表不同提供方的模型定义相同；跨源比较时必须保留来源和指标定义。

## 关于 Reep：Understat 确实在覆盖表里

Reep Coverage 当前将 Understat 列在 **Bridge-only** 数据源中。也就是说，Reep 发布了部分 Understat ID 与 Reep ID 的桥接，可作为跨源连接键；它不代表每一个 Understat 球员 ID 都一定有映射，也不代表 Reep 提供 Understat 的表现数据。Reep 自己说明它不承载事件数据、xG 或战术指标。[Reep Coverage](https://www.reep.football/coverage/) · [Reep 的数据边界](https://www.reep.football/)

页面不同读取结果中 Understat 的桥接行数出现过不一致，因此本报告不把总数当成稳定指标。对项目来说更重要的是：**“Understat 未被 Reep 覆盖”这个前提不成立；它已被列出，但具体球员 ID 仍须逐个查映射。**Reep 的角色和覆盖按其发布版本变化，不能由总行数推断一个指定 ID 一定能解析。[Reep 对覆盖范围的说明](https://www.reep.football/coverage/)

## 候选对比

| Reep 已列来源 | 免费访问与公开额度 | 球员数据能否替代当前 Understat 字段 | Reep 身份关联 | 关键限制与判断 |
| --- | --- | --- | --- | --- |
| **Impect Open Data** | 静态公开数据集，不是请求计数 API；官方仓库提供完整 **Bundesliga 2023/24（306 场）**。 | 有球员逐场 KPIs、出场时长字段 `playDuration`、进球、助攻和 xG。KPI 定义还包含 `SHOT_XG_FROM_PASSES`（传球直接导致射门的 xG 总量）和 `EXPECTED_GOAL_ASSISTS`（模型估计的预期进球助攻）。可以汇总为该赛季的球员数据；需处理一名球员在不同场上位置分成多行的情况，并核实 `playDuration` 的单位。 | Reep 2026-10-19.1 发布新增 Impect，属于 Bridge-only；确切球员 ID 仍需逐条验证。 | **最适合当前求职展示版的静态基准**：字段比多数免费 API 更接近需求，也有完整单赛季和 Reep 桥接。局限是只有一个联赛/赛季，且它不是可持续更新的 API。仓库要求遵守单独的 `LICENSE.pdf` 并在研究/项目中注明 Impect、使用其 Logo；这不是标准的宽松开源数据许可，商用、再分发或长期缓存前应读完该条款。[Impect 数据集与说明](https://github.com/ImpectAPI/open-data) · [官方 KPI 定义](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/kpi_definitions.json) · [球员逐场 KPI 样例](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/player_kpis/player_kpis_122840.json) · [Reep 2026-10-19.1 发布记录](https://www.reep.football/updates/releases/2026-10-19.1/) |
| **API-Football（API-Sports）** | **免费 API：100 次/日、10 次/分钟**；所有端点可用，但免费套餐的历史赛季范围受限。官方只说覆盖“最近赛季”，没有公布固定赛季列表。 | `/players` 可按球员、联赛/球队与赛季查出场、分钟、进球、助攻等，并按赛事分组；官方字段清单未列球员 xG 或 xA。需先检查 league-season 的 `players`、`statistics_players` 等 coverage 标志，标志开启也不保证每场都有数据。 | Reep 列作 Bridge-only，当前页面有 API-Football ID 桥接。 | **最接近“免费、可持续调用”的选项，但不是完整 Understat 替代品**：缺 xG/xA，历史范围不确定，100 次/日会限制批量完整取球员名单（官方示例提到每页 20 人）。条款禁止转售数据；并说明 API 本身不授予在应用中发布数据所需的赛事/第三方权利。公开条款没有明确的缓存保留期限。[官方定价](https://www.api-football.com/pricing) · [官方限流说明](https://www.api-football.com/news/post/how-ratelimit-works) · [球员统计与赛季 coverage](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) · [服务条款](https://www.api-football.com/terms) |
| **Sportmonks** | 官方定价页确认有不需信用卡的免费层，但没有公布免费层的请求配额/联赛数；单独的免费计划页目前列出丹麦 Superliga 与苏格兰 Premiership，需在新账号里核验当前实际 entitlement。付费 Starter 公布为每实体每小时 2,000 次，不能套用于免费层。 | 玩家赛季统计包括分钟、进球、助攻、出场等。API 支持球员 xG，但当前定价页把 “xG & Pressure Index” 列为每月 €29 起的推荐 bundle；文档也说 xG 权益依套餐而异，所以不能算作免费层确定提供。Sportmonks 自己的 API 说明明确说不提供 xA。 | Reep 列作 Bridge-only；有 Sportmonks ID 桥接。 | 免费层能否覆盖项目目标联赛，和 xG 是否另购，都需要账号内验证；而 xA 确认缺失。条款允许在自有产品内存储/缓存及展示数据，但未经书面许可不可把原始 feed 当数据产品转售；供应商也不声称拥有所有赛事的官方权利。[免费层页面](https://www.sportmonks.com/football-api/free-plan/) · [当前定价、xG bundle 与请求限额](https://www.sportmonks.com/football-api/plans-pricing/) · [球员赛季统计](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/statistics/players-statistics) · [xG 套餐说明](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/expected-xg) · [不提供 xA 的说明](https://www.sportmonks.com/glossary/key-passes/) · [服务条款摘要](https://www.sportmonks.com/integrity-support/) |
| **StatsBomb Open Data** | 静态 GitHub 数据集，不是有每日/每月额度的 API。公开的是选择性赛事/赛季 JSON，包含比赛、阵容、事件及部分 360 数据。 | 事件里有球员 ID、射门结果和 `shot_statsbomb_xg`，有 `shot_key_pass_id` 可把助攻传球与射门关联；可自行汇总分钟、进球、助攻、xG。可计算“该传球所创造射门的 xG 总和”作为自定义 xA 近似值，但它不是 Open Data 提供的官方球员赛季 xA 字段，也不能视为 Understat xA。 | Reep 列作 Bridge-only，使用 `statsbomb/offline_player` 命名空间；特定 ID 是否有桥接仍需确认。 | 很适合免费分析实验，但不是宽覆盖球员赛季数据库。官方 README 将免费提供范围描述为研究和足球分析兴趣用途；公布研究需注明 StatsBomb 来源并使用 Logo。仓库有单独 User Agreement PDF，不是标准开源许可证；商业化、复制或再分发前应核对该协议/联系 StatsBomb。[官方仓库与结构/归属要求](https://github.com/hudl/open-data) · [官方事件字段样例和 player IDs](https://github.com/hudl/statsbombpy) · [User Agreement PDF](https://github.com/hudl/open-data/blob/master/LICENSE.pdf) · [Reep 命名空间说明](https://www.reep.football/get-started/) |
| **Wyscout（Hudl）** | 官方 API/数据产品需联系销售或请求 Demo；没有查到公开的免费配额。 | 官方 Player Stats/Advanced Search 提供球员比赛与时间范围指标，xG、xA、进球/助攻及按 90 分钟归一化指标均有定义；Data API 产品说明有比赛/赛季统计包。比免费候选更接近字段要求。 | Reep 将 Wyscout 列为独立来源，而非 Bridge-only；覆盖本身仍非逐球员完整保证。 | **更适合字段完整度要求高、可接受付费的情况**。未公布自助免费层或配额；应询价时确认联赛/赛季、xG/xA 产品包、API 访问、缓存期限和再分发权。[官方 Data API/产品包](https://www.hudl.com/products/wyscout/data-api) · [官方 API 文档](https://apidocs.wyscout.com/) · [xG/xA 指标定义](https://dataglossary.wyscout.com/metrics/) · [Reep Coverage](https://www.reep.football/coverage/) |
| **Opta / Stats Perform** | 商业数据服务，价格按覆盖、深度和用途配置；未找到公开免费额度。 | 官方定义了球员/球队层面的 xG 与 xA；其产品提供历史和实时数据。公开资料没有给出一个可直接注册的免费 API 配额。 | Reep 列为 Independent；覆盖与它的合并上游来源线有关。 | 高质量商业备选，不属于免费候选。需取得具体报价和数据权利；Stats Perform 发布的 Football DataCo 条款适用于相应 Football DataCo 数据，不应外推为所有 Opta 包的通用许可。具体缓存、下游展示和赛事权利以报价/合同为准。[Opta Data Feeds](https://www.statsperform.com/products/opta-data-feeds/) · [Opta xG/xA 定义](https://www.statsperform.com/ja/opta-event-definitions/) · [数据定价因素](https://www.statsperform.com/insights/how-much-does-sport-data-cost/) · [Football DataCo 条款（适用范围需核对）](https://www.statsperform.com/legal/fdcterms/) |
| **Sofascore** | 可联系 Sofascore 申请合作 API；没有找到公开 API 免费额度或开发者自助套餐。 | 官方提到给合作方开放球员 ID 和基础球员资料 API；公开页面没有足够的 API 字段承诺，无法确认它提供符合目标的球员赛季 xG/xA。 | Reep 列作 Bridge-only。 | 不应以网页抓取或非官方端点当免费 API：服务条款禁止未获同意的抓取、聚合、复制和实质性数据库提取。合作 API 的价格、可取字段、缓存和展示权需直接确认。[官方合作 API 说明](https://www.sofascore.com/news/sofascore-player-id-explained-every-players-unique-number) · [服务条款](https://www.sofascore.com/de/terms-and-conditions) |
| **FBref（Reep 中的 FBref / FBref DSG-era IDs）** | 网站页面可浏览，但没有公开的官方开发者 API 免费配额。 | 过去的页面曾展示 Opta xG/xA；Sports Reference 2026 年 1 月公告称因数据供应商终止数据授权，已从 FBref/Stathead 删除该高级数据。不能把历史页面快照当作当前字段承诺。 | Reep 仍有历史 FBref/DSG-era ID 桥接；它只是身份键，不是当前数据授权。 | 不建议作为 Agent 取数源。Sports Reference 条款限制未经许可的大规模自动访问、建立竞争性数据存储，以及把数据用于 AI 提示/生成。其当前高级足球数据亦已撤下。[官方数据变更公告](https://www.sports-reference.com/blog/2026/01/fbref-stathead-data-update/) · [数据使用条款](https://www.sports-reference.com/data_use.html) · [Reep Coverage](https://www.reep.football/coverage/) |

## 免费配额与字段的结论

| 目标 | 最符合的选择 | 缺口 |
| --- | --- | --- |
| 免费且能运行时查常见联赛球员分钟/进球/助攻 | API-Football | 100 次/日；历史范围只说明近期；官方玩家字段未列 xG/xA。 |
| 免费静态数据做完整球员赛季指标 Demo | **Impect Open Data** | 仅 Bundesliga 2023/24；每场玩家统计要自行汇总；自定义许可不是宽松开源授权。 |
| 免费事件数据自行实现指标/比较模型 | StatsBomb Open Data | 赛季/赛事选择性覆盖；没有现成球员赛季表；xA 要自行定义，许可偏研究用途。 |
| 免费尝试传统玩家统计 | Sportmonks 免费层 | 定价页未写免费 API 次数/联赛配额；免费计划页列有两个联赛但要注册确认；xG 当前被列为 €29/月起的 bundle；无 xA。 |
| 同时需要广覆盖与 xG/xA 的专业数据 | Wyscout 或 Opta | 付费/合同；报价、缓存、再分发和赛事权利需确认。 |

## 推荐

若目标是**先把项目里的性能数据能力做得可演示、且不付 API 费**：先拿 **Impect Open Data** 做固定数据集实验。它是本次核实中最贴近“球员逐场→球员赛季汇总”的免费选择：官方提供 2023/24 Bundesliga 全赛季的逐场 player KPIs，包含 play duration、进球、助攻、shot xG 和 expected-goal-assist 相关指标；再按 Reep 的 Impect ID 映射检查有多少球员能稳定合并到 FM/其他来源。[Impect 仓库](https://github.com/ImpectAPI/open-data) · [KPI 词典](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/kpi_definitions.json)

若目标是**让用户输入球员后实时查询多个常见联赛**：API-Football 是公开免费额度最清晰的入门候选，但它不能保留当前 xG/xA 能力；可把 xG/xA 标成缺失，不应悄悄用空值或别家指标填充。Sportmonks 的免费联赛不是项目的核心覆盖，并且 xG/free entitlement 文档存在套餐依赖，当前不适合作为明确承诺。

若目标是**多个联赛/赛季 + xG + xA 的完整生产替代**：当前找到的候选都没有公开的全字段免费配额。Wyscout 的官方指标最明确接近需求，Opta 是高端商业基准；继续比较前应先取书面报价、试用授权、缓存保留和用户展示条款。

## 落地前需要验证的三件事

1. **Reep 实例级覆盖**：对实际结果里的 `(provider, namespace, external_id)` 逐一查映射，不以 Reep 的总桥接数推断一个人已覆盖。尤其 Understat 虽然在 Coverage 列表中，单个 Understat ID 仍可能缺 bridge。
2. **数据模型分开存来源与指标定义**：例如 `expected_goals`、`expected_goal_assists`、`shot_xg_from_passes` 都要附 `provider`、`metric_definition`、`competition`、`season`；不要把不同提供方的 xG/xA 当作完全相同的数值。
3. **授权与持久化**：写入本地 SQLite 之前先确认每个来源能否缓存、可保留多久、可否用于远程模型处理、是否可展示/导出。API 免费不等于数据可再发布；静态 JSON 可下载也不等于可以随应用仓库再分发。
