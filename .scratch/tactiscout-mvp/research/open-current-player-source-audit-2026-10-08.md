# Premier League Pulselive SDP：当前球员表现来源审查

核查日期：2026-10-08。调查起因是发现社区文档提到 Premier League 网站使用的 Pulselive SDP 后端。社区文档只作为线索；本报告的来源事实以 Premier League 官方页面、官方条款、官方 robots.txt，以及 2026-10-08 本机单次只读、脱敏 HTTP smoke 为准。没有保存响应、向模型提供数据、写入数据库或继续翻页全量抓取。这里的技术 smoke 不构成数据许可意见。

## 决定

**这是值得关注的当前赛季表现源，但不应作为 TactiScout 的自动数据源接入。** 本机直连只读 smoke 确认，Premier League 生产命名空间下的 SDP 主机可匿名返回 2026/27 球员目录、统计榜和俱乐部 squad；响应带有 `x-pulse-sdp-endpoint` 路由标头。实测记录还显示球员目录有数字 ID、球队、国家/地区、姓名和宽位置，统计响应按球员给出多项赛季统计，squad 返回球员资料字段。官方 Premier League 页面独立确认 2026/27 球员目录在用、xG 与丰富的进攻/传球/防守指标，以及这些比赛表现统计由 Opta/Stats Perform 收集。

但 SDP 没有找到 Premier League 发布的开发者文档、稳定 API 合约、公开 schema、配额或 SLA。Premier League 条款保留网站和数据库权利，禁止未经书面许可的再利用、再分发或建立数据库；官方 FAQ 将比赛数据使用许可指向 Football DataCo。当前接口无登录可读，只证明技术上可访问，不代表可自动采集、持久保存、交给 LLM/RAG 或在公开作品集展示。**建议排除自动抓取和 Agent 调用；如希望使用，先经 Football DataCo/权利方取得覆盖数据库、缓存、模型处理及公开展示的明确许可。**

## 技术核验

| 项目 | 证据与观察 | 对 TactiScout 的意义 |
|---|---|---|
| 后端可访问性 | 2026-10-08 本机执行一次无凭据、无 cookie 的只读请求，核验了 host `sdp-prem-prod.premier-league-prod.pulselive.com` 上的 2026/27 player index、player stats leaderboard 与 club squad 路径。均返回 HTTP 200；响应包含 `x-pulse-sdp-endpoint` canonical route、`Cache-Control: max-age=30, stale-if-error=86400`。 | 可见地存在未公开文档的 JSON 服务接口，不等于受支持的公共 API。缓存 header 是 HTTP/CDN 缓存行为，不是统计更新 SLA 或许可。此处为单次样本，不能据此承诺持续可用、字段稳定或低延迟。 |
| 当前赛季与范围 | 官方 Player 页面当前筛选为 2026/27；其球员目录可按俱乐部、位置筛选。官方 Stats 页面也呈现 2026/27 赛季统计。[球员目录](https://www.premierleague.com/en/players) · [2026/27 Stats Centre](https://www.premierleague.com/en/stats?se=85) | 这是**英超单一赛事**数据，不是全球球员池。出现在目录或统计榜不证明完整俱乐部注册名单、当前合同、可转会状态或转会意愿。不能直接替代现有需要跨联赛检索的候选仓库。 |
| 球员身份与资料 | smoke 的目录页大小为 5 条，分页包含 `_next` 游标；样本字段键为 `id`, `name`, `currentTeam`, `position`, `country`。数字 ID 可在官方球员资料 URL 中见到，例如 Haaland 的 `/en/players/223094/...`。[官方球员资料](https://www.premierleague.com/en/players/223094/erling-haaland/overview) | 适合在**英超同一来源命名空间**内关联目录、球队名单和表现；不得将数字 ID 当作跨提供方通用 ID，也不得因名称相同自动连接其他来源。官方网页目录及 squad payload 不构成经过核验的转会数据库。 |
| 统计字段 | 官方指标说明确认球员级出场、分钟、进球/助攻、射门、xG、传球、关键传球、长传/直塞/传中、抢断、拦截、解围、恢复球权、对抗和空中争顶等；广义历史覆盖起点按指标不同，xG 自 2012/13 起。[官方指标说明](https://www.premierleague.com/en/stats/clarification) 本机 leaderboard smoke 观察到按球员组织的 `playerMetadata` 与 `stats` 记录及多项赛季字段。 | 可补充比 FPL 游戏统计更贴近比赛采集的进攻/传球/防守指标。官方页面列出的字段不包括推进传球/带球、压迫或完整 tracking 指标；没有明确字段定义前，不应把普通前向传球等同于 progressive passing，也不能把一两个赛季总量包装成完整战术能力。 |
| 球员身份/阵容 endpoint | 本机只读 squad 请求样本返回 27 人，并含 `dates`, `position`, `height`, `weight`, `preferredFoot` 和 `loan` 等字段。 | 这是样本球队/赛季响应，不代表所有球队均完整或同一字段都可靠；日期字段的精确定义、列表语义及完整 roster 边界未由公开 schema 说明。 |
| 来源、质量与更新时间 | Premier League 说明官方表现数据由 Opta（Stats Perform）收集和分析；实时比赛由分析员采集，赛后还有质量检查。[官方数据采集说明](https://www.premierleague.com/en/stats/clarification) 官方网站条款仍称内容可能过期且不保证准确、完整或及时。单次响应的缓存 TTL 为 30 秒；异常时可 stale 86400 秒。 | 这是有专业采集流程的英超表现数据，但没有公开数据更新 SLA。`max-age=30` 不能解读为比赛数据每 30 秒必更新；质量检查也不意味着零错误。报告应保留赛季、读取时间、赛事和样本分钟。 |
| 接口正式性与稳定性 | 主机名中含 `premier-league-prod`，响应的 `x-pulse-sdp-endpoint` 标头回显了 canonical route；这与官方 Premier League 站点展示的同赛季球员与指标一致。Pulselive 官方网站列 Premier League 为其数字平台客户，Premier League 自己也提到 Pulselive Innovations 管理其平台用户测试。[Pulselive 客户页面](https://www.pulselive.com/our-technology/experience-platform) · [PL 用户测试条款](https://www.premierleague.com/en/terms-and-conditions/2025-26/user-testing) | 这些一手线索支持它是服务 Premier League 的生产数据接口；**不能提升为发布方维护的公共 API 合约**。官方资料没有给该 JSON host 的路线文档、版本承诺、分页契约、速率限额或弃用政策。可能随官网改版而变，当前匿名可用不能作长期架构依赖。 |

## 权利与使用边界

- Premier League 网站条款称官网及 App 受版权、数据库权等保护；只允许合理范围的私人个人下载/打印，以及带来源的私人个人转发；其他使用，包括建立含网站内容的电子数据库、复用、再分发和商业用途，需事先书面许可。[Premier League Terms of Use，知识产权条款](https://www.premierleague.com/en/terms-and-conditions)
- 官方“数据使用联系”页面称比赛数据由 Opta 采集，使用比赛数据（包括 fixture feeds）的许可应联系 Football DataCo。[Premier League：数据许可联系指引](https://www.premierleague.com/en/news/102426) 这比自行把未公开路由称为“免费官方 API”更接近可执行的授权入口。
- 同一官方指标页显示底层来源为 Opta/Stats Perform。公开页面没有单独授予本项目逐球员数据本地持久留存、把响应写入计划/checkpoint、embedding/RAG、本地或云端 LLM 推理、对外派生排名或作品集展示的条款。不要因用户不商业使用、API 不需 key、robots 对 API host 未设规则，推定上述权利。
- 官方 robots.txt 对 `www.premierleague.com` 的配置只显示若干特定查询参数禁止，并未列出一般 stats 路径的显式 disallow；但该文件只给 crawler 路径指示，不是 API 文档或数据许可。它也没有确认 `sdp-prem-prod...pulselive.com` host 可供第三方系统持续抓取。[官方 robots.txt](https://www.premierleague.com/robots.txt)
- 本次检索未发现 Pulselive SDP 的数据许可或单独 API terms。直接请求成功、服务器返回 cache header、同一域名由官网使用，均不能替代权利方授权。

## 建议

| 用途 | 判断 |
|---|---|
| 将官网公开球员/指标页面作为人工术语参考 | **可人工浏览并链接回官方页面**；不要把人工浏览当成数据集导入。 |
| 定时请求 SDP，把 EPL 当前球员和 stats 同步进 TactiScout 数据仓库 | **NO-GO，待书面许可**。公开 API schema、自动获取权利、缓存期限和上游统计授权范围均未建立。 |
| 将响应送入 LangGraph、Ollama、本地向量库或云端模型 | **NO-GO，待明确授权**。不得从 endpoint 可访问性或普通网页条款外推模型使用权。 |
| 在作品集网站展示具名逐球员数值、截图或基于它们的榜单 | **NO-GO，待明确授权**。个人非商业属性不自动消除数据库/再利用限制。 |
| 用这次单次、无落盘、不送模型的只读 HTTP smoke 作工程排查 | **只作为一次技术观察记录**；它不授权复用数据，也不应演变成反复的探测或默认 Agent 工具。 |

**当前路线：** 不增加这个 provider。保留它作为有明确授权前提的候选；如 TactiScout 需要英超逐球员数据，应向 Football DataCo/Stats Perform 咨询可用 feed/API 与用途许可，并一并询问个人项目/公开作品集、离线缓存期限、向本地/云端 LLM 提供字段、RAG/embedding、派生指标展示、署名要求、费率、赛季覆盖与更新 SLA。得到明确书面范围后，再按新 schema 做隔离 provider 验证。

## 来源

- Premier League：[2026/27 球员目录](https://www.premierleague.com/en/players) · [2026/27 Stats Centre](https://www.premierleague.com/en/stats?se=85) · [球员数据字段与采集说明](https://www.premierleague.com/en/stats/clarification)
- Premier League：[Terms of Use](https://www.premierleague.com/en/terms-and-conditions) · [数据使用许可联系指引](https://www.premierleague.com/en/news/102426) · [robots.txt](https://www.premierleague.com/robots.txt)
- Pulselive：[Sports Data / Premier League 客户页](https://www.pulselive.com/our-technology/experience-platform) · Premier League 的 [Pulselive Innovations 用户测试条款](https://www.premierleague.com/en/terms-and-conditions/2025-26/user-testing)
- 生产数据接口 host（无公开 API 文档，链接仅用于说明观测路由）：`https://sdp-prem-prod.premier-league-prod.pulselive.com`。本机只读 smoke 所用路由模板：`/api/v1/competitions/8/seasons/2026/players`、`/api/v3/competitions/8/seasons/2026/players/stats/leaderboard`；它们不是已发布的公共 API 合约。
