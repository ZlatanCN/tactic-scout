# 公共全球球员表现源筛查：FotMob 与 Data Sports Group / Global Sports Archive

核查日期：2026-10-10。对应 [issue 126](../issues/126-screen-public-global-player-performance-feeds.md)。先阅读项目[领域上下文](../../../CONTEXT.md)、[数据来源矩阵](../../../docs/data-sources.md)、[OpenScores 官方复核](./openscores-current-player-source-review-2026-10-06.md)及[当前赛季来源官方审查](./current-season-player-source-official-audit-2026-10-07.md)。SofaScore 路线不再重复展开：已有一手审查记录其没有公开可用的数据 API，并限制自动请求、抓取和大规模提取；OpenScores 也已披露其上游 ingest 包含 SofaScore/Flashscore，公开资料没有证明其上游授权链。本轮没有发现能改变上述判断的新一手资料。

## 结论

**Data Sports Group（DSG）是值得争取授权后验证的新增全球 feed 候选；Global Sports Archive（GSA）是 DSG 旗下供公众浏览的足球站点。FotMob 的公开球员页数据较丰富，但不能作为自动采集路线。**

DSG 官网目前营销其足球数据覆盖 1,000 多项赛事，并在页面首屏列出 1,762 项赛事、70 万球员；同页后文又列 1,000 多项赛事、47 万球员，数字口径并不一致。DSG 正式 API 文档列有赛事、赛季、球队、球员、球队名单、球员排名和比赛球员统计接口；一个公开的 GSA 球员档案也展示按赛季组织的出场、分钟、进球、助攻和纪律统计。这里足以支持“潜在扩展面比当前 Understat + ASA mosaic 更大”的判断，却**不能**证明目标联赛当前赛季、每名球员、每个指标的覆盖率或更新时间。账号覆盖、端点版本、API 使用权与数据来源权利仍需供应方确认。

DSG API 是定制报价的付费服务；API 产品页一处宣传免费试用，FAQ 又明确说没有免费套餐。没有看到公开的数据许可条款，无法据此批准本地持久化、交给 Ollama 或其他 LLM、embedding/RAG、公开球员页或派生报告。**建议不接入，不抓 GSA 公共网页；下一步向 DSG 询问一项目标赛事的短期样例/试用、价格和逐项书面数据使用许可。收到并核实后，才做一个赛事、无模型、内存内的 API schema smoke。**

FotMob 的官方页面显示相当丰富的球员赛季字段，但 FotMob `robots.txt` 对通用 crawler 禁止 `/api/*`，其条款禁止自动服务、系统/定期/批量检索，并要求对使用、复制、再分发等用途取得明示书面同意。因此即使网页登录可见、或搜索引擎收录了球员页，也不能推导出可自动采集或用于 TactiScout。

## 来源比较

| 维度 | FotMob（公开站点） | Data Sports Group API / Global Sports Archive |
|---|---|---|
| 来源性质 | FotMob 自有足球比分/统计网站与应用。 | DSG 是面向客户提供 API/feed 的数据供应商；GSA 是其公开足球数据站点，站点页标明由 Data Sports Group 提供。它是商业供应商，不是联赛或球队官方注册名单。 |
| 公开覆盖声明 | FotMob 有赛事球员统计榜和球员档案。没有找到面向开发者的官方 API 文档、覆盖目录或账号 feed entitlement。 | GSA 自称有 500 多项足球赛事的 live coverage。DSG 足球 API 页面列出的赛事数/球员数在同页前后不一致。目标赛事需按实际账户和采购包核实。 |
| 本季证据 | 官方公开赛事统计页和球员档案按赛季展示，能看见当前赛季信息；这是页面观测，不能当成所有目标赛事均覆盖的证明。 | GSA 官方球员档案索引能看到部分 2026 与 2026/27 赛季记录；只能证明有这些当季页面示例。DSG API 文档自身的示例响应多为早期数据，不能证明本日各联赛已更新。 |
| 球员基础字段 | 公开球员页显示年龄、位置、当前球队、分钟和赛季总量/每 90 分钟切换。 | `get_peoples` 文档描述球员标识、姓名、出生日期/年龄、身高、国籍、位置，以及球队 membership、active 状态和 provider 时间戳；`get_squad` 返回球队关联球员。 |
| 表现字段 | 官方球员页样例展示进攻（进球、xG、xGOT、射门）、传球（助攻、xA、传球成功、长传、创造机会）、控球（盘带、对抗、触球）和防守（抢断、拦截、恢复、解围等）；部分赛事/页面还显示跑动距离与冲刺。页面字段在赛事间是否一致、口径和缺失率没有统一公开契约。 | DSG 足球 feed 营销页宣称有球员统计、xG、排行、球员档案和历史。API 的 `get_matches` 示例结构包含球员逐场统计字段族；`get_peoples` 暴露赛季 aggregate（出场/分钟、进球/助攻和牌等）。公开接口文档不足以证明所有赛事都提供同一批高级字段，也未给出这些指标的完整定义、样本门槛或缺失率。 |
| 候选发现、ID 与分页 | 页面可按赛事统计榜浏览，球员页面 URL 含站点内部数字 ID。没有获准/公开的开发者搜索、稳定 ID schema、分页游标或批量导出契约；不得转而试探未公开 API。 | 文档有 `competition_id`、`season_id`、`team_id`、`people_id`、`membership_id` 等 provider ID；技术上可从赛事/赛季/球队/squad 逐层建立候选路径。`get_peoples` 按 `people_id` 查个人档案，不是全局自由文本搜索。文档中 `get_season_team` 和 `get_player_rankings` 被标记为 Deprecated；当前替代路径、完整市场候选发现、分页与批量大小需供应方确认。没有证据表明分页/游标是一个统一、受支持的接口契约。 |
| Freshness | 公开站点宣称自动更新比赛数据；未见球员赛季字段的刷新频率或 SLA。 | API 文档定义响应 `generated_utc`，并在球员、membership、season 和 match 对象中提供 `last_updated` 字段；可用于 smoke 后按记录核验。供应方没有在公开材料中承诺目标联赛的更新时间、延迟或 SLA。GSA 的“自动更新”宣传不能替代逐字段 freshness。 |
| 自动访问与稳定性 | `robots.txt` 禁止通用自动访问 `/api/*`；条款不允许系统/定期/批量读取。 | DSG API 是公开文档化的正式产品，不需要采用 GSA 页面抓取路线。使用需供应商凭据；文档要求密钥保密、二次密码并按域名白名单。方法级共享阈值标为每小时 10,000 次，但目标 account 的实际 entitlement、配额与可用性还需确认。API 文档中 endpoint 版本标注并不完全一致，且部分旧接口已弃用。 |
| 成本与访问 | 普通网页可浏览；没有允许自动化的数据 feed 账户路径。 | API 产品页说价格按运动、赛事和数据包定制、只提供付费套餐；同页“免费试用”入口与 FAQ 的“没有免费层”存在歧义，应向销售确认试用是否可用及其限制。不是可预期的永久免费数据源。 |
| 权利和处理边界 | 未经 FotMob 明示书面同意，不进行自动采集、缓存、模型/RAG 或公开数据展示。 | 公开文档没有说明 API 行数据的本地存储/保留、Ollama/LLM 推理、embedding/RAG、公开球员资料/指标展示、作品集使用、归因、派生指标发布或账号结束后的保留规则；底层赛事/第三方数据权利链亦未核实。应把这些写进销售/许可确认，不从 API 文档或公开网页可见性推断。 |

## 核验事实与未知项

### FotMob

- **已核实（官方页面观测）：**球员页展示赛季表现，可选择总量和每 90 分钟，并列出较细的进攻、传球、控球、防守与部分身体指标；赛事页存在统计榜单与球员链接。[官方球员页示例](https://www.fotmob.com/players/1077894) · [官方联赛统计页示例](https://www.fotmob.com/en-GB/leagues/47/stats/premier-league-20252026/players)
- **已核实（官方访问/条款）：**[robots 文件](https://www.fotmob.com/robots.txt) 将 `/api/*` 对通用 crawler 标为 Disallow；[条款](https://www.fotmob.com/tos.txt) 禁止 automatic services 及 systematic/regular/bulk data retrieval，并写明未取得书面同意不得将数据用于包括抓取、复制、再分发在内的目的。
- **未知：**每项赛事的当季名单完整度、统计字段稳定性、定义/分母、可分页导出能力、字段更新时间、授权 API 或适用于本项目的例外许可。
- **判定：**页面适合人工查阅与用作需求/指标设计参考；当前 NO-GO 自动访问、爬虫、模型输入、RAG、持久化和作品集球员数据展示。只有 FotMob 书面确认并给出许可 feed/API 后才重审。

### DSG / GSA

- **已核实（供应商官方 coverage 页面）：**DSG 足球页列出赛事、球员、球队、比赛的大范围市场声明，说明 squads/player profiles、player stats & xG、player rankings 等可选内容；页面上的覆盖统计数字前后不一致。[DSG 足球覆盖](https://datasportsgroup.com/coverage/soccer/)
- **已核实（官方 API 文档）：**DSG API v3 文档介绍 HTTPS、XML/JSON、账号认证及密钥保密/域名白名单。[API introduction](https://dsg-api.com/introduction/) 文档列有 `get_competitions`、`get_seasons`、`get_squad`、`get_peoples`、`get_matches`、`get_player_rankings` 等足球方法；球员档案按内部 ID 请求，球员资料和球队关系含 `last_updated`。`get_season_team`、`get_player_rankings` 页面明确标为 Deprecated，不能当作无风险的长期依赖。[get_peoples](https://dsg-api.com/doc/soccer/get_peoples/12/) · [get_squad](https://dsg-api.com/doc/soccer/get_squad/11/) · [get_player_rankings](https://dsg-api.com/doc/soccer/get_player_rankings/19/) · [get_season_team](https://dsg-api.com/doc/soccer/get_season_team/5/) · [get_matches](https://dsg-api.com/doc/soccer/get_matches/1/)
- **已核实（官方产品/商业条件）：**API 有 API key/password 认证；产品页表示 access 需供应商账号凭据，价格按赛事/数据包定制，并在同页出现“免费试用”与“无免费套餐”两种说法。[API 产品与 FAQ](https://datasportsgroup.com/products-api/)
- **已核实（官方 GSA 站点观测）：**GSA 自称覆盖 500 多项足球赛事并自动更新比分；站点提供球员/国家/赛事搜索、球员 career/season 页面。[GSA 足球概览](https://globalsportsarchive.com/en/soccer/sport-list) · [公开球员档案示例](https://globalsportsarchive.com/en/soccer/athlete/wilfried-zaha/3945)
- **未知：**本机或任何可用账户能否获得服务；一个账户可买到哪些具体比赛；目标联赛 2026/27 球员池是否完整；逐场/赛季高级字段是否有足够覆盖；新 API 的替代端点与分页；真实更新频率、服务质量及可重复性；条款是否授予任何缓存、存储、AI/RAG、公开展示和派生作品权限；上游第三方数据及个人资料权利是否覆盖本项目。
- **判定：****条件候选（permission/quote first），不准入当前候选池。**比 FotMob 更值得走正式供应商授权路线，但不能因 DSG 对外销售 API 或 GSA 页面可见就假设已有可复用许可。若报价和条款适合个人简历项目，优先考虑本地部署时交由确定性代码计算表现指标，只将获准的摘要提供给模型；这仍须先取得模型处理授权。

## 下一步：给 DSG 的可核验请求

先向 DSG 销售/support 请求一份覆盖一个目标赛事（选当前 mosaic 缺口最大的一项）的书面答复或试用样例，逐项确认：

1. 是否能为个人非商业、可公开展示的简历项目提供 sandbox/trial；具体价格、期限、配额和禁止事项。
2. 2026/27 目标赛事/赛季 ID、当前球队及球员发现路径；是否能覆盖未出场球员，是否有分页/完整性标记；弃用的 `get_season_team` 和 `get_player_rankings` 该替换为何种受支持接口。
3. 该赛事已交付字段清单及其定义/分母：DOB/位置、分钟、进球/助攻、传球/创造、推进、盘带、防守对抗、xG/xA、压迫/跑动；哪些字段会随赛事变化，字段缺失怎样编码。
4. 响应中的 `last_updated` / `generated_utc` 语义、真实刷新节奏、修订/删除机制，以及目标联赛的覆盖和可用性保证。
5. 是否允许服务端短期缓存、长期本地 SQLite 快照、审计数据保留、用本地 Ollama 做推理、创建 embedding/私有 RAG、发布派生指标/球探报告和在公开作品集 UI 显示球员姓名及统计；分别说明终止订阅后的保留规则、归因、logo/照片权利、上游供数权利。

只有得到书面许可并确认可用账户后，才运行单赛事 no-model schema smoke：读取一个赛事/当前赛季目录、一支球队的当前名单、一名由名单 ID 选出的球员档案和一个含球员统计的近期比赛；总计最多四次请求。只保留字段存在性、分页/ID 连贯性、非空率分母、更新时间差等脱敏计数，不落盘球员原始行、不将响应传给模型。该 smoke 只验证接口/字段形状，不自动证明联赛完整覆盖、历史保留、LLM/RAG、展示或上游许可。若供应商不提供适用个人项目的授权或试用，不接 DSG/GSA 数据；继续使用当前已登记且通过各自准入条件的来源。

## 本轮边界

本轮只阅读 `CONTEXT.md`、来源矩阵、已有来源报告、供应方公开网页和官方 API 文档；没有请求 FotMob、SofaScore、OpenScores、DSG 或 GSA 的 API，没有登录、使用 key、抓取网页、保存球员行或使用模型处理球员数据。所有当前赛季结论只针对公开页面/文档能证明的范围，不把厂商覆盖数字或单个示例扩张成完整全球候选池。

## 官方来源清单

- FotMob：[球员页](https://www.fotmob.com/players/1077894) · [赛事球员统计页](https://www.fotmob.com/en-GB/leagues/47/stats/premier-league-20252026/players) · [robots.txt](https://www.fotmob.com/robots.txt) · [Terms of Use](https://www.fotmob.com/tos.txt)
- Data Sports Group：[足球覆盖与统计目录](https://datasportsgroup.com/coverage/soccer/) · [API 产品、报价和 FAQ](https://datasportsgroup.com/products-api/) · [API v3 文档](https://dsg-api.com/introduction/) · [足球 `get_peoples`](https://dsg-api.com/doc/soccer/get_peoples/12/) · [`get_squad`](https://dsg-api.com/doc/soccer/get_squad/11/) · [`get_matches`](https://dsg-api.com/doc/soccer/get_matches/1/) · [`get_player_rankings`](https://dsg-api.com/doc/soccer/get_player_rankings/19/) · [`get_season_team`](https://dsg-api.com/doc/soccer/get_season_team/5/)
- Global Sports Archive：[足球赛种与站点说明](https://globalsportsarchive.com/en/soccer/sport-list) · [球员档案页示例](https://globalsportsarchive.com/en/soccer/athlete/wilfried-zaha/3945)
