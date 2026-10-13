# TactiScout 数据源扩展：现役球员池、比赛事件与战术追踪

核查日期：2026-10-05。重点核查能改善 Wyscout 2017/18 历史样本的来源：当前球员名单/赛季统计、公开比赛事件、战术追踪。优先查数据提供方、官方仓库、发布论文和许可原文。没有使用账户密钥、调用需凭据的接口、下载新数据或联系供应商；以下覆盖和权利判断以公开材料为限，不构成法律意见。

## 结论

**没有找到一个同时免费、覆盖广、持续更新、有细粒度球员表现数据，并明确允许本地 AI 处理和公开逐球员展示的单一来源。**当前应把候选发现与深入战术证据分成两个有明确范围的来源：

1. **当前候选池：优先验证仓库已有 Sportmonks adapter。**其官方 API 文档有当前/历史赛季、按赛季读取球队和球员名单、球员赛季统计的接口。免费计划仅含两个联赛；官方页面列出的 Starter 为月付 €29、任选五个联赛。仓库已有服务端 token adapter 和账户确认统计覆盖机制，因此技术路径短，但本地 LLM 权利没有公开条款明确回答，需要在开启模型处理前向提供方确认。[官方 API 文档](https://docs.sportmonks.com/v3/api/demo-response-files) · [赛季文档](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/leagues-and-seasons/seasons) · [计划与价格](https://www.sportmonks.com/football-api/plans-pricing/) · [服务条款](https://www.sportmonks.com/terms-of-service/)
2. **战术数据验证：新增 DFL / IDSSE 七场比赛数据集作为独立 benchmark。**它提供 2022/23 德甲和德乙 7 场的具名球员、事件、阵型及 25Hz 球员/球追踪，官方论文称获 DFL 授权按 CC BY 4.0 发布。权利清楚、可复现，适合验证 TactiScout 自算的空间/压迫/推进证据及 Agent 工具选择；样本不足以作为宽市场候选池或球员稳定排名。[官方数据论文](https://pmc.ncbi.nlm.nih.gov/articles/PMC11787359/) · [Figshare 数据发布](https://doi.org/10.6084/m9.figshare.28196177) · [CC BY 4.0 法律文本](https://creativecommons.org/licenses/by/4.0/legalcode)

SkillCorner 2024/25 A-League 球员聚合样本已在仓库具备 adapter，且本地 `.data/skillcorner-open-data/` 有数据文件；它补充体能、传球、无球跑动证据，但数据许可文件是否覆盖数据本身，以及本地存储、LLM、公开作品集用途，官方公开材料没有说清。现有三项默认关闭的权限开关应保持关闭，直到取得澄清。[SkillCorner 官方仓库说明](https://github.com/SkillCorner/opendata/blob/master/README.md) · [仓库 LICENSE](https://github.com/SkillCorner/opendata/blob/master/LICENSE)

## 代码现状与适配边界

- 当前默认历史候选池是 Wyscout 2017/18；项目把事件派生统计保存在版本化自建快照中，不代表现役球员池。
- **Sportmonks** 已有可选当前赛季 adapter、单队/赛季 smoke 命令和测试；代码会把当前 squad 与该赛季统计合并，保留 provider IDs。真实联赛 entitlement、统计类型 ID 和模型处理权尚未由用户账户实测。[adapter](../../../src/data/sportmonks-provider.ts) · [安全 smoke CLI](../../../src/data/sportmonks-smoke-cli.ts) · [配置示例](../../../.env.example)
- **SkillCorner** 已有三张 A-League 聚合表的读取器、固定来源版本采集器和来源快照；限制为历史样本，不是当前球员池。[adapter](../../../src/data/skillcorner-provider.ts) · [采集器](../../../src/dataset/collect-skillcorner.ts) · [数据范围](../../../src/domain/dataset-scope.ts)
- **StatsBomb Open Data** 已有事件/阵容 adapter 和模型处理授权闸门。官方仓库已含 2023/24 德甲等选定赛季以及 2024 国际比赛，但它不是完整当前球员库。官方赛事索引能直接核对赛季和 `match_updated`；每项文件更新时间不等于持续刷新承诺。[赛事索引](https://raw.githubusercontent.com/hudl/open-data/master/data/competitions.json) · [官方 README](https://github.com/hudl/open-data/blob/master/README.md) · [数据使用协议](https://github.com/hudl/open-data/blob/master/LICENSE.pdf)
- **IDSSE** 尚无 adapter。其 XML、比赛帧和逐事件记录不适合塞进当前按球员/赛季查询的 `PlayerRepository`，也不应把七场参赛球员当成可引援候选。需要独立的离线战术证据/benchmark 入口，并把 TactiScout 推导值与 DFL 原始字段分开。

## 来源比较与权利核对

| 来源 | 官方覆盖、数据更新与证据 | 费用、凭据 | 公开作品集 | 本地持久化 | 发送到本地 LLM |
|---|---|---|---|---|---|
| **Sportmonks Football API** | 当前及历史赛事/赛季取决于订阅和联赛 entitlement；API 文档列有赛季、球队 squad、球员赛季和逐场统计。基础球员统计含分钟、传球、关键传球、盘带、对抗、防守、射门等；细项依联赛而异。官方说明 coverage 可能变化，应在账户内/接口动态核实；未找到名单与统计的 freshness SLA。[赛季列表](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/leagues-and-seasons/seasons) · [球员统计说明](https://www.sportmonks.com/football-api/football-stats-api/) · [联赛数据覆盖说明](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/data-features-per-league) | 需 API token。官方首页称免费计划有两个完整联赛、无需银行卡；Starter 月付 €29 起，任选五个联赛；xG 与 Pressure Index 是加购项。[官方首页](https://www.sportmonks.com/football-api/) · [价格](https://www.sportmonks.com/football-api/plans-pricing/) | 服务条款允许用数据构建 apps/websites 等自有产品，并说基于数据创造产品/收益原则上可以；禁止未经批准转售数据。原始球员统计直接公开、公开作品集的具体显示量，以及各赛事/球队第三方权利仍需按目标用途核实。不要把“可用 API”当成赛事素材权利。[服务条款 §§Terms of use/Copyright](https://www.sportmonks.com/terms-of-service/) | 条款明确说 API 数据的分发、转移和存储允许，但服务本身的复制/分发受限。保留源身份、抓取时间，避免转售原始数据。[服务条款](https://www.sportmonks.com/terms-of-service/) | **未知。**公开条款未提 Ollama、LLM、embedding 或模型上下文处理。不能仅从“自有应用可使用/可存储”推断模型输入许可；需书面确认后才开启 `TACTISCOUT_SPORTMONKS_AI_PROCESSING_ALLOWED`。 |
| **DFL / IDSSE** | 2022/23 两场德甲、五场德乙；207 名球员、10 支球队、11,137 项事件、1,002,644 帧球员和球的 x/y 坐标。逐比赛提供比赛信息、事件 XML 和位置 XML；位置 25Hz。没有未来更新计划/动态 API。包括阵型、球员标识、传球/射门/对抗/犯规、部分事件坐标与 xG；原始同步仍有时间戳误差风险，来源论文说明事件与追踪需谨慎同步，且不提供比赛视频。[数据论文与字段](https://pmc.ncbi.nlm.nih.gov/articles/PMC11787359/) · [数据发布](https://doi.org/10.6084/m9.figshare.28196177) | 免费公开数据集下载；不需要 API key。没有 SLA 或后续赛季订阅。[Figshare](https://doi.org/10.6084/m9.figshare.28196177) | **许可证据强。**DFL 授权按 CC BY 4.0 发布；该许可允许分享与改编（包括商业用途），但需要适当署名、链接许可并标明修改。可作为公开作品集的已归因样例/派生分析；不要声称 DFL 背书。[论文](https://pmc.ncbi.nlm.nih.gov/articles/PMC11787359/) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode) | **允许。**复用需保留作者/来源、许可链接与修改说明；不含视频素材，视频明确不在数据发布内。[数据论文](https://pmc.ncbi.nlm.nih.gov/articles/PMC11787359/) | **没有 LLM 专用条款。**源数据以 CC BY 4.0 发布，许可没有排除 AI/机器处理；在本地推理用途上，公开材料支持复制/分析数据，但不要将其外推到 StatsBomb、SkillCorner 等其他数据源。输出继续标示数据来源与派生计算。 |
| **SkillCorner Open Data** | 2024/25 澳大利亚 A-League player-season Physical、Off-Ball Runs、Passing 聚合；README 指统计表现样本需超过 60 分钟；另有少量比赛级 10Hz追踪、动态事件、比赛阶段数据。静态历史发布，未承诺更新。该指标集显著补充体能和无球跑动，但非欧洲当前候选名单。[README/字段](https://github.com/SkillCorner/opendata/blob/master/README.md) | GitHub 公开下载，无 API key。客户 API 需 credentials；公开样本无价格。[README](https://github.com/SkillCorner/opendata/blob/master/README.md) | **未知。**README 称与 PySport 联合开放发布并请求署名，但根 LICENSE 是 MIT 文本，描述 “Software and associated documentation”，没有明确说 CSV/球员级数据是否受该许可证覆盖。公开作品集/原始行展示/逐球员报告权利不确定。[README](https://github.com/SkillCorner/opendata/blob/master/README.md) · [LICENSE](https://github.com/SkillCorner/opendata/blob/master/LICENSE) | **未知。**README 没有明确授权本项目本地长期保存球员级聚合数据；当前采集器保存了快照，不代表已取得数据许可。[采集器](../../../src/dataset/collect-skillcorner.ts) | **未知。**README、LICENSE 未明文许可 AI/LLM 输入、embedding 或推理。保持代码默认关闭的本地存储、报告展示、模型输入开关，先向 SkillCorner/PySport核实数据许可归属和三种用途。 |
| **StatsBomb Open Data** | 官方仓库含选定联赛/赛季的 matches、lineups、事件和部分 360；现有男足德甲赛季索引包含 2023/24；同时覆盖国际赛事。是比 Wyscout 2017/18 更新的特定历史事件样本，但非完整当季阵容、也没有持续刷新 SLA。[官方赛事索引](https://raw.githubusercontent.com/hudl/open-data/master/data/competitions.json) · [数据结构](https://github.com/hudl/open-data/blob/master/README.md) | GitHub JSON 文件可公开读取/下载，无需 API token；完整商业 API 另需商业账户。 | README 将数据定位于研究与足球分析兴趣，并要求发布/分享/分发分析时署名 StatsBomb 并使用官方 logo。**原始文件再分发、公开作品集及模型使用需遵守单独 User Agreement；不能仅凭免费访问断言均获准。**[README](https://github.com/hudl/open-data/blob/master/README.md) · [User Agreement](https://github.com/hudl/open-data/blob/master/LICENSE.pdf) | 公开页面不足以概括协议对本地长期保存/再分发的完整边界；按项目现有 README 流程阅读协议并由用户确认。 | **未知，代码已保护。**协议和仓库材料没有在本次核查中给出可将资料送入 Ollama 的明确许可；应用已有 opt-in + 本机回环地址闸门，不能绕过。[README 现有流程](../../../README.md) |
| **API-Football（备选商业 API）** | 官方 coverage 页面列 1,247 项赛事并标注 2026-09-25 更新；`/players?league&season` 支持取赛季球员 profile 与 stats，但免费 plan 的可用 season 有限制。服务称每场球员统计端点比赛中每分钟更新；一般更新频率并非保证，随比赛变化。[覆盖页](https://www.api-football.com/coverage) · [球员 endpoint](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) · [统计更新频率](https://www.api-football.com/documentation-v3) | 需 API key。Free $0、100 requests/day；Pro 页面列 $19/月、7,500 requests/day。[官方价格](https://www.api-football.com/pricing/) | **不满足公开项目权利门槛。**服务条款明确说 API-Football 不授予用户在应用/网站/产品中发表数据的许可，发布许可须自行向权利方获取，并提示赛事/联合会第三方权利限制。[条款](https://www.api-football.com/terms) | **未知。**条款没给明确本地长期留存授权；公开条款不足以作肯定结论。 | **未知。**无本地 LLM 条款；不能把免费 key 当模型处理权。 |

## 为什么不扩大到抓网页

球员页面、实时比分接口、能访问的 JSON 或搜索引擎摘要并不能证明批量访问、存储、模型处理和公开展示都获准。API-Football 条款明确将公开发表许可留给数据使用者另行取得；SkillCorner 和 StatsBomb 则分别有数据许可范围未明、须遵守独立用户协议的问题。TactiScout 应通过“来源许可登记”给每个数据来源逐项记录自动访问、本地保存、AI 输入与公开展示，而不是给某网站整体打一个“公开”标签。

## 最多两条建议

### 1. 让 Sportmonks 承担当前球员发现与基础赛季表现

这是当前唯一已有完整代码路径的现役名单路线。后续不是再写 scraper，而是先用账户做小范围无模型 smoke：配置一个 `is_current` 赛季，核验目标联赛 entitlement、当前 roster 人数、分钟/位置/传球/防守统计空值，记录访问时间。免费套餐可在其两个联赛中验证技术流程；若目标必须是拜仁/巴萨所在联赛，先查实际计划 entitlement，再考虑 Starter。不要宣称 API 覆盖的球员就是完整转会市场。

只有提供方明确回复本地 Ollama 读取这些统计生成派生球探报告可接受，才启用 AI 数据处理开关；公开页面说明 `apps/websites` 和数据存储用途，但没有 LLM 许可文字。若没拿到回答，可先把来源用在结构化候选名单与确定性统计展示，而报告 Agent 继续只读许可证明确的数据/用户自建观察记录。

### 2. 新增 IDSSE 独立的 Tactical Sample Evidence 与回归场景

把七场 IDSSE 做成只读、版本固定的离线样本，而不是新增候选池。值得做的 MVP 指标可以是：事件时刻附近的持球压力/最近防守者距离、纵向推进距离、接应宽度或球队紧凑度。所有值标记为“ TactiScout 派生估算”，保留原始 frame/event 索引、时间同步容差、公式和 CC BY 署名。

在 LangGraph harness 中选固定球员/固定比赛样例，要求 Agent 工具仅在能力需求匹配时查此来源，并校验报告同时显示指标公式、比赛样本和“七场研究集不代表球员当前水平”。这能把“按需求编排 → 取证 → 能力对齐审查 → 不够证据时标缺口”的行为做成可重复的证据链；由于没有完整名单或跨季覆盖，不能拿它取代 Sportmonks 候选池或直接并入球员排序。

## 未确定、需要后续实证的事项

- Sportmonks 账号是否能覆盖目标的德甲/西甲当前赛季、每队统计类型和返回的样本/空值分布；公开套餐页面不能代替账户 entitlement。
- Sportmonks 本地 LLM 输入权限没有明确公开材料；需要服务商答复。
- SkillCorner 当前已下载 2024/25 A-League 样例，但 MIT 文件是否适用于球员数据、可否本地持久化、喂给 Ollama、公开报告仍未确认。
- StatsBomb 官方协议 PDF 的具体适用范围需在选择相应数据时逐项审阅；README 要求的署名和 logo 不等于模型输入授权。
- IDSSE 源发布允许 CC BY 4.0 复用；它不承诺后续赛季更新，且事件时间戳与追踪帧间的同步、指标公式和样本局限必须作为派生数据验证的一部分。
- 本文不声称任何来源已取得用户账号真实返回，也不声称候选推荐质量、联赛覆盖完整或球员排序准确。

## 一手来源

- [Sportmonks REST API 示例与球员赛季统计 endpoint](https://docs.sportmonks.com/v3/api/demo-response-files)
- [Sportmonks Seasons API](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/leagues-and-seasons/seasons)
- [Sportmonks Data Features per League](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/data-features-per-league)
- [Sportmonks Football API pricing](https://www.sportmonks.com/football-api/plans-pricing/)
- [Sportmonks Terms of Service](https://www.sportmonks.com/terms-of-service/)
- [DFL / IDSSE paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC11787359/)
- [IDSSE data release](https://doi.org/10.6084/m9.figshare.28196177)
- [Creative Commons Attribution 4.0 legal code](https://creativecommons.org/licenses/by/4.0/legalcode)
- [SkillCorner Open Data README](https://github.com/SkillCorner/opendata/blob/master/README.md) · [LICENSE](https://github.com/SkillCorner/opendata/blob/master/LICENSE)
- [StatsBomb Open Data README](https://github.com/hudl/open-data/blob/master/README.md) · [User Agreement](https://github.com/hudl/open-data/blob/master/LICENSE.pdf) · [Competition/season index](https://raw.githubusercontent.com/hudl/open-data/master/data/competitions.json)
- [API-Football player endpoint guide](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) · [coverage](https://www.api-football.com/coverage) · [pricing](https://www.api-football.com/pricing/) · [terms](https://www.api-football.com/terms)
