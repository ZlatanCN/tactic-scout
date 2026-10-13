# 数据来源与使用边界

本文保留各 provider 的数据范围、获取步骤、字段口径和权限状态。产品范围仅限男足；网页可访问不代表允许留存、模型处理或公开展示；每项来源均按本文记录的状态处理。项目入口见 [README](../README.md)。

## 数据来源

数据路线是自建可追溯的数据产品：TactiScout 负责数据导入/采集、规范化、指标计算、版本和质量报告，保留底层来源及许可。第一方观察用于补充战术语境，不要求用户手工录完整球员库；观察档位只表示单场主观判断，不包装成统计能力分。首版固定有限的比赛范围和字段覆盖，不声称完整或实时转会市场。

工作台已有“球探观察”入口，可记录比赛中的球队、位置/职责、观看范围、能力维度、观察者 1–5 档判断和具体依据。观看范围可标为完整比赛、部分比赛或剪辑片段；旧记录的范围保持未知。1–5 档是尚未校准的项目暂定量表。观察数据独立于统计快照保存，只在获得授权后进入 Agent/RAG 检索。

仓库提供 `pnpm dataset:refresh`，从 Figshare API 获取固定版本的 Wyscout 开放数据，核对 CC BY 4.0 元数据、文件大小与 MD5，再对本地原始文件计算 SHA-256 并构建快照。`pnpm dataset:build` 仍可在已有原始文件上离线重建。当前数据覆盖 2017/18 五大联赛 1,826 场比赛、98 支球队、2,561 名球员；它不是现役候选池。原始数据与 TactiScout 快照都留在 Git 忽略的 `.data/`，不随代码提交。

运行自建历史快照时，将 `TACTISCOUT_DATA_MODE=curated` 写入 `.env`，并先运行 `pnpm dataset:refresh` 生成本地快照。确认来源与本机模型使用范围适用于你的场景后，再显式设置 `TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED=true`。Agent 和最终报告会说明快照赛季、指标口径与来源，不会把历史球队、年龄或表现说成当前事实。该快照用于复现历史表现分析；支持当前球员推荐仍需接入一份覆盖足够且允许项目用途的近季来源。

不把对球探网站批量抓取当成默认路线；来源必须支持项目所需的获取、保存、计算和模型处理用途。当前没有免费、许可清楚、最新、覆盖主要联赛且含细粒度能力指标的单一来源。StatsBomb 2023/24 德甲开放样本只有 34 场，适合特定案例分析，不足以作为完整联赛候选池。完整路线和候选数据集调查见 [issue 40](../.scratch/tactiscout-mvp/issues/40-tactiscout-owned-scouting-dataset.md) 与[自建数据集调查](../.scratch/tactiscout-mvp/research/self-built-scouting-dataset-feasibility-2026-10.md)。

API-Football 可用一个受限的本机 smoke 检查账户是否能读某联赛近季球员统计；它尚未接入候选调查。设置 `.env` 中的 `API_FOOTBALL_API_KEY`、`API_FOOTBALL_LEAGUE_ID` 和 `API_FOOTBALL_SEASON` 后运行 `pnpm source:smoke:api-football`。命令最多发出 3 次顺序请求，只输出账户方案/剩余额度、联赛覆盖、首屏分页和指标字段完整度；不打印球员姓名或原始响应、不保存数据，也不调用模型。免费赛季覆盖必须按账户实查；[官方条款](https://www.api-football.com/terms)未授予在应用或网站发布 API 数据的许可，所以这项检查不会启用公开数据展示。

PitchAPI 当前只有本地技术 smoke，不是已准入 provider。官方文档宣称涵盖 77 个联赛、提供逐场球员统计和高级指标，但返回数据由独立服务条款管理；官方 SDK 页面提示此条款存在，公开文档尚未提供可审查链接。设置 `.env` 中的 `PITCHAPI_API_KEY` 后运行 `pnpm source:smoke:pitchapi`，默认最多读取英超最新 3 场已结束比赛。命令只汇总样本数和指标字段非空覆盖，不打印球员身份、统计值或原始响应，不保存数据，也不调用模型。即使 smoke 成功，在核实服务条款前也不会把 PitchAPI 接入 LangGraph、公开展示或持久化数据。[PitchAPI API 文档](https://pitchapi.dev/) · [获取 API key](https://pitchapi.dev/get-api-key) · [官方 SDK 的数据条款说明](https://pypi.org/project/pitchapi/)。

OpenScores 目前是一个 MCP 技术候选。官方条款允许在产品和 Agent 工作流中使用 API、应用内转换与展示；公开工具说明含球队当前赛季阵容，但没有给出球员能力统计字段字典，也没有公开解释上游采集来源的授权链。[MCP 文档](https://openscores.ai/docs) · [条款](https://openscores.ai/terms) · [来源复核](../.scratch/tactiscout-mvp/research/openscores-current-player-source-review-2026-10-06.md)。官方文档说明球队搜索覆盖数据库中的所有球队，因此本机 smoke 只核实一支按名称全局搜索到的球队及其 profile/squad，不把它与用户指定联赛关联，也不宣称名单完整或当前赛季已验证。若想核实本机账号实际返回形状，在 `.env` 中设置 `OPENSCORES_API_KEY` 后运行 `pnpm source:smoke:openscores`；命令使用官方 MCP Streamable HTTP 端点，最多依次读取工具目录、一次球队搜索和一份球队 profile。输出仅含工具名与字段覆盖计数，不会显示球员信息、保存响应或调用模型。当前未接入招募案件、LangGraph 或正式候选池。

SoccersAPI 当前也只作为本地有限 smoke 候选，不进入 LangGraph。免费账户可选择最多 3 个联赛并有每日请求额度，球员赛季数据按球员 ID 单独查询；详细战术指标是否覆盖当前赛季仍未知。[官方计划说明](https://docs.soccersapi.com/guides/plans-and-data-access/) · [球员统计接口](https://docs.soccersapi.com/stats/player/) · [准入复核](../.scratch/tactiscout-mvp/research/soccersapi-current-player-statistics-source-review-2026-10-09.md)。设置服务器端 `.env` 中的 `SOCCERSAPI_API_KEY` 和精确联赛/国家代码后，运行 `pnpm source:smoke:soccersapi`。命令最多串行发出 9 次请求，检查 provider 标记的当前赛季、一个球队名单和最多五名球员的少量统计；只输出来源范围和字段覆盖数，不输出球员明细、不保存数据、不调用模型。完整当前季覆盖、刷新频率、本机持久化、Ollama/RAG 与公开展示权仍未核实。

第一方观察使用[单场采集规程](scouting/first-party-observation-protocol.md)：建议先用单一赛事/赛季的 6 名中锋做 12 条球员—比赛样本，并对 3 条样本进行独立双人记录。工作台显示记录数、比赛上下文完整度和能力维度覆盖；小样本只用于案例比较，不代表球员市场或评分信度。

## 新候选路线

2026-10-09 对 NCAA 2026 男足官方统计榜与 Football Web Pages API 的复核发现，它们分别可能增加美国大学足球与英格兰基层赛事线索，但都没有通过本地留存、本地 Ollama/RAG 和公开作品集展示的准入要求。没有调用 API 或抓取球员行。只有获得正式 feed 和逐项书面许可后才继续评估；详细字段、条款和最小授权步骤见[来源路线调查](../.scratch/tactiscout-mvp/issues/118-screen-new-authorized-source-leads.md)及[研究报告](../.scratch/tactiscout-mvp/research/new-authorized-player-source-route-2026-10-09.md)。

同日复核的 [Liga MX 官方统计页](https://ligamx.net/cancha/estadistica)显示 2026 Apertura 的进球、分钟和纪律榜，并有带球员 ID/NUI 线索的个人页；但没有完整球员池承诺、公开 API 合约、稳定身份 schema 或更新时间 SLA。页面保留权利并限制复制，本地留存、Ollama/RAG、派生报告和具名作品集展示均未获证明。当前只保留为人工核对来源，不抓取或接入；详见[issue 122](../.scratch/tactiscout-mvp/issues/122-liga-mx-current-player-source-screen.md)及[研究笔记](../.scratch/tactiscout-mvp/research/current-player-open-data-frontier-2026-10.md)。

<details>
<summary>展开：已有历史与实验数据适配器的配置参考</summary>

接入 StatsBomb Open Data 的历史样本实验时，先准备本地数据集，并在 `.env` 设置：

```env
TACTISCOUT_DATA_MODE=statsbomb
TACTISCOUT_STATSBOMB_DIR=./data/statsbomb-open-data
TACTISCOUT_STATSBOMB_COMPETITION_IDS=11
TACTISCOUT_STATSBOMB_SEASON_IDS=90
TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED=false
```

赛事和赛季 ID 只是格式示例，请根据数据集文件选择。加载器只接受官方 `competitions.json` 中精确赛事/赛季的 `competition_gender: "male"` 记录；女子或缺少性别元数据的赛事即使未设置赛事白名单也会被排除，不根据名称猜测。StatsBomb Open Data 覆盖部分赛事/赛季，不是完整职业球员数据库，也不能核实当前完整阵容、合同、预算、潜力或身体属性。比赛文件只列出该数据集实际收录的比赛；除非与独立赛程核对，否则不能称作完整赛季覆盖。适配器的 `eventDataComplete` 只表示该球员在已收录出场比赛中都有非空事件数据，不能证明球员参加过该季全部比赛，也不能证明该赛事/赛季所有比赛都已收录。使用前先在 StatsBomb Resource Centre 注册并阅读[官方数据使用协议](https://github.com/hudl/open-data/blob/master/LICENSE.pdf)。协议没有明确授权云端 LLM 处理；默认设置会阻止 Agent 使用 StatsBomb。只有在确认协议适用于你的用法、明确开启 `TACTISCOUT_STATSBOMB_AI_PROCESSING_ALLOWED=true`，并把 `OPENAI_BASE_URL` 配置为 `localhost`、`127.0.0.0/8` 或 `::1` 等本机回环地址后，Agent 才会处理这些数据。不得将原始事件数据提供给第三方或随项目分发。公开、分享或分发基于数据的分析时，须标明 StatsBomb 来源并使用[官方 Media Pack logo](https://statsbomb.com/media-pack/)；商业用途不在该原型许可范围内。[官方 Open Data README](https://github.com/hudl/open-data)。

StatsBomb 适配器只在比赛事件和阵容覆盖完整、球员射门能对应到该场阵容、且分钟区间顺序连续时生成非点球 xG 证据：每 90 分钟非点球 xG，以及每次非点球射门的平均 xG。它聚合 `shot.statsbomb_xg`，排除点球和点球大战；缺少射门类型或有效 xG 时不生成该球员的 xG 证据，不把缺失值补成 0。阵容末段标记为 `Final Whistle` 但结束时间为空时，适配器用该场非点球大战时段的最后事件时间补足；缺少、空白或不完整的阵容会使对应赛事/赛季范围的 xG 证据不可用，缺少球员阵容记录或分钟区间逆序、重叠、不连续时则不发布该球员的 xG 证据。报告保留赛事/赛季、来源字段、出场分钟、样本场次和非点球射门数。这些是 StatsBomb 单次射门 xG 的 TactiScout 聚合统计，不等于终结能力评分或未来表现预测；它们不会自动进入职责评分。[StatsBomb xG 定义](https://statsbomb.com/soccer-metrics/expected-goals-xg-explained/) · [官方数据 schema](https://github.com/hudl/open-data/tree/master/doc)。

FBref 暂不属于可由 Agent 使用的数据路线。Sports Reference 的 [Data Use](https://www.sports-reference.com/data_use.html) 和 [Terms of Use §5](https://www.sports-reference.com/termsofuse.html) 明确限制未经许可将内容用于 AI prompting、指令、模型输出和评分；非商业用途本身不构成许可。当前 LangGraph turn gate 在读取案件 checkpoint、候选数据或调用 Planner 前拒绝 FBref，并返回 HTTP 503；没有自助环境变量可覆盖这项来源门控。仓库仍保留 adapter 和回归夹具，但不要把 `TACTISCOUT_DATA_MODE=fbref` 用于新抓取、重试、浏览器伪装或其他访问限制绕过，也不要将相关内容用于模型/RAG 或公开展示。2026-10-04 的 HTTP 403 是该次请求的终止信号，不是来源永久下线的证明。[2026-10-12 官方来源复核](../.scratch/tactiscout-mvp/research/fbref-route-revalidation-2026-10-12.md) · [免密男足数据源复核](../.scratch/tactiscout-mvp/research/current-no-key-men-player-sources-after-fbref-403-2026-10-11.md) · [官方 bot 流量说明](https://www.sports-reference.com/bot-traffic.html)。

Fantasy Premier League（FPL）适配器仅为复现既有实验而保留，不是可用的自动数据路线。2026/27 官方条款 §28(d) 禁止自动系统访问游戏并提取信息，§29 声明英超拥有游戏数据的知识产权。因此不要把 `TACTISCOUT_DATA_MODE=fpl` 用于新的自动请求、缓存、模型/RAG 处理或公开展示。应用会在招募案件开始时返回 HTTP 503，并在读取 checkpoint、候选数据或调用 Planner 前停止；本机模型地址不能覆盖此来源门控。此前保存的 FPL Harness 记录只说明当时的工程链路行为，不证明数据使用获准；也不要把它宣传为当前支持的数据源。来源复核和一手条款见[2026-10-11 免密男足数据源调查](../.scratch/tactiscout-mvp/research/current-no-key-men-player-sources-after-fbref-403-2026-10-11.md)、[公共球员目录](https://fantasy.premierleague.com/api/bootstrap-static/)与[2026/27 游戏条款](https://fantasy.premierleague.com/help/terms)。

Premier League Pulselive provider 是一个单一英超当前赛季表现源。在 `.env` 中设置 `TACTISCOUT_DATA_MODE=premier_league` 启用；默认在 API 进程内缓存 15 分钟，可用 `TACTISCOUT_PREMIER_LEAGUE_CACHE_TTL_MS` 调整。赛季默认为当前 UTC 赛季，也可通过 `TACTISCOUT_PREMIER_LEAGUE_SEASON_ID` 指定起始年份。适配器合并来源球员目录和九类统计榜，并按球员 ID 与同赛季球队名单连接出生日期；只映射实测返回的进球、助攻、关键传球、成功盘带、抢断、成功抢断、拦截、恢复球权、向前传球和空中对抗胜出。所有次数指标按来源分钟归一到每 90 分钟；缺失值和零分钟样本不补零。它不是全球转会市场或完整注册名单，位置仅为门将/后卫/中场/前锋宽组；当前接入没有可用 xG、渐进传球、压迫、身价、预算、合同或伤病字段，普通向前传球不能代称渐进传球。底层 Pulselive JSON 路由没有公开开发者 schema 或稳定性 SLA；抓取失败时 Agent 会报告来源不可用，而不是报告零匹配。[Premier League 球员统计口径](https://www.premierleague.com/en/stats/clarification) · [当前赛季统计页](https://www.premierleague.com/en/stats?se=85)。

```env
TACTISCOUT_DATA_MODE=premier_league
TACTISCOUT_PREMIER_LEAGUE_SEASON_ID=
TACTISCOUT_PREMIER_LEAGUE_CACHE_TTL_MS=
```

American Soccer Analysis（ASA）是当前赛季表现数据 provider。在 `.env` 设置 `TACTISCOUT_DATA_MODE=asa` 即可启用；默认缓存 15 分钟，可由 `TACTISCOUT_ASA_CACHE_TTL_MS` 调整。TactiScout 只纳入 MLS、USL Championship 与 USL League One，并按赛事、球员、球队和赛季 ID 精确合并 xGoals、xPass 与 Goals Added 记录，提供来源字段、样本分钟、本机读取时间和宽位置。2026 年 MLS Next Pro 的 xGoals 返回超过 1000 行，超过本项目当前完整性保护上限，因此不纳入候选池。

ASA adapter、默认搜索和通用 `USL` 组均只读取本产品支持的 MLS、USL Championship 与 USL League One；其它 ASA 赛事会在候选入口之外排除。跨赛事百分位只在同赛事、同赛季与同位置组内计算；不能将不同赛事的原始表现值直接当作同水平比较。Goals Added 按来源动作价值定义展示，不进入 TactiScout 职责评分；平均纵向传球距离不等同于渐进传球。这个表现池不是完整注册名单或全球转会市场，也没有合同、身价、预算、伤病或转会可行性字段。ASA 要求为公开数据提供署名和链接；目前未找到明确覆盖公开逐球员展示、任意留存或 LLM/RAG 使用的数据许可，本 provider 不把此数据打包进仓库。接口没有记录级更新时间 SLA，因此本机读取时间不表示来源实时性保证。

Understat 是当前赛季五大联赛表现源。在 `.env` 设置 `TACTISCOUT_DATA_MODE=understat` 启用；适配器按顺序读取英超、西甲、德甲、意甲和法甲公开联赛页使用的 JSON 路由，进程内缓存默认 30 分钟，可通过 `TACTISCOUT_UNDERSTAT_CACHE_TTL_MS` 调整。实测映射进球、助攻、关键传球、xG、npxG、xA、射门、xGChain 与 xGBuildup；每 90 分钟指标按来源分钟计算，平均射门 xG 按来源射门数派生，并保留来源字段、联赛、赛季、分钟/场次、来源页和本机抓取时间。2026-10-11 一次顺序读取观察到 2,164 条 2026/27 球员赛季记录，覆盖五项配置赛事；这是当日表现样本，不代表完整注册名单。未指定联赛时，候选页按联赛轮转，避免分页顺序固定偏向单一联赛。位置只映射到门将/后卫/中场/前锋宽组；来源没有出生日期，因此年龄上限条件会明确中止查询并请用户决定是否移除，绝不静默把未知年龄当作满足。跨联赛比较仅在同联赛、赛季和位置组内计算。它不是完整注册阵容或全球转会市场，也没有身价、预算、合同、伤病、压迫、推进或转会可行性数据。xG/npxG 是机会估计，不是终结能力；xA、xGChain 与 xGBuildup 不等同于完整创造力。底层 JSON 路由没有公开稳定的开发者 schema 或更新时间 SLA，访问、字段和覆盖可能变化；本机读取时间不代表来源实时更新保证。自动采集、本地留存、模型/RAG 处理、公开展示和再分发权限尚未核实；用户授权的是本地研究原型抓取，不是来源方授权。此次 smoke 仅输出汇总，不落盘原始响应或调用模型；适配器也不将原始响应写入仓库。

```dotenv
TACTISCOUT_DATA_MODE=understat
```

需要把欧洲和北美当前赛季候选放在同一次调查时，设置 `TACTISCOUT_DATA_MODE=mosaic`。支持范围是 Understat 五大联赛与 ASA 的 MLS、USL Championship、USL League One。其它 ASA 赛事会在 mosaic 候选入口之外排除。未指定联赛时，候选页按赛事轮转，且每条球员记录保留原 provider ID，不按姓名或球队名跨源合并。百分位和同组比较只在同一 provider 的来源赛事 ID、来源赛季 ID 与位置组内进行；相同的赛事显示名称不会把不同来源混成同一 peer group，因此不生成跨来源统一实力榜。Understat 没有年龄字段，因此跨来源检索不能执行年龄上限筛选；只有明确限定到 ASA 三项支持赛事时才使用 ASA 的年龄数据。任何来源请求失败都会让本轮候选状态标成未知，避免将部分来源结果误报为完整覆盖。此模式继承 Understat 与 ASA 各自的缓存设置；运行成功不代表自动采集、本地留存、LLM/RAG 或作品集展示已获得来源许可。

**身份边界：** 候选来源记录可以用 Reep 的唯一、有效精确 ID 映射归为同一身份组；报告仍逐条保留并评估原始来源资料，不混合指标或评分。无映射、有歧义或来源缺少稳定 ID 时，各自按独立记录显示；候选组计数不等于完整市场或已核实的注册球员人数。Reep `20261005T180536Z` release 含 5,287 条 Understat `player` 精确 ID bridge；本机 resolver 已导入该 provider 的 5,119 条桥接记录，但同一 release 未发现 ASA bridge。ASA 官方 API 使用自己的 `player_id`，没有证据表明它与 Understat ID 共用 namespace。因此当前 Understat 与 ASA 之间没有经验证的跨来源身份映射；即使两条记录同名也保持分开，不推断它们是同一人或不同人。应用只按精确 provider/namespace/external ID 查询，不按姓名、字段名或数字格式合并。详情见[身份桥接核查](../.scratch/tactiscout-mvp/research/current-provider-identity-bridge-2026-10-10.md)及[Reep coverage](https://reep.football/coverage/)。

**模型处理门控：** Understat、ASA 与 mosaic 的来源处理权限尚未核实，这三种模式的自然语言案件只允许使用 `OPENAI_BASE_URL` 指向本机回环地址的模型，例如本机 Ollama。配置为远程模型时，服务会在读取案件 checkpoint、球员数据或调用 Planner 前返回 HTTP 503。回环模型请求也会拒绝 HTTP 重定向，避免 OpenAI 兼容客户端把包含案件内容的请求体自动转发到另一个地址；但应用无法判断本机模型代理自身是否继续向远程服务转发。本机处理限制只避免应用直接向远程模型发送这些数据，不代表来源已授权自动采集、本地留存、LLM/RAG 处理、公开展示或再分发。

```dotenv
TACTISCOUT_DATA_MODE=mosaic
TACTISCOUT_UNDERSTAT_CACHE_TTL_MS=
TACTISCOUT_ASA_CACHE_TTL_MS=
```

```env
TACTISCOUT_DATA_MODE=asa
TACTISCOUT_ASA_CACHE_TTL_MS=
```

来源：American Soccer Analysis 的 [itscalledsoccer 数据接口与说明](https://github.com/American-Soccer-Analysis/itscalledsoccer) · [ASA 数据应用支持的赛事与归属说明](https://github.com/American-Soccer-Analysis/asa-shiny-app) · [官方 Goals Added 方法说明](https://www.americansocceranalysis.com/what-are-goals-added) · [官方方法论文档](https://www.americansocceranalysis.com/home/2020/5/4/goals-added-deep-dive-methodology)。本地/公开展示时保留 ASA 来源链接与来源指标定义；当前作品集原型没有宣称 ASA API 提供更新时间 SLA 或完整转会市场覆盖。

Sportmonks 是另一个可选 provider。其当前赛季模式从配置赛季逐页读取球队，再读取各队当前名单和该赛季表现。配置前须确认账户套餐包含目标联赛。**2026-10-04 核查的公开套餐页**列出 Starter：每月 €29（年付折算 €24/月），可选 5 个联赛，每实体每小时 2,000 次调用；xG 与 Pressure Index 另列为 €29/月起的附加包。页面还提供付费套餐 14 天试用；服务条款说明试用需要有效银行卡，期满前未取消会扣费。较早文档中的免费联赛覆盖信息可能已过时，应以账户当前 entitlement 为准。[套餐与定价](https://www.sportmonks.com/football-api/plans-pricing/) · [服务条款与试用](https://www.sportmonks.com/terms-of-service/)。例如：

```env
TACTISCOUT_DATA_MODE=sportmonks
SPORTMONKS_API_TOKEN=服务端私密 token
TACTISCOUT_SPORTMONKS_SEASON_IDS=当前赛季 ID,另一个已授权联赛的当前赛季 ID
TACTISCOUT_SPORTMONKS_COVERED_STATISTIC_TYPE_IDS=
TACTISCOUT_SPORTMONKS_AI_PROCESSING_ALLOWED=false
```

在启用应用 provider 前，可设置本机 `SPORTMONKS_API_TOKEN` 与 `TACTISCOUT_SPORTMONKS_SMOKE_SEASON_ID`，运行 `pnpm source:smoke:sportmonks`。它最多检查一个当前赛季和一支球队，最多发出四次请求；赛季未明确标为当前时会在读取球队或球员前停止。命令只输出数量与字段覆盖，不打印球员姓名或单项统计、不保存数据，也不调用模型。该 smoke 不验证或授予公开展示、数据保留或模型处理权限，正式 provider 的模型处理开关仍保持关闭。

`TACTISCOUT_SPORTMONKS_COVERED_STATISTIC_TYPE_IDS` 必须按你的 Sportmonks 账户、联赛和订阅确认后填写；空值或未确认的指标不会被当作套餐已覆盖。当前映射支持 52 进球、79 助攻、80 传球尝试、81/116 成功传球、78 抢断、100 拦截、119 出场分钟和 122 长球。缺少某项覆盖配置时，该项不会参与球员评估；分钟字段必须确认可用。API v3 在统计明细中没有返回某个已确认覆盖的计数时按零处理。

`SPORTMONKS_API_TOKEN` 只由 Fastify 服务端读取。启动 Sportmonks 模式前，必须把 `TACTISCOUT_SPORTMONKS_AI_PROCESSING_ALLOWED` 明确设为 `true`；这表示部署者已核实其账户和条款允许将这些数据交给配置的模型处理。公开条款允许在自有产品中存储和展示数据，但本文核对的条款没有专门说明外部 LLM/embedding 处理；权限未确认时不要开启此选项。[Sportmonks 服务条款](https://www.sportmonks.com/terms-of-service/)。

provider 记录保留 Sportmonks 的球员、球队、赛事和赛季 ID，以及取得时间；不同来源 ID 不会按姓名自动合并。单个球员卡会显示数据来源与抓取时间。当前 adapter 只映射进球、助攻、传球、长球、抢断和拦截；不把成功盘带当成带球推进，也不把关键传球当成射门助攻。未覆盖的指标标为暂无数据，不会变成零或参与对应职责的适配计算。[球员统计字段](https://docs.sportmonks.com/v3/definitions/types/statistics/player-statistics)；该 API 不提供 GPS/追踪类距离、冲刺或速度数据。[统计说明](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/statistics/players-statistics)。

Sportmonks adapter 的 endpoint 映射和 fixture 测试不依赖在线服务；真实联赛、套餐权限和返回字段仍须使用用户自己的 API token 验证。没有完成该账号联调前，不能把 Sportmonks 模式描述为已验证的真实数据结果。

SkillCorner Open Data 可作为可选的历史指标样例。它包含 2024/25 澳大利亚 A-League 的 physical、passing 和 off-ball-run 球员赛季 aggregate CSV。运行 `pnpm dataset:refresh:skillcorner` 可从固定的官方 Git commit 获取这三个文件，逐个核对来源字节数与 SHA-256，并在 `.data/skillcorner-open-data/provenance.json` 记录版本、署名、来源链接和校验值。CSV 与 provenance 都留在 `.data/`，不提交到仓库；命令不会开启 SkillCorner 模式或任何应用权限开关。

设置 `TACTISCOUT_DATA_MODE=skillcorner` 前，必须分别确认并设置 `TACTISCOUT_SKILLCORNER_LOCAL_STORAGE_ALLOWED=true`、`TACTISCOUT_SKILLCORNER_AI_PROCESSING_ALLOWED=true` 和 `TACTISCOUT_SKILLCORNER_REPORT_DISPLAY_ALLOWED=true`。SkillCorner README 称样例数据由 SkillCorner 与 PySport 开放发布并请求署名，但仓库 MIT 文本没有明确说明这些球员级 CSV、LLM 处理或公开作品集展示的适用范围；相关权限未确认时，三项开关都保持 `false`。当前只读取以下可追溯指标：每 90 分钟高强度跑动/冲刺距离与次数、每 30 分钟持球的身后/套边跑动与穿线传球、向跑动传球成功率。每条报告保留原始字段名、provider ID、位置组、赛事/赛季与样本；缺失数值仍是暂无数据。补充指标只作为原始表现证据，不纳入既有职责评分。SkillCorner CSV 只代表历史 A-League 样例，不是当前完整转会市场或欧洲候选池。[官方数据说明](https://github.com/SkillCorner/opendata/blob/master/README.md) · [仓库许可](https://github.com/SkillCorner/opendata/blob/master/LICENSE) · [官方聚合指标归一化教程](https://github.com/SkillCorner/opendata/blob/master/notebooks/tutorials/01_Getting_Started_with_SkillCorner_Data/DATA_NORMALIZATION_BASICS.md)。

Wyscout Open Data 可作为具名历史事件分析数据源。Pappalardo 与 Massucco 发布的公开样本覆盖 2017/18 五大联赛，以及 2018 世界杯和 2016 欧洲杯；本 adapter 默认只保留 `type=club` 的比赛。数据项在 Figshare 标为 CC BY 4.0。手动从 [Figshare 数据集合集](https://figshare.com/collections/Soccer_match_event_dataset/4415000/5)取得 Players、Events、Teams、Competitions、Matches 项，解压至 `.data/wyscout-open-data/`；目录至少包含 `players.json`、`teams.json`、`competitions.json` 和配对的 `matches_*.json` / `events_*.json`。项目不自动下载原始数据，该目录由 `.data/` 忽略。

配置时使用：

```env
TACTISCOUT_DATA_MODE=wyscout
TACTISCOUT_WYSCOUT_DIR=./.data/wyscout-open-data
TACTISCOUT_WYSCOUT_COMPETITION_IDS=
TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED=false
```

按需设置赛事 ID。只有确认配置的模型服务可以处理这些数据后才把 `TACTISCOUT_WYSCOUT_AI_PROCESSING_ALLOWED` 改为 `true`；本机 Ollama 可让原始数据留在本机。候选来源标明 Pappalardo 等人 2019 年数据集与 CC BY 4.0；公开展示派生数据时应附上[论文 DOI](https://doi.org/10.1038/s41597-019-0247-7)、[许可链接](https://creativecommons.org/licenses/by/4.0/)和修改说明。CC BY 不授予隐私或肖像等其他权利。

Wyscout 事件指标映射为：射门事件的标签 101 计进球、标签 301 计助攻、标签 302 计关键传球；传球事件计尝试，标签 1801 计成功传球。旧版数据中的关键传球不是射门助攻，因此射门助攻在此来源中保持不可用。项目还会根据传球起终点的进攻方向 x 坐标推算渐进传球：起终点均在本方半场需前进至少 30 米，跨越中线需至少 15 米，均在对方半场需至少 10 米；换算假设 100 个坐标点对应 105 米。次数/90 和成功率是 TactiScout 派生估计，不是 Wyscout 原生字段；只在相关坐标和成功/失败标签完整时显示。防守端记录 Ground defending duel 子事件次数/90 和标签 703 的明确胜出占比；进攻端另记录 Ground attacking duel 子事件次数/90 和标签 703 的明确胜出占比。两个占比都以恰含 701/702/703 之一的对抗为样本，分母包含中性结果 702；其数值是简化事件分类，不代表抢断成功、过人成功率或盘带成功率。进攻对抗率的分类事件数会明确显示。[Wyscout v2 事件与标签定义](https://support.wyscout.com/matches-wyid-events) · [Wyscout 防守对抗定义](https://dataglossary.wyscout.com/defensive_duel/)。首发球员按 90 分钟、换人按记录分钟近似计算出场分钟；不含补时，也未校正红牌等特殊情况，所以每 90 分钟指标只是近似值。[渐进传球定义](https://dataglossary.wyscout.com/progressive_pass/) · [当前 Wyscout 关键传球定义及旧版兼容说明](https://dataglossary.wyscout.com/key_pass/) · [传球与成功标签定义](https://dataglossary.wyscout.com/pass/)。这些记录只代表 2017/18 历史表现，不是现役球员池、当前俱乐部或转会可行性证据。

Reep 可选本地注册表只用于跨来源身份映射，不提供球员表现、阵容或当前效力证据。需要时，从 [官方数据页](https://reep.football/data/)手动下载同一 release 的 `bridges.csv.gz`、`redirects.csv.gz` 和 release stamp；按页面给出的 `checksums.txt` 核对这两个文件后，再运行：

```bash
pnpm identity:reep import <bridges.csv.gz> <redirects.csv.gz> <release-stamp>
pnpm identity:reep resolve-source understat <player-id>
pnpm identity:reep resolve-source statsbomb-open-data <player-id>
pnpm identity:reep resolve-source wyscout-open-data <player-id>
pnpm identity:reep resolve-playerelo wyscout-open-data <player-id>
```

索引默认写入 `.data/reep/identity.sqlite`，可由 `TACTISCOUT_REEP_IDENTITY_DB_PATH` 配置查询时使用的路径。导入会流式读取 gzip 文件，只收录当前 TactiScout provider 与已知球员 namespace 的精确 ID bridge，并原子替换本地索引；它不会自动下载快照、访问 Reep API 或发送 ID 给 LLM。解析结果会保留 release stamp、来源 bridge 的 ID 与 redirect 状态、目标 bridge 的 ID 与 provider upstream status 和 rung；PlayerElo 冲突结果会列出全部 API-Football target owner，便于核查歧义来源。Reep 标记为 `de_corroborated`/`withheld` 的身份不会被当作已解析。映射只关联身份，不合并球员档案、表现指标、能力评分或推荐。Reep 请求在项目中注明来源和 release stamp；CC0 许可不能替代第三方数据权利说明。[Reep 下载与版本说明](https://reep.football/data/) · [namespace 与 redirect 说明](https://reep.football/get-started/)。

完成本地 Reep 索引后，可选择开启报告中的 Wyscout 历史样本：设置 `TACTISCOUT_WYSCOUT_ARCHIVE_DIR` 指向已下载的 Wyscout Open Data 目录，并在确认展示与本机报告保留范围后，将 `TACTISCOUT_WYSCOUT_HISTORICAL_REPORT_DISPLAY_ALLOWED` 和 `TACTISCOUT_WYSCOUT_HISTORICAL_LOCAL_RETENTION_ALLOWED` 都设为 `true`。该 enrichment 只在结论通过审查后运行，通过当前球员来源 ID → Reep ID → Wyscout player ID 精确关联；它不会按姓名匹配、发送给 LLM、进入能力评分或改变推荐顺序。报告逐条显示历史赛季、赛事、球队、分钟、可用统计、CC BY 4.0 署名及 Reep release/rung。未配置许可、索引或 Wyscout 文件时保持关闭或明确报告缺失；部分 bridge 覆盖会显示为部分匹配，不把无命中当成零表现。Reep 的 provider coverage 是按赛事部分覆盖，[官方覆盖表](https://www.reep.football/coverage/)不能据此推断每名候选人都有历史记录。

FPL 记录携带的 `opta_code` 目前只按实时 payload 观察到的 `p<数字>` 格式，精确查询 Reep `opta/person_numeric`；FPL 没有发布该字段的 schema/语义契约，因此这是一条可复核的观察链路，不应描述为 FPL 官方保证的 Opta 标识。Reep `20261005T180536Z` 已本地导入；667 个 FPL 球员中 656 个解析到唯一 Reep 身份、11 个未解析。当前本地 FPL→Wyscout 档案 smoke 实际返回 90 名有样本球员；目录 ID 命中不等于实际比赛样本命中。[身份桥接核查](../.scratch/tactiscout-mvp/research/fpl-reep-current-player-identity-bridge-2026-10-07.md)

可选的 PlayerElo report-only 信号也只在证据审查后运行：API-Football 来源按原始 ID 直连，其他来源必须经本地 Reep registry 的唯一跨来源映射取得 API-Football ID，再调用 `getPlayer(id)` 并校验响应 ID；不会按姓名猜测。报告保存 Reep release、canonical ID 和 bridge rung。该信号不进入模型、战术评分或推荐排序。启用前必须配置 `PLAYER_ELO_API_KEY`，并将 `TACTISCOUT_PLAYER_ELO_REPORT_DISPLAY_ALLOWED` 与 `TACTISCOUT_PLAYER_ELO_LOCAL_RETENTION_ALLOWED` 显式设为 `true`；默认关闭。本机目前没有完成真实 PlayerElo API smoke，因此该路径的 live 命中率尚未验证。

</details>
