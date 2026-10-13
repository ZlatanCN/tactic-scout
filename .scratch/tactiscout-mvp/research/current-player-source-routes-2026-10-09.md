# 当前球员数据源路线复核（2026-10-09）

## 结论

**本轮没有找到同时满足“当季、球员级、能扩大表现证据、可按 `PlayerRepository` 查询、且可明确用于本机存储 / Ollama-RAG / 作品集展示”的新免费来源。**最有价值的免费公开页面是 xG Stat：它覆盖 2026/27 五大联赛球员和角色表现指标，但条款只允许在其平台内使用并明禁自动提取、站外发布；因此它可以供人手动查看，不是可接进 TactiScout 的数据源。荷兰 Eredivisie 官方统计分类覆盖 tracking 等方法方向，但当前赛季球员数据和 machine-readable feed 未得到证明，且条款禁止自动采集。阿根廷 LPF 的 2026 Clausura 官方逐轮报告是球队汇总，没有球员行，不能形成候选池。

技术上更接近所需数据形状的 TheStatsAPI、StatPal 都是付费 API；它们的当前赛事覆盖、上游权利、本机留存、模型/RAG 和公开逐人展示权限尚无足够证据，不作为此项目的下一数据源。

本轮只查发布方页面、文档、服务条款和官方报告；没有请求球员 API、下载或保存球员数据、尝试隐藏接口、运行爬虫或修改 provider 代码。已有矩阵中已审的 FPL/Pulselive、Understat、ASA、foot.io、FootyStats、SPL、Liga Portugal 等路线不作为本轮新发现。

## 候选比较

| 路线 | 当季与字段证据 | 接入形状 / Agent 查询语义 | 访问、刷新和价格 | 使用权与判断 |
|---|---|---|---|---|
| **xG Stat（免费球迷平台）** | 官方价目页称覆盖 2026/27 的 Premier League、La Liga、Serie A、Bundesliga、Ligue 1；免费层含球员/球队 profile、season rating、percentile、核心球员表字段和核心指标比较。Premier League 可见 xG、射门、球员位置类别及赛季比较；其他四联赛标为 stats depth。产品称 Premier League 指标基于比赛事件，其他联赛用 professional stats feed；其数据说明称自有模型使用 Wyscout 事件数据。它增加一些角色评分、百分位和比较视角，但**不扩大现有五大联赛地域池**。[2026/27 覆盖、免费层和价格](https://www.xgstat.com/?view=pricing) · [数据来源说明](https://docs.xgstat.com/learn/why-our-numbers-differ) · [球员评分方法](https://www.xgstat.com/learn/xg-stat-player-rating) | 公开材料展示球员表/profile/比较 UI，没有公开 REST API、完整字段字典、分页/筛选参数或稳定 provider ID。UI 的“比较”功能不能证明它可提供同来源、同赛事/赛季/位置的完整 peer set；也没有机器可读的完整 roster 与球队检查查询。故无法可靠实现 `searchCandidates`、`inspectTeam`、`getPlayersByIds` 或 `getComparisonPlayers`，也无法为 `sourceIdentity` / 缺失覆盖做可复算 provenance。 | 免费账号可查看核心面板；Season Pass 标价 €49/2026–27 赛季；页面声明整个赛季覆盖并更新，但没有可核验的逐字段更新时间 SLA。[价目页](https://www.xgstat.com/?view=pricing) | 条款 §3 将数据权利限制为“通过平台”个人或内部业务用途，禁止在站外再分发或利用；§4 明确禁止抓取、爬取、自动提取、批量自动访问及站外发布。条款没有单独写 LLM/embedding，但不授予站外处理权，因此本机数据库、Ollama/RAG、生成具名报告或公开作品集均需事先书面许可。[xG Stat Terms §§3–4](https://www.xgstat.com/terms) **结论：可作人工参考页面；NO-GO 自动接入、持久化、模型输入与报告展示。** |
| **Eredivisie 官方统计中心** | 官方网站提供 General、Attacking、Defending、Field play、Tracking、Historical 分类；联赛也公开介绍其跟踪数据与 Stats Perform 事件数据用于俱乐部分析。但公开统计页没有可引用的完整指标字典、当季版本参数或更新时间承诺；本轮无法确认它公开提供 2026/27 球员表现全集。[官方统计中心](https://eredivisie.com/stats/) · [Field play 分类](https://eredivisie.com/stats/fieldplay/) · [官方 tracking/event data 说明](https://eredivisie.com/news/utilizing-insights-from-tracking-and-event-data-to-serve-the-next-generation-of-football-fans/) | 页面提供若干统计榜而非公开的数据契约。没有发现 API 文档、分页、来源 ID、完整名单或支持按球员 ID 批量查询的接口。即使人工浏览可见单项排名，也不能证明排名结果覆盖完整候选池；比较组和团队 roster 语义不足。 | 网页无需 API key，但没有公开 API、价格、额度或 freshness SLA。2026/27 赛季新闻存在，不能据此推断统计榜也已经切换到当季。[官方 2026/27 新闻与赛季信息](https://eredivisie.eu/) | 使用条款规定个人用途，其他尤其商业用途禁止，并明禁 data-mining、robot、spider、scraper 或自动/人工方式监测、复制网页；页面内容及供应商保留权利。[官方 Terms](https://eredivisie.com/terms-of-use/) **结论：只作人工查看指标分类；NO-GO 自动采集、存储、LLM/RAG 或公开展示。若有价值，向 Eredivisie CV 申请机器可读 feed 及逐项用途许可。** |
| **LPF Data / 阿根廷 2026 Clausura 官方逐轮报告** | LPF 官方页面列出 2026 Clausura 的逐轮报告；当季报告包含球队级控球、传球、射门及 xG 等摘要。官方页面没有球员级统计表或球员赛季排名。[LPF Data 页面](https://www.ligaprofesional.ar/lpf-data/) · [2026 Clausura 第 11 轮官方报告](https://www.ligaprofesional.ar/wp-content/uploads/2026/10/LPF-Data-Prensa-Fecha-11.pdf) | 报告的观测单位是球队/比赛，不是球员。没有 player ID、球员位置/分钟/赛季统计，也没有 roster 或球员比较组。它不能执行候选筛选、球队检查、按 ID 取档或同位置比较，**不构成候选人来源**。 | 报告在公开网页可读；未发现开发 API、schema、key、价格、更新 SLA 或批量结构化 feed。每轮发布 PDF 也不等同于开放数据库。 | 本轮未找到 LPF Data 对自动处理、长期留存、本地模型、衍生球员报告或作品集展示的独立许可文本。该部分是**未知**，不能从 PDF 可访问推断授权。**结论：排除为球员数据源；无需对其 PDF 做自动抽取。** |
| **TheStatsAPI（付费 API，对照）** | 官方称默认 150 项赛事、84,000+ 球员，另有 1,196 项赛事可按需开通；玩家赛季统计文档显示 player/season/team ID、位置、出场、首发、分钟、进球、助攻、射门、牌等字段。覆盖表称玩家统计通常在终场后 1–2 小时稳定，但没有证明每个目标赛事在 2026/27 均有完整覆盖。[球员赛季 API](https://www.thestatsapi.com/use-cases/fantasy-football-api) · [Player Stats endpoint](https://www.thestatsapi.com/football/player-stats) · [coverage/update timing](https://www.thestatsapi.com/coverage) | 已公开的 season stats endpoint 有比赛/赛季和分页参数，响应字段含 player ID、team、position、minutes；若真实目标赛事响应维持此 schema，理论上能支持按来源 ID 搜索、团队 roster 和同赛事赛季位置 peer comparison。尚未验证真实目标赛事、年龄、完整池或目标比赛字段；不得把供应方目录总数当作当前赛季可查询覆盖。 | Bearer key；7 天试用，Starter $50/月、每月 100,000 请求。官方宣称付费计划允许商业使用；当前是付费路线。[API/计划](https://www.thestatsapi.com/football-api) | 官网 Terms 链接存在，但本次官方 Terms URL 请求超时，条款未核读；留存、派生统计、本机 Ollama/RAG/embedding、公开逐人展示及上游供应授权全部**未知**。官网 “commercial usage” 不能替代这些具体许可。[官方 Terms 链接](https://www.thestatsapi.com/terms) · [联系/数据覆盖请求](https://www.thestatsapi.com/contact) **结论：技术上最强的全球候选，但本项目暂不买试用、不请求真实球员行、不接入；先索取合同和目标联赛/赛季字段覆盖清单。** |
| **StatPal（付费 API，对照）** | 官方宣称足球覆盖 1,000+ 联赛、当前赛季和历史球员/球队统计、球员专项比赛指标与 xG（50+ 联赛）。这些是服务页范围主张，不是已验证的目标联赛行覆盖；可公开文档没有提供完整球员赛季字段字典/比赛级 season+position matrix。[足球覆盖主张](https://statpal.io/coverage/) | Quick Start 列出 player-stats、rosters 等端点，但公开文档未给足以确认稳定 player ID、season/competition/position、minutes 和完整池分页的 schema。不能证明它支持 repository 的 4 个查询，也不能安全合并外部 peer comparison。 | API key；14 天试用，试用结束若未取消将收费；Starter $29/月只含任意两项运动，官网额度最高 50k calls/day。服务称 live endpoints 每 15 秒刷新、其他端点通常一小时多次；这是供应商宽泛声明，不是 player season SLA。[Quick Start](https://statpal.io/quick-start-tutorial/) · [计划与更新时间](https://statpal.io/) | Terms 禁止未经书面许可系统性收集/编目数据，另限制自动化提取；terms 对准确性/时效性不作保证。本轮未找到明确的数据响应保留、本地推理/embedding/RAG、派生排名或公开展示许可。[StatPal Terms](https://statpal.io/tos/) **结论：付费、schema 和权利均未过门槛；不列入下一实现路线。** |

## 与当前查询契约的差距

本项目的来源接缝要求查询时保留原生 `(source, playerId)`，并要求同源、同比赛/赛事、同赛季、同位置的 peer comparison；缺源必须显式返回失败，不能让空白看起来像完整市场。[来源准入矩阵](player-evidence-source-admission-matrix-2026-10-08.md) 本轮候选中：

- **只有 TheStatsAPI 的公开 schema 初步呈现出 machine-query 形状**，但免费条件、真实当前赛季覆盖和关键数据权利都未确认。
- **xG Stat 和 Eredivisie 是网页产品而非已文档化数据源**；可见榜单与比较 UI 不等于可重现查询接口。
- **LPF Data 报告以球队/比赛为单位**，它没有球员候选池。
- **StatPal 的字段合同公开不足**，不应以覆盖总数和 API key 替代 schema 验收。

因此没有一个本轮候选可安全注册为当前 `PlayerRepository` provider；不要将人工页面、付费试用或未授权报告纳入 RAG/评分，也不要让来源故障退化成“数据完整”。

## 推荐下一步

1. **免费可做：**人工使用 xG Stat 查看当前五大联赛的评分/指标定义，作为产品设计和本地合成数据评估的参考；不复制逐球员行、不落库、不进入 Ollama/RAG 或报告。该动作不会声称增加 TactiScout 的真实候选覆盖。
2. **如果要接入真实新增表现池：**由项目所有者向 xG Stat（`support@xgstat.com`）或 Eredivisie CV（`info@eredivisie.nl`）索取正式 machine-readable API/feed 与书面权限，问题明确覆盖：目标联赛/2026–27 season coverage、球员赛季 ID/位置/分钟与完整 roster、分页、更新时间；允许本机持久化多久；能否给本地 Ollama 推理、embedding/RAG 与缓存；能否发布含姓名/统计的派生报告和作品集演示。来源方没有书面答复前不做接入 smoke。
3. **若优先考虑全球候选池而愿接受付费：**先向 TheStatsAPI 索取可提供授权条款、目标比赛覆盖表及一份不含球员行的 schema 样例；同时书面确认长期本地缓存、本地模型输入、派生报告和作品集逐人展示，再决定是否购买试用。当前证据不支持直接开通或将其列为“已授权数据”。

**最终判断：NO-GO 新数据接入。**下一可交付动作是人工询问权利与 feed 条件，并继续用当前已准入数据完成 harness 与评估；这比把不可提取的网页、无球员行 PDF 或付费宣传页当作新数据池可靠。

## 官方来源索引

- xG Stat：[2026/27 coverage and plans](https://www.xgstat.com/?view=pricing) · [Terms](https://www.xgstat.com/terms) · [data-source notes](https://docs.xgstat.com/learn/why-our-numbers-differ) · [rating method](https://www.xgstat.com/learn/xg-stat-player-rating)
- Eredivisie：[stats index](https://eredivisie.com/stats/) · [field play and tracking categories](https://eredivisie.com/stats/fieldplay/) · [terms](https://eredivisie.com/terms-of-use/) · [official tracking/event data description](https://eredivisie.com/news/utilizing-insights-from-tracking-and-event-data-to-serve-the-next-generation-of-football-fans/)
- LPF：[LPF Data](https://www.ligaprofesional.ar/lpf-data/) · [2026 Clausura round 11 report](https://www.ligaprofesional.ar/wp-content/uploads/2026/10/LPF-Data-Prensa-Fecha-11.pdf)
- TheStatsAPI：[player season docs](https://www.thestatsapi.com/use-cases/fantasy-football-api) · [coverage](https://www.thestatsapi.com/coverage) · [plans](https://www.thestatsapi.com/football-api) · [Terms](https://www.thestatsapi.com/terms) · [contact](https://www.thestatsapi.com/contact)
- StatPal：[soccer coverage](https://statpal.io/coverage/) · [quick start](https://statpal.io/quick-start-tutorial/) · [pricing](https://statpal.io/) · [Terms](https://statpal.io/tos/)
