# FBref 403 后的免密男足球员数据源复核

核查日期：2026-10-11。目标是为 TactiScout 比较几条看起来可用的免密、当季男足球员数据路径，重点解释 FBref 403 后该如何处理。只查来源所有者的官方 API 文档、产品条款、发布公告和开源仓库；本轮没有请求 FPL、ASA、OpenLigaDB 或 FBref 的当前球员数据接口，也没有重试 FBref、抓取页面或尝试绕过访问控制。FBref 的 403 来自仓库里 2026-10-04 的既有请求记录，详见 [issue 36](../issues/36-fbref-current-big5-provider.md)。这是一份工程选型记录，不是法律意见。

## 结论

**目前没有查到一条同时满足“当前赛季、欧洲主流联赛或全球球员池、可评估战术能力、无需 key、支持自动检索、并明确允许本地留存/公开展示/LLM 或 RAG”的来源。**免密只说明调用时不需要 API key，不等同于允许自动提取、缓存、模型处理或公开展示。

按本项目目标判断：

1. **FBref 应从自动数据链路停用。**本仓库记录其 Big 5 页面于 2026-10-04 返回 HTTP 403；这次没有重试。官方条款禁止未经许可将站点数据用于 AI prompting，并对影响站点访问的自动化设限；官方 2026-01-20 公告还确认已删除原供应方的高级足球数据。403 本身就是停止信号，不应用代理、cookie、伪装身份或隐藏端点继续取数。
2. **英超官网 Stats Centre 是当前最像“官方、当季、细项足”的人工参考页，但不是已获准的无 key API。**官方页面展示 2026/27 赛季统计，并说明 Opta 采集球员表现；英超的 data-permission 指引把比赛数据使用许可引向 Football DataCo。没有找到给个人作品集使用的公开自动化数据 feed、缓存、LLM/RAG 或公开展示许可。
3. **FPL 的公共目录技术上有当季球员数据，但 2026/27 官方条款明确禁止自动系统访问游戏并提取信息。**仓库 2026-10-07 的 667 条目录记录和既有 Agent 全链路只能证明当时能取到数据、链路能运行，不能证明使用获准。FPL 不能作为自动 Agent 的当前球员源。
4. **ASA 是目前最有用的免 key 技术候选，但只能支持一个窄的北美联赛切片，且数据再利用边界不清。**官方 wrapper 说 API 免费公开、无需认证，覆盖 MLS、USL Championship、USL League One 等北美赛事；公开 schema 有 xGoals、xPass、Goals Added 及位置、赛季、球员 ID 过滤。仓库在 2026-10-06 对 MLS 2026 记录过 xGoals 853 行、xPass 853 行、Goals Added 798 行。它不是完整注册阵容，也没有公开的当前 freshness SLA；ASA 的代码 MIT 许可证不等于 API 返回数据许可证。
5. **OpenLigaDB 是可以按 ODbL 复用的窄补充，不是球探候选池。**官方 API 无 key，并已有 2026/27 德国联赛数据；但射手榜 schema 只有球员 ID、姓名和进球数，缺年龄、位置、分钟、球队归属及其他能力指标。公开使用要履行 ODbL 署名和 share-alike 条件。

所以，若验收目标仍是“帮拜仁、巴萨或其他欧洲球队从当季市场找人”，免 key 路线目前没有合格主源。若愿意把原型收窄为 MLS/USL 球员表现研究，可以继续核实 ASA 的数据权利；在拿到明确的用途边界前，不把它升级成持久球员库或公开 LLM/RAG 生产链路。若要覆盖欧洲当季球员，应获得正式数据许可，或把开发演示限定为已有许可的历史数据与项目自采观察，清楚标注范围。

## 来源比较

| 来源 | 当季男球员池 / 身份 | 能力指标与 schema | 更新和接口 | 留存、展示、模型处理 | 判断 |
|---|---|---|---|---|---|
| **FBref** | 既有研究记录过 Big 5 当季统计页上的球员、位置组、年龄、球队、出场和分钟；这类页面是有表现记录的球员集合，不是完整注册名单。本轮未打开该页面，仓库实际请求在 2026-10-04 得到 403。 | 标准统计仍可用于人工查阅；但 Sports Reference 于 2026-01-20 表示已删除原供数方的高级足球数据，未来如恢复也会显著缩小。不能再按旧教程假设 xG、推进、压迫等高级列齐全。 | 没有公开 API；官方曾说明因数据许可协议不能提供 API。此次 403 不重试；官方 bot 页面中提到的阻断/冷却规则是访问控制，不代表阈值内访问已获许可。[官方数据更新公告](https://www.sports-reference.com/blog/2026/01/fbref-stathead-data-update/) · [官方 bot 流量说明](https://www.sports-reference.com/bot-traffic.html) | 官方条款禁止未经书面许可用站点资料进行训练、微调、prompting 或指导 AI，并限制影响访问的自动抓取；非商业作品集没有被写成例外。[Data Use](https://www.sports-reference.com/data_use.html) · [Terms](https://www.sports-reference.com/termsofuse.html) | **停止自动接入。**保留历史 403 记录作为来源不可用状态，不换路径或重试。 |
| **Premier League Stats Centre** | 官网提供当前 2026/27 英超统计页；范围只有英超，统计条目以有比赛数据的球员为主，不是全球可引援名单。官方说明表现数据由 Opta 采集并分析。[当季 Stats Centre](https://www.premierleague.com/en/stats?se=62) · [数据口径说明](https://www.premierleague.com/en/stats/clarification) | 官方口径页列有出场、分钟、射门、关键传球、长传、抢断、拦截、解围、恢复、对抗等；xG 自 2012/13 起。比 FPL 游戏数据细，但不是每项球探维度，例如预算、合同、伤病、压迫或渐进带球。 | 当前页面可浏览且不需要 key，但未找到官方公开开发者 schema/API 或球员统计 feed 的 SLA。Premier League 对 match-data permission 的指引指向 Football DataCo。[数据许可咨询指引](https://www.premierleague.com/en/news/102426) | 页面公开不等于可自动提取。未找到面向作品集的复制、长期本地缓存、公开逐球员展示或模型/RAG许可；需要按官方指引核实数据许可。 | **人工核查入口，不是免 key 自动 provider。**如果需要英超数据，先走 Football DataCo 正式许可渠道。 |
| **Fantasy Premier League (FPL)** | 仓库记录 2026-10-07 的公共游戏目录有 667 条英超关联球员记录，带当时可观察到的年龄、球队、宽位置和 fantasy 统计；这是游戏目录，不等于英超完整注册名单。接口字段没有稳定、公开的开发者 schema。[既有身份/数据核查记录](./fpl-reep-current-player-identity-bridge-2026-10-07.md) | 当时接口可见进球、助攻和若干 fantasy 派生项（如 xG/xA/xGI）；没有可靠的完整球探指标合同，缺失项不能补成零。 | 技术上是公开无 key endpoint，但无官方稳定 API schema 或刷新 SLA；本轮没有请求数据 endpoint。[公共目录 URL](https://fantasy.premierleague.com/api/bootstrap-static/) | 2026/27 条款 §28(d) 明确禁止“use automated systems to access the Game and extract information from the Game”；§29 声明 PL 拥有 Game data 的知识产权。条款没有给非商业/本地/LLM 使用豁免。[2026/27 FPL Terms](https://fantasy.premierleague.com/help/terms) | **NO-GO 自动检索。**既有代码和 smoke 是工程事实，不应继续对外表述为授权数据源；不要送入模型或公开球员数据。 |
| **American Soccer Analysis (ASA)** | 官方 wrapper 覆盖 MLS、USL Championship、USL League One 等北美赛事；API 有玩家实体/稳定的来源 ID，但表现行不是全量注册 roster。ASA 另有 MLS roster-profile 发布解析项目，包含名单槽位、当前状态等字段；项目示例来自有日期的 MLS roster release，不能代表 2026-10-11 的实时名单。[API wrapper](https://github.com/American-Soccer-Analysis/itscalledsoccer) · [MLS roster-profile 项目](https://github.com/American-Soccer-Analysis/mls-roster-profiles) | 公开 OpenAPI 列有 player xGoals、xPass、Goals Added，可按赛季、分钟、位置、player/team ID 等过滤；位置组包括 GK、CB、FB、DM、CM、AM、W、ST。OpenAPI 对 response body 只给通用 object，具体输出字段要按当前接口响应另外核验，不能把 wrapper 代码许可证当成数据 schema/数据许可。[API schema](https://app.americansocceranalysis.com/api/v1/openapi.json) | 官方 wrapper 声明免费、公开、无需认证。已有 2026-10-06 的项目本机请求记录为 MLS 2026：xGoals 853 行、xPass 853 行、Goals Added 798 行；这是某日响应样本，不是完整 roster 或当前保证。官方材料未找到可承诺的刷新 SLA。 | ASA 的官方 Shiny 仓库“请求”使用公开数据时提供署名和返回 ASA 网站的链接；此为 attribution 请求。`itscalledsoccer` 的 MIT 许可证是 wrapper 代码许可证，不足以证明底层行数据可长期存储、公开再分发或投入 LLM/RAG。[官方署名说明与仓库许可证](https://github.com/American-Soccer-Analysis/asa-shiny-app) | **最实用的免 key 技术切片，但范围和权利均不足以支撑欧洲全球球探。**若使用，仅能先作为 ASA 同联赛、同赛季的表现信号；核实数据许可后才扩大存储、展示和模型使用。 |
| **OpenLigaDB** | API 和官网覆盖当前 2026/27 德国联赛比赛；射手榜只包含有进球记录者，不是俱乐部名单或完整当季球员池。[官方站点](https://www.openligadb.de/) | 官方 `GoalGetter` schema 只有 `goalGetterId`、`goalGetterName`、`goalCount`；没有出生日期、位置、球队、分钟、助攻或非进球表现。[OpenAPI](https://api.openligadb.de/swagger/v1/swagger.json) | 无认证、无 key；官方 API 页面称请节制请求、按 last-change 查询，并公布每 IP 每分钟 60 次限制。OpenLigaDB 是 community project，数据由社区录入，不能描述成 Bundesliga 官方 feed。[API 文档](https://api.openligadb.de/index.html) · [官方站点数据来源说明](https://www.openligadb.de/) | 官方声明 API 数据采用 ODbL。该许可证允许复制和衍生使用，但公开使用需署名，传播数据库或衍生数据库需履行 share-alike。许可证没有单独写 LLM/RAG 规则。[OpenLigaDB license](https://www.openligadb.de/lizenz) · [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | **可作为接受 ODbL 的德甲进球事实补充；不能作为候选池或能力评估源。** |

## 对 LangGraph / Harness 的直接建议

- 在来源选择层区分 `available`、`blocked`、`permission-unverified`、`partial` 和 `not-supported`。FBref 403 要稳定映射为 `blocked` 并立即结束本轮来源调用；不能转为“无候选人”。既有 [issue 37](../issues/37-terminal-source-access-failure.md) 已约定 FBref 遇 403/429 后确定性终止。
- FPL 当前目录即使曾能驱动完整对话，也不能被当作默认回退。不能用“用户不商业使用”推导自动提取许可。
- ASA 可用于验证“免 key + 多阶段 LangGraph 工具编排”是否运作，但报告必须明示只覆盖对应北美联赛、当季出现过的表现样本、字段缺失和来源时间。API docs 没有证明其原始响应能交给本地 Qwen、做 embedding、长时间保存或在公开站点逐人展示。
- 若用户坚持欧洲当季候选、年龄/位置、能力指标及公开作品集演示，下一步应是获得明确许可的数据 feed 或建立明示来源/样本范围的第一方观察数据集。不要用 FPL 的禁自动条款、FBref 的 403 或其它网页抓取来填补这个缺口。

## 依据边界

- FBref 的 403 事实只引用仓库 2026-10-04 运行记录；本次没有验证恢复或访问状态变化。
- FPL 667 行和 ASA 2026 统计行数是此前项目 dated smoke 的结果，不是本轮实时复测，也不代表字段全覆盖或许可。
- 本轮查阅了官方文档、schema、使用条款、许可说明和已发布的 roster-profile 项目说明；没有读取当日 player rows，没有进行网页抓取或访问控制绕过。
- ASA 对长期留存、公众展示、LLM/RAG 的明确授权仍未找到；OpenLigaDB 的 ODbL 允许范围和义务另见其官方许可条款；此记录不对任何法律问题下结论。

## 官方来源索引

- Sports Reference：[Data Use](https://www.sports-reference.com/data_use.html) · [Terms](https://www.sports-reference.com/termsofuse.html) · [FBref/Stathead 2026 数据更新](https://www.sports-reference.com/blog/2026/01/fbref-stathead-data-update/) · [Bot Traffic](https://www.sports-reference.com/bot-traffic.html)
- Premier League：[当季 Stats Centre](https://www.premierleague.com/en/stats?se=62) · [统计口径与 Opta 采集说明](https://www.premierleague.com/en/stats/clarification) · [数据许可咨询指引](https://www.premierleague.com/en/news/102426)
- FPL：[2026/27 Terms](https://fantasy.premierleague.com/help/terms) · [公开目录 endpoint](https://fantasy.premierleague.com/api/bootstrap-static/)
- ASA：[官方 API OpenAPI schema](https://app.americansocceranalysis.com/api/v1/openapi.json) · [`itscalledsoccer` wrapper](https://github.com/American-Soccer-Analysis/itscalledsoccer) · [ASA 数据署名说明](https://github.com/American-Soccer-Analysis/asa-shiny-app) · [MLS roster-profile parser](https://github.com/American-Soccer-Analysis/mls-roster-profiles)
- OpenLigaDB：[API 文档](https://api.openligadb.de/index.html) · [OpenAPI schema](https://api.openligadb.de/swagger/v1/swagger.json) · [官方许可页](https://www.openligadb.de/lizenz) · [ODbL 1.0 条文](https://opendatacommons.org/licenses/odbl/1-0/)

## 2026-10-12 增量核查

本日重新读取 [StatsBomb Open Data 官方 competition index](https://raw.githubusercontent.com/hudl/open-data/master/data/competitions.json)：目录没有 `2024/2025` 或 `2025/2026` 赛季条目。目录中一些旧赛季的 `match_updated` 更新到 2026 年，只表示文件元数据或比赛记录曾更新，不能解释为 2026/27 当前球员表现数据。因此，前一份报告关于“开放目录不能提供当前男足候选池”的决策没有改变。

本日还筛到一份个人发布数据：[The Viking Striker 开放数据说明](https://thevikingstriker.com/data)。作者说明数据按 CC BY 4.0 发布、逐场手工核验并提供修订来源、未知值和缓存头；但发布内容是单一球员的比赛日志，统计字段以出场、分钟、进球和助攻为主，不能形成可比较的转会候选池，也缺少 TactiScout 需要的角色能力指标。它可以作为单个已知对象的来源追溯/字段缺失示例，但不值得接入 Agent，也不会改变当前数据路线。

增量结论：没有发现足以取代历史 Wyscout 展示快照、或能为欧洲主流联赛提供当前宽候选池的免 key 开放源。本轮没有下载数据、访问球员行接口、增加 provider 或改变产品声明。
