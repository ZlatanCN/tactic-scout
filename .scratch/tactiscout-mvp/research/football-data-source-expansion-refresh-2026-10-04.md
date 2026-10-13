# TactiScout 数据源扩展复核（2026-10-04 更新版）

核查日期：2026-10-04；本次复核特别复查 issue 39、48、20、36，并按用户扩大数据源范围的决定补查可本地获取的开放数据。目标是选出能支撑简历展示的真实球员发现与能力评估链路；优先查数据拥有方/服务方的一手文档、API、定价和条款。这里区分“官方页面明确写明”“据现有材料的工程判断”“还要账号或书面确认”。没有使用账户密钥、运行真实 API 请求或保存额外球员数据。价格、覆盖和条款后续可能变化；本文件不是法律意见。

## 最新结论（本轮追加复核）

**最值得立即用于无账号本地开发的来源组合，是 SkillCorner Open Data 的 2024/25 A-League 球员赛季聚合 + Reep v1 当前离线身份 crosswalk；OpenFootball 2026/27 只补充当前赛程/赛果上下文。**它是一个有明确边界的样本工作台，不是完整现役转会市场。SkillCorner 聚合表给出具名球员、球队、粗位置、分钟和身体/传球/无球跑动指标；Reep 可将 `skillcorner/player` 的精确来源 ID 接到稳定身份和其他已发布 provider ID。两边都可直接下载，不需 API key。OpenFootball 提供最新赛季的比赛与队名，不含球员名单或球员能力指标。[SkillCorner README 与聚合字段](https://github.com/SkillCorner/opendata/blob/master/README.md) · [SkillCorner 聚合目录](https://github.com/SkillCorner/opendata/tree/master/data/aggregates) · [Reep 当前 release](https://reep.football/data/) · [OpenFootball README](https://github.com/openfootball/football.json/blob/master/README.md)

**这条链路只能产出“在 2024/25 A-League 赛季达到 SkillCorner 数据门槛的已观察球员表现”，不能称为当前 roster。**SkillCorner README 说其聚合只纳入超过 60 分钟的表现；赛季是 2024/25，不是 2026/27。它的 README 仍称 tracking/dynamic events 有 10 场，但本次核对到的 `data/matches/` 目录与 `matches.json` 当前都列出 20 场。应将“README 数字落后于仓库数据索引”作为数据质量现象保留，导入时按固定 commit、索引与实际文件 manifest 做一致性检查。[SkillCorner README](https://github.com/SkillCorner/opendata/blob/master/README.md) · [当前比赛目录](https://github.com/SkillCorner/opendata/tree/master/data/matches) · [当前 matches.json](https://github.com/SkillCorner/opendata/blob/master/data/matches.json)

**权限边界：SkillCorner 仓库页面标注 MIT、README 称数据由 SkillCorner 与 PySport open-sourced 并请求 credit，但仓库没有单独的数据许可说明，也没找到明确允许将实名指标喂给本地 Ollama、长期保存或公开逐球员展示的文字。**所以这份来源可作为 schema、确定性指标和 LangGraph 证据流程的本地研究候选；在许可范围澄清前，默认不让 SkillCorner 原始数据进入 LLM/RAG/checkpoint，不公开原始行或逐球员报告。若要现在验证 LLM 报告链，应单独使用已有 Wyscout Figshare 数据，并继续保留 CC BY 4.0 署名和赛季/来源标记；其样本仍是 2017/18 历史数据。[SkillCorner README](https://github.com/SkillCorner/opendata/blob/master/README.md) · [SkillCorner MIT 文件](https://github.com/SkillCorner/opendata/blob/master/LICENSE) · [Wyscout Figshare Players](https://figshare.com/articles/dataset/Players/7765196) · [Wyscout Figshare Events](https://figshare.com/articles/dataset/Events/7770599) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

**Reep 结论要按版本拆开：旧 v0 API/CSV 已冻结，不应作为持续更新源；当前 v1 是 2026-10-03 的 `public-bridge-register-v2` release，公开下载 769 MB、含 2,010,106 entities 与 9,033,344 bridges，官方称每周切版、无需 key，数据包按 CC0 发布。**它是有价值的身份连接层，不是权威 roster 或表现库；`skillcorner` 在 coverage 中为 bridge-only，Wikidata 是单独的 overlay 而不是 canonical bridge，官方也说 provider 覆盖逐赛事累积、不保证全部覆盖。Reep 中的 `Football Manager` provider ID 是身份映射，不代表包含 FM 游戏数据库里的能力属性。[Reep v1 Data/下载](https://reep.football/data/) · [Reep Coverage/角色](https://reep.football/coverage/) · [Reep v0 冻结说明](https://github.com/withqwerty/reep/blob/main/CHANGELOG.md)

**本次没有找到无需账号/付费、近期持续更新、覆盖主要联赛现役球员、具有细粒度真实比赛能力指标、并明确允许本地 AI 处理与公开展示的开放来源组合。**如果产品下一阶段必须回答“给拜仁找凯恩替代者”，开放数据链不能诚实支持该问题的当前阵容与能力排序；LangGraph 应把可用来源范围作为证据状态，询问是否接受 A-League 2024/25 历史样本，或停止并说明当前数据覆盖不足。当前付费/账户依赖的 Sportmonks 主候选思路仍是单独的备选路线；它不属于本任务的零账号开放源链。[Sportmonks 免费计划](https://www.sportmonks.com/football-api/free-plan/) · [Sportmonks 条款](https://www.sportmonks.com/terms-of-service/)

### 来源对比与下一步边界

| 来源 | 身份 / roster / 指标 | 覆盖与更新时间 | 访问和复用边界 | 工程判断 |
| --- | --- | --- | --- | --- |
| **SkillCorner Open Data** | 2024/25 A-League player-season CSV 中有 `player_id`、姓名、球队、粗位置、分钟；Physical、Passing、Off-Ball Runs 指标含高强度跑、加速、line-break / to-run 传球、behind/overlap/underlap 等跑位维度。另有比赛阵容/上场时间、tracking、dynamic events、phases。聚合筛掉低于 60 分钟的表现；tracking README 自报球员身份约 97% 准确且提醒有误点。[README](https://github.com/SkillCorner/opendata/blob/master/README.md) · [Physical CSV](https://github.com/SkillCorner/opendata/blob/master/data/aggregates/aus1league_physicalaggregates_20242025.csv) · [Passing CSV](https://github.com/SkillCorner/opendata/blob/master/data/aggregates/aus1league_passingaggregates_20242025.csv) · [OBR CSV](https://github.com/SkillCorner/opendata/blob/master/data/aggregates/aus1league_obraggregates_20242025.csv) | 公开数据只是一项联赛的一个历史赛季；README 自述 10 场，但当前 `matches/` 与 match index 有 20 场。聚合 CSV 约 400 条数据行；不是完整注册名单，也不是 2025/26 或 2026/27 更新源。[比赛目录](https://github.com/SkillCorner/opendata/tree/master/data/matches) · [比赛索引](https://github.com/SkillCorner/opendata/blob/master/data/matches.json) | GitHub 标注 MIT，README 称数据 open-sourced 且请求署名；MIT 文本称许可对象为 “Software”，未找到单独的数据许可或本地 LLM、embedding、公开逐球员展示/再分发的明确约定。按保守边界只做本地 schema/确定性分析验证；模型与公开展示默认关。[README](https://github.com/SkillCorner/opendata/blob/master/README.md) · [LICENSE](https://github.com/SkillCorner/opendata/blob/master/LICENSE) | **无 key、战术维度最丰富的本地开发样本。**可作为 A-League 2024/25 bounded dataset adapter / evidence loop 的候选；不可被叫作现役全球 shortlist。使用前先 pin commit，核实数据行数、身份命中、分钟门槛、指标定义与字段覆盖。 |
| **Reep v1 离线 register** | 角色是稳定 Reep ID 与 provider ID crosswalk；可以按 `(provider, namespace, external_id)` 进行精确连接。包含 affiliations/team-season participation，但官方说明 `squad`、`lineup` edges 尚在 roadmap；不提供球员赛季能力数据。[Data](https://reep.football/data/) · [Get started / namespaces](https://reep.football/get-started/) | 2026-10-03 当前发布版本：约 2.01M entities、9.03M bridges、769 MB；按周发布，下载是固定 dated snapshot。[Data](https://reep.football/data/) · [Coverage](https://reep.football/coverage/) | 离线 bundle 无需账户/key；整份公开 release CC0。但 Reep 明言 CC0 只覆盖 Reep 能授予的权利，不会授予第三方上游数据权利；按 courtesy 可标出 release stamp。[License](https://reep.football/data/) | **首选身份层，不是候选发现/数据能力来源。**只连唯一、精确 provider ID；原样保留 namespace、release、redirects、rung 和 unmatched；不要用 Reep 名称自动补齐，亦不要把 overlay 当成独立佐证。 |
| **OpenFootball `football.json`** | 联赛赛程/赛果、轮次、比赛日期、队名；无球员、阵容、出场分钟或表现指标。[README / schema example](https://github.com/openfootball/football.json/blob/master/README.md) | 2026 与 2026/27 文件由 GitHub Action 每天 05:00 UTC 从 Football.TXT 重新生成；上游 TXT 本身目前没有 daily auto-update，数据更新依赖贡献者。[README](https://github.com/openfootball/football.json/blob/master/README.md) | 无需 key。Repo 采用 CC0；免责声明也保留第三方权利范围的不确定性。GitHub 的每日 JSON 构建不能证明上游事实每日变更。[License](https://github.com/openfootball/football.json/blob/master/LICENSE.md) | **适合作当前赛事/俱乐部名称上下文；不适合作当前阵容或候选来源。**不要用同名球队去连玩家行；需要独立验证稳定队伍 ID 和赛季映射。 |
| **Wyscout Open Data / Figshare** | 具名 2017/18 五大联赛事件、阵容与历史 player/team IDs；支持可复算的传球、射门、对抗等有球事件摘要，不是 tracking、不含当前表现。[论文](https://doi.org/10.1038/s41597-019-0247-7) · [Figshare Collection](https://figshare.com/collections/Soccer_match_event_dataset/4415000) | 固定历史赛季，无后续更新；本地已存在 2017/18 快照与 Reep bridge 研究。 | Figshare 条目标 CC BY 4.0，可本机复用并做署名改编；不得暗示许可方背书，其他人像/隐私等权利不由 CC BY 自动解决。[Players](https://figshare.com/articles/dataset/Players/7765196) · [Events](https://figshare.com/articles/dataset/Events/7770599) · [CC BY](https://creativecommons.org/licenses/by/4.0/) | **适合立刻验证含 LLM 的可解释历史证据链，不适合称为当前球探名单。**报告中将赛季年份和事件口径固定显示；不允许旧 `currentTeamId` 被解释为今天的效力关系。 |
| **Wikidata** | CC0 结构化事实中含 P54（效力/团队）与 P413（位置）声明，可作别名/身份发现线索；不是权威注册名册。声明可以带 references/qualifiers，但球员效力会过期或缺失。[Data access](https://www.wikidata.org/wiki/Help:Data_access) · [Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing) · [P413](https://www.wikidata.org/wiki/Property:P413) | 社区编辑，提供 API/SPARQL 与数据转储；并非具备完整性/新鲜度 SLA 的阵容源。 | 结构化数据 CC0；仍需遵守 API 使用指南/节流，属性内容质量与许可是不同问题。[Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing) · [Data access](https://www.wikidata.org/wiki/Help:Data_access) | **只做辅助 identity clue，不把 P54 的当前任职声明当成能直接筛球员的 live roster。**优先 Reep 的非-overlay bridges；姓名匹配不自动合并。 |

### 本机快照的实测身份命中

工作区已经有一个 gitignored SkillCorner 聚合快照和 Reep 身份索引，因而无需创建账户或另存球员数据，就能检查这条来源链的实际缺口。`provenance.json` 将三个 CSV 固定到 SkillCorner 上游 commit `4340d274572876239c154c90bc507a9b3250a656`，获取时间为 `2026-10-04T09:06:06Z`；本机 Reep SQLite 索引记录 release stamp `20261003T052950Z`。这只是已有静态文件间的精确字符串 ID join，不是 live API、Reep 全量线上 coverage 或身份正确率测试。

| 文件族 | CSV 行数 | 不同 SkillCorner `player_id` | Reep 本机索引唯一解析数 | 唯一 ID 命中率 | 可解析 CSV 行数 / 行命中率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Off-Ball Runs | 407 | 284 | 175 | 61.6% | 261 / 64.1% |
| Passing | 407 | 284 | 175 | 61.6% | 261 / 64.1% |
| Physical | 406 | 268 | 167 | 62.3% | 259 / 63.8% |

计数只接受本机 `skillcorner/player` bridge 中 `redirect_status=resolved` 且 `upstream_status` 为空或 `active` 的唯一 canonical identity；本次样本没有出现多个 canonical identity 歧义。其余 ID 维持 SkillCorner 自己的 source identity，不能通过姓名兜底或悄悄丢掉。Reep 将 SkillCorner 定为 bridge-only，所以命中能连接 ID，不构成独立身份佐证。来源内记录也不能只用 `player_id` 合并：实际 CSV 同一球员/球队/赛事版次/赛季出现多个 `position_group` 行；可复现行键至少应包含 `(provider, player_id, competition_edition_id, season_id, team_id, position_group, metric_family)`，并保留来源原始值。[Reep Coverage](https://reep.football/coverage/) · [SkillCorner OBR 列](https://github.com/SkillCorner/opendata/blob/master/data/aggregates/aus1league_obraggregates_20242025.csv) · [Passing 列](https://github.com/SkillCorner/opendata/blob/master/data/aggregates/aus1league_passingaggregates_20242025.csv) · [Physical 列](https://github.com/SkillCorner/opendata/blob/master/data/aggregates/aus1league_physicalaggregates_20242025.csv)

聚合字段含 `player_birthdate`，但 Reep 当前公开身份 schema 不含 DOB；DOB 的来源许可在 SkillCorner 数据条款未明前也不应默认沿用。即使后续确认能用，2024/25 样本的年龄也应按比赛/赛季日期计算并标历史日期，不能当作当前年龄。`*_p30tip` 等后缀要保留原始来源口径；SkillCorner README 链接到官方 Physical Data Glossary，但该页面本次检查超时，因此不得自行改写成 per-90，也不与其他数据源同名指标直接合并。[SkillCorner README](https://github.com/SkillCorner/opendata/blob/master/README.md) · [Reep 2026-10-03 schema](https://data.reep.football/releases/20261003T052950Z/schema.json)

### 对 issues 39 / 48 / 20 / 36 的影响（不变更 issue）

- **Issue 39：**Reep + SkillCorner 能支撑本地历史样本的分层证据与身份解析，但它不构成“当前候选源”；Reep 精确桥接覆盖率也只有本机样本的约 62%（按不同来源 player ID 计），未映射者不能姓名兜底。其“至少一条当前候选路径端到端运行”的 acceptance 仍未满足。OpenFootball 只能补当前赛程/赛果上下文。
- **Issues 20 / 48：**Sportmonks adapter 与 bounded smoke 仍是另一条在线源路径；真实账号和目标 season entitlement 未验证，本轮不建账号、不调用 API。免费方案只覆盖丹麦与苏格兰；若不希望依赖付费/凭据，这不改变开放本地样本建议，也不能假称 Bayern/Barcelona 可搜。[Sportmonks 免费计划](https://www.sportmonks.com/football-api/free-plan/) · [服务条款](https://www.sportmonks.com/terms-of-service/)
- **Issue 36：**FBref 不能作为这条链路的缺数后备。项目真实请求遇到 403；Sports Reference 条款禁止未授权 AI prompting/instructing，并限制自动访问。只保留已有实现/审查记录，不重试或绕过访问限制。[Sports Reference Terms](https://static.fbref.com/termsofuse.html)

### 建议落地的唯一一条链路

1. **候选范围：**用 SkillCorner 2024/25 A-League season aggregate 做“有已观察赛季数据的球员池”；不把它称为完整注册 roster。未达来源分钟门槛者不存在于池中，不用零值补齐。位置仅保留来源 `position_group`；不要推断 `Centre-back` 等子位置。
2. **能力证据：**确定性工具只处理来源确有值的 physical、passing、off-ball run 列，先实现字段覆盖率、样本分钟、来源原生的 `p30tip` 等分母口径与同位置内分布；未定义的数字不合并成单一“能力分”。对上游 20 场追踪/事件数据只做按比赛绑定的例证；当前本机缓存只有赛季聚合 CSV，尚无这些比赛文件，且不能把抽样事件说成赛季完整事件库。
3. **身份：**用 Reep v1 的 `skillcorner/player` exact bridge 生成 canonical player identity；数据键必须保留成字符串，使用 release stamp 与 checksum，并跟随当前 snapshot `redirects`。未匹配/多 ID/redirect 状态均明示，禁止姓名回退。Reep 的 Wikidata overlay 不是独立 bridge；Reep `affiliation` 也不能被包装成 2026/27 注册名单。
4. **上下文：**OpenFootball 仅提供 2026/27 比赛、队名和赛果。用来源自身稳定标识、competition-season 键；如果没有能经 Reep 或上游 schema 验证的团队 ID 对照，则只展示为分离的赛程背景，不做团队名称 fuzzy join。
5. **LangGraph：**Requirement node 将自然语言拆成位置、战术偏好、时间/联赛范围；source-coverage node 确认本机只有 A-League 2024/25；候选工具产出数据存在的球员；evidence node 补指标；Reviewer 检查来源、样本门槛、指标口径、身份和许可 gate。需求是拜仁/巴萨但证据源仅覆盖澳洲历史赛季时，应询问用户是否接受该样本，或停止并解释，不生成貌似当前的榜单。
6. **许可 gate：**SkillCorner 原始行和派生记录不进入本机 LLM、RAG、LangGraph checkpoint、浏览器持久存储或公开页面，除非其数据许可范围得到确认。图结构和 tool contract 可以用合成 fixture 验证；真实 SkillCorner 数据先在 deterministic offline parser / metric notebook 中评估。需要现阶段实测 LLM 报告时，使用已有 CC BY Wyscout 历史样本且将模型输入来源、历史时间、署名留在 evidence record。

**明确不适合：**让 Reep/Wikidata 顶替阵容或能力源；让 OpenFootball 的每日 JSON 构建等同于每天更新上游赛事实情；用 SkillCorner 2024/25 输出 2026/27 现役名单；用 FBref 自动抓取并把结果送入模型（Sports Reference 条款明确禁止 AI prompting/instructing，且项目实测遇到 403）；用 Football Manager IDs 当作 FM 内部能力属性；为填数据空缺将未授权的 FPL/API-Football/网页抓取数据合并进产品。[Reep Coverage](https://reep.football/coverage/) · [OpenFootball updates](https://github.com/openfootball/football.json/blob/master/README.md) · [FBref terms](https://static.fbref.com/termsofuse.html)

## 前一轮结论与 provider 核对

**下一条可实际做成公开作品集主链路的来源，优先继续完成仓库现有 Sportmonks adapter，而不是新写爬虫。**官方文档给出按赛季取球队 squad 和球员赛季统计的端点；条款允许在应用中存储/展示数据并用它构建应用。免费计划只覆盖丹麦 Superliga 和苏格兰 Premiership；要做拜仁、巴萨等目标，需要账号实际覆盖或至少 Starter 的 5 个自选联赛（当前列价 €29/月）。Sportmonks 没有在公开条款中明确本项目可否把球员数据发给本机 Ollama；保持现有模型处理 gate 关闭，直到另行确认。[Sportmonks 免费联赛与功能](https://www.sportmonks.com/football-api/free-plan/) · [套餐](https://www.sportmonks.com/football-api/plans-pricing/) · [球员赛季统计端点](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/statistics/get-season-statistics-by-participant) · [服务条款](https://www.sportmonks.com/terms-of-service/)

**不要把“公开可读”当成可爬、可进 LLM 或可公开展示。**FBref 条款明文禁止将站点内容用于 AI prompting/instructing，也限制会影响服务的自动访问；Transfermarkt 条款禁止 bot/spider/screen-scraping 等自动访问，并禁止用于 AI 训练/开发；Premier League Fantasy 条款禁止自动系统访问游戏并提取信息，且称 Game Data 属于 Premier League 知识产权。[Sports Reference Terms](https://static.fbref.com/termsofuse.html) · [Transfermarkt Terms](https://www.transfermarkt.com/intern/anb) · [FPL 2026/27 Terms](https://fantasy.premierleague.com/help/terms)

**若暂时不接付费联赛源，先把数据源分工讲清楚：**SkillCorner Open Data 与 StatsBomb/Impect 适合作为带赛季边界的历史战术/表现证据和离线评估集，不是当前完整球员市场；PlayerElo 适合作为带供应方标识的外部派生信号，不是可复算的比赛事件评分；foot.io 值得留作 API/MCP 方向观察，但当前页面对 access tier 和上线状态有明显矛盾，暂不作为已验证的生产依赖。[SkillCorner Open Data](https://github.com/SkillCorner/opendata) · [StatsBomb Open Data](https://github.com/hudl/open-data) · [PlayerElo API](https://playerelo.football/api-access) · [foot.io docs](https://foot.io/docs) · [foot.io 条款](https://foot.io/terms)

## 官方来源复核

| 来源 | 数据、覆盖与更新（官方页面） | 访问 / 价格 | 存储、展示、本地模型处理 | 结论 |
| --- | --- | --- | --- | --- |
| **Sportmonks Football API** | 有 team/season squad 与逐球员 season-statistics API；文档示例涵盖分钟、出场、进球、助攻、牌、抢断、对抗等，统计 type 有独立目录。供应方也提示联赛可能有覆盖缺口且不保证所有数据始终完整准确。官方 coverage 页最后显示更新于 2026-08-18；这不是阵容/统计具体字段的更新时间 SLA。[Squad 与球队页指南](https://docs.sportmonks.com/v3/tutorials-and-guides/guides/how-to-build-a-team-page) · [赛季统计端点](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/statistics/get-season-statistics-by-participant) · [统计类型](https://docs.sportmonks.com/v3/definitions/types/statistics) · [coverage](https://www.sportmonks.com/football-api/coverage/) | 免费不需信用卡、无到期，但限丹麦和苏格兰。Starter €29/月任选 5 个联赛、2,000 calls/entity/hour；Growth €99/30 leagues；Pro €249/120 leagues。试用 14 天，条款要求卡并自动续费，需在试用结束前取消以避免扣款。[Free plan](https://www.sportmonks.com/football-api/free-plan/) · [Pricing](https://www.sportmonks.com/football-api/plans-pricing/) · [试用条款](https://www.sportmonks.com/terms-of-service/) | **已证：**条款允许储存、传输、分发 API 提供的数据，并允许基于数据构建 apps/websites；禁止未经许可直接转售数据。**待确认：**没有看到明确的 LLM / 本地推理 / embedding 条款；也未确认本项目账号对特定联赛、赛季和每个统计字段的 entitlement。[Terms](https://www.sportmonks.com/terms-of-service/) | **主候选源首选。**接口与现有项目匹配，且应用展示/缓存边界比开放网页清楚；但需付费才能覆盖目标联赛，真实账号 smoke 和 Ollama 使用权仍待确认。当前 adapter / bounded smoke 见 [`sportmonks-provider.ts`](../../../src/data/sportmonks-provider.ts)、[issue 48](../issues/48-sportmonks-current-pool-smoke.md)。 |
| **foot.io REST / MCP** | 官方 docs 记录约 311,637 indexed player profiles，字段含生日、位置、细分位置、偏好脚、外部 ID；有 `player_season_stats`，要求显式筛 `stat_scope`（league vs all competitions），并有 source/provenance、quality/coverage 查询和 question-shaped MCP tools。文档称统计/实体完整度有缺口；持有与可读数量不同。它明确称 top-5 联赛 match-events 和 lineups 当前没有通过授权闸门，转会、shot/xG rows 当前各层均不返回记录；不应假设有足够的顶级联赛事件级战术数据。[Docs: resources, license gate, stat scope, provenance and MCP](https://foot.io/docs) | **同一供应方页面冲突：**signup 页面称 free key 即时创建、5,000 req/month、全部历史数据、且页面将 SLA 列在 Free tier 下；docs/terms 则称 closed beta、key invite-only，免费/public preview 仅当前赛季、quota 按 invite 指派，且没有通用 SLA。不能以较宽松的 signup 声明替代实际 key 条款和线上测试。[signup](https://foot.io/signup) · [docs access rules](https://foot.io/docs) · [terms](https://foot.io/terms) | **已证：**条款允许在上游许可和 key 权利范围内构建产品/分析，缓存应用所需最少响应、展示带来源事实并保留来源署名；禁止转发原始/近原始数据集或单资源约 5,000 行以上的实质子集。**待确认：**各行仍受上游许可限制，AI prompt / 本地模型推理未被明确批准，free access 规则自相矛盾。[Terms](https://foot.io/terms) | **暂不选作 MVP 主源。**对 Agent 很有吸引力：coverage、provenance 与 MCP 工具适合让 LangGraph 检查数据质量；但 access tier 和可用数据缺口未验证。等实际 key + 对本项目的上游/LLM权利澄清后再加；不要仅为“有 MCP”而绕过自己的身份、评分与 Reviewer。 |
| **PlayerElo API** | 官方称 79K+ 球员、176 项赛事、每日刷新；API 有按联赛球员列表、球员/俱乐部详情、阵容、每场 Elo/EAR history、trend、style/per-90 profile、squad-gaps、fit/value/prospect 等。模型分数是供应方派生评价而非原始逐事件观察；例如 fit 是战术、财务、阵容需要混合分，不能当作 TactiScout 自己的解释性依据。[API access](https://playerelo.football/api-access) · [字段示例](https://playerelo.football/docs) | Free 500 calls/月、10/min，页面定位 evaluation & hobby；Pro €19/月、10,000 calls，定位 production apps/dashboards；Business €199/月才明列 commercial licence 与 SLA。页面有 free key 申请入口，实际 key、目标联赛覆盖和 API 命中尚未验证。[API access](https://playerelo.football/api-access) | **已证：**产品说明其 Elo/EAR 是面向模型、球探工具和研究的输入。**待确认：**公开作品集里逐球员展示、应用缓存/持久保存及把字段发给本机 Ollama 的正式权利；商业许可在 Business 档才明确，Free 也明确是 hobby/evaluation。[API access](https://playerelo.football/api-access) | **作为独立对照信号保留，不当主数据源或推荐捷径。**仓库已有按精确来源 ID 查询、Reep crosswalk 与报告展示 gate；详见 [`playerelo-client.ts`](../../../src/data/playerelo-client.ts)、[issue 32](../issues/32-query-scoped-player-source-contract.md)、[issue 43](../issues/43-playerelo-reep-identity-mapping.md)。|
| **API-Football** | 文档提供球员 profile / season statistics、transfer、roster 等 REST 端点，免费层限当前可用赛季；每次查询需 key。[官方球员 API 指南](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) · [pricing](https://www.api-football.com/pricing) | Free $0、100 req/day、所有 endpoint 名称列出但可用赛季受限；目标联赛/当前赛季需账户覆盖查询，不由官网总 coverage 推断。[Pricing](https://www.api-football.com/pricing) | Terms 说明 API 不授予用户把数据发布在其 app/site/product 的许可，发布许可须向相应权利方申请；因此免费额度不是公开 demo 展示许可。[Terms](https://www.api-football.com/terms) | **只做无持久化、不发模型的本地 schema smoke。**现有预检入口记录在 [issue 47](../issues/47-api-football-free-current-season-smoke.md)，但不应让其数据进入公开推荐结果，除非获得许可。 |
| **SkillCorner Open Data** | 当前 repo README 仍写 10 场 tracking/dynamic events；但本次核对的 `data/matches/` 目录和 `matches.json` 都列出 20 个 2024/25 A-League 比赛 ID。另有跨 2024/25 赛季的 Physical、Off-Ball Runs、Passing CSV；player-season/position-group 行含 `player_id`、姓名、球队、粗位置、分钟与多类跑动/传球指标，README 称低于 60 分钟的表现被排除。[README](https://github.com/SkillCorner/opendata/blob/master/README.md) · [当前比赛目录](https://github.com/SkillCorner/opendata/tree/master/data/matches) · [matches.json](https://github.com/SkillCorner/opendata/blob/master/data/matches.json) · [aggregate 目录](https://github.com/SkillCorner/opendata/tree/master/data/aggregates) | GitHub 可直接下载，无 API key；内容是历史 2024/25 数据且未声明下一季/持续更新计划。 | README 称数据由 SkillCorner/PySport open-sourced 并请求 credit；仓库根目录 MIT 文件以 “Software” 为许可对象，没有独立 CSV data licence，也没有明确的本地 AI inference、长期存储、公开逐球员展示/再分发约定。[README](https://github.com/SkillCorner/opendata/blob/master/README.md) · [LICENSE](https://github.com/SkillCorner/opendata/blob/master/LICENSE) | **强战术字段的历史样本，不是现役池。**可以用于无账号的本地 schema/确定性指标研究；模型、RAG、checkpoint 与公开展示维持关闭，直至数据许可范围确认。项目 gitignored cache 当前只有三个 season aggregate CSV，没有 20 场比赛事件文件；缓存 provenance 固定在上游 commit `4340d274572876239c154c90bc507a9b3250a656`。 |
| **StatsBomb / Impect Open Data** | StatsBomb 发布选定赛事/赛季的 JSON：competitions、matches、events、lineups，部分场次有 360；Impect 发布 Bundesliga 2023/24，含事件、KPIs、球员比赛聚合、lineups、玩家/阵容资料与 KPI 定义。[StatsBomb README](https://github.com/hudl/open-data) · [Impect README](https://github.com/ImpectAPI/open-data) | GitHub 可读/取用公开样本；两者未承诺完整现役球员库或当前赛季 continuously-updated feed。 | StatsBomb README 要求发布分析注明来源并使用 logo，且存在 User Agreement；Impect README 要求使用前接受 `LICENSE.pdf` 并 credit/使用 logo，同时鼓励发布分析。我们未从 PDF 逐条确认本项目的模型、持久化及原始数据再发布边界；不能只凭公开下载宣称许可完备。[StatsBomb README](https://github.com/hudl/open-data) · [Impect README/license reference](https://github.com/ImpectAPI/open-data) | **作为历史表现/图表/回归评估源；不当当前候选搜索源。**Impect 的通过对手等指标能补充普通 box score，但年份明确是 2023/24。 |
| **FBref、Transfermarkt、FPL 页面抓取** | 这些站可见比赛/球员网页，不等于具备可复制的 API 或许可。 | 各站条款分别限制自动访问/数据用途。 | FBref Terms 禁止未经许可且影响性能/访问的自动采集，并明确禁止将内容用于 prompt/instruct AI；Transfermarkt Terms 明确禁止 bot/spider/screen scraping 及 AI 训练/开发；FPL Terms 禁止 automated systems access/extract，并称 Game Data 属于 Premier League IP。[FBref terms](https://static.fbref.com/termsofuse.html) · [Transfermarkt terms](https://www.transfermarkt.com/intern/anb) · [FPL terms](https://fantasy.premierleague.com/help/terms) | **本项目不以爬这些网页来填数据缺口。**FBref 尤其不适合作为本地 LLM 球探依据；脚本节流并不能消除条款对 AI prompting 的明文限制。 |

## 给 TactiScout 的实际决策

### 一个首选：Sportmonks，作为可发布的在线候选池

这是**面向公开作品集交付**的首选，而不是“最便宜”或“全世界绝对最全”的声明。它有现役 squad + 赛季统计接口、清晰的联赛选择方案、写明可用于 apps/websites 的条款，并且本仓库已实现 provider 与限量 smoke。[provider](../../../src/data/sportmonks-provider.ts) · [bounded smoke issue](../issues/48-sportmonks-current-pool-smoke.md)

开始正式图表/Agent 集成前，按以下次序完成，不需要写新爬虫：

1. 使用现有 bounded smoke 验证真实账号一个目标赛季/一队的 roster 与字段覆盖；报告只写人数、字段命中率和来源/赛季 ID，不输出球员原始记录。
2. 把 provider capability 声明为“配置 league + season 的候选池”，返回 `source/competition/season/retrievedAt/coverage/missingMetrics`；自然语言超出配置范围时由 LangGraph 问清要不要扩范围/换数据源，不假装全球搜索。
3. 把可解释的 per-90/位置内对比和样本门槛交给确定性工具；LangGraph 决定下一次查 roster、统计、补缺指标、向用户询问或结束，不能凭空造统计/转会费。
4. **保留本地 Ollama gate。**先取得 Sportmonks 对本地 AI 推理/报告生成的明确答复，再把允许范围、缓存、UI 报告字段配置为独立 policy；不将“允许在网站展示”推成“允许送入模型”。

### 一项明确不适合：FBref 自动采集并作为本地 Agent prompt 数据

它看上去有丰富统计表，但官方 Terms 禁止用于 AI prompting/instructing，并限制会影响站点服务的自动采集。将 HTML scrape 进本地数据库后交给本机 Ollama，正中其 prompt 用途条款；“个人非商业”并没有把这项明确限制消掉。[Sports Reference Terms](https://static.fbref.com/termsofuse.html)

### 候补：foot.io 为 LangGraph/MCP 的下一轮 access review

若希望下一步体现 harness/source-governance，foot.io 的 MCP 工具目录与其 coverage/provenance/data-quality 接口很有启发：Agent 可以先查覆盖、来源层级和证据，再选 search/detail tool，而不是只拿一个 provider 返回列表。此为**工程推断**，不是已经接通的项目能力。[foot.io MCP & quality docs](https://foot.io/docs)

但目前不是可直接落地的在线源：服务条款/doc 写 closed beta、invite-only、free 当前赛季；signup 页面却写即时免费 key 和完整历史。top-5 match events/lineups 不经授权闸门，逐条统计记录仍受上游许可约束。本次没有 key，没有发请求，没有确认 Ollama 权限。先核实账号和目标联赛记录后，才考虑接入。

## 对 Agent / harness / UX 的含义（工程推断）

- 把 **candidate discovery** 与 **performance evidence** 建成不同的 graph tools：`search_candidates` 只管给定 provider/league/season 的 roster 或球员 pool；`get_player_evidence` 只取该来源定义的统计/赛季样本。不要因为一个来源有球员名字就默认它能评分。
- 每条 source tool 返回统一外壳：`sourceId`、数据实体 ID、联赛/赛季、抓取时间、数据范围、命中/缺失字段、分页/样本量、来源许可策略状态。原始统计保留为来源专属指标，除非完成语义映射和显式公式，不在不同 provider 间悄悄求平均。这个方向符合项目已有的[来源特定表现证据 ADR](../../../docs/adr/0003-source-specific-performance-evidence.md)与[分层来源 issue](../issues/39-layered-player-evidence.md)。
- LangGraph 的亮点放在 evidence-loop：先问 source coverage，再按需求选择来源工具，检测缺口时追问或切换来源，对已评估球员取定性报告/历史事件，最后由 Reviewer 检查每条推荐是否有匹配位置、指标证据、样本与许可。来源不可用、无匹配、数据缺失要是不同状态。
- UI 每个阶段应显示“正在查哪个来源/赛季、查了多少候选、评估了多少、有哪些指标缺失”，最终报告标明可观察范围。不得把 20 条抽样说成“市场排名”，也不得把历史赛季称为现役名单。

## 已证事实、工程推断、待确认

- **已证事实：**Sportmonks 的公开计划/条款与 endpoint 文档、PlayerElo 定价/API字段、foot.io docs/条款/signup、SkillCorner README、StatsBomb/Impect README 及 FBref/Transfermarkt/FPL terms，以上均由对应发布方页面支持；链接置于表格各行。
- **工程推断：**在当前项目与作品集约束下，Sportmonks 更适合作为在线候选主源；foot.io MCP/quality endpoints 更适合作为后续 LangGraph harness/来源治理实验；FBref 刮页无法满足 agent prompt 数据路径。
- **待确认：**本机是否有各账号 key；账号是否确实覆盖目标联赛/当季；Sportmonks 或其他 provider 是否书面允许本机模型推理；foot.io signup/doc 冲突的实际 invite 权利；SkillCorner/Impect 数据集的公开球员级展示和模型使用授权。均未通过 live API 或供应方回复验证。

## 相关项目记录

- [来源扩展与证据分层 issue 39](../issues/39-layered-player-evidence.md)
- [Sportmonks 限量 live smoke issue 48](../issues/48-sportmonks-current-pool-smoke.md)
- [API-Football 免费账号 smoke issue 47](../issues/47-api-football-free-current-season-smoke.md)
- [按需球员数据源查询契约 issue 32](../issues/32-query-scoped-player-source-contract.md)
- [SkillCorner 补充表现数据 issue 24](../issues/24-supplementary-performance-evidence.md)
- [来源特定表现证据 ADR](../../../docs/adr/0003-source-specific-performance-evidence.md)
