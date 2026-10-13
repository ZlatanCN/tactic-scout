# 男足当前球员表现数据源增量复核

**核查日期：2026-10-13。**目标是检查现有 Understat/ASA 当前季路线与 Wyscout/StatsBomb 历史样本之外，是否有新出现或权限/覆盖实质变化的公开球员表现来源，能够用于 TactiScout 男足球员筛选。重点比较当季时效、赛事/候选覆盖、角色能力字段、机器获取路线，以及本地留存、模型处理和公开作品集展示权。

本轮只检查官方文档、OpenAPI、发布方仓库/许可和服务条款；没有创建账号、调用数据 API、读取或下载球员行、抓取网页、使用凭据或修改应用、provider 数据与 `.env`。工程准入判断不构成法律意见。

## 决定

**没有发现一条今天就能加入默认候选池、同时满足“当前赛季男足覆盖、可靠公开机器获取、足以评估角色能力、允许本地处理并可公开演示”的新来源。保持当前来源分层，不新增 provider。**

- **当前季工程信号：**Understat 的五大联赛 2026/27 统计页在 2026-10-08 的既有只读验证中共观察到 2,121 条球员表现记录，包含 xG/xA、关键传球、xGChain、xGBuildup 等进攻信号。获取路线是网页未公开文档的 JSON 请求，不是发布方承诺的公共 API；抓取、长期保存、送入本地模型/RAG 和公开展示权均未核实。[既有实测记录](understat-current-five-league-live-smoke-2026-10-08.md) · [Understat 官方联赛页示例](https://understat.com/league/EPL/2026)
- **当前季北美信号：**ASA 官方 API 文档仍描述公开、无需认证的 xGoals、xPass、Goals Added 等球员指标；其赛事范围是北美，不是全球转会池。项目于 2026-10-06 做过有界 2026 赛季请求；本轮没有重做数据请求。ASA 的署名请求不是覆盖本地数据库、模型/RAG 或具名公开展示的明确数据许可。[官方 API schema](https://app.americansocceranalysis.com/api/v1/openapi.json) · [既有覆盖审查](asa-current-north-america-coverage-2026-10-06.md)
- **历史分析样本：**Wyscout 官方 Figshare 项目的 2017/18 五大联赛样本已在本机验证为 2,682 个球员-队伍-赛事-赛季记录，并按其 CC BY 4.0 数据项记录出处；这适合历史方法和解析验证，不是当前球员市场。[既有实测与来源许可记录](wyscout-real-data-smoke-2026-10.md) · [发布方数据集](https://figshare.com/collections/Soccer_match_event_dataset/4415000/5)
- **StatsBomb Open Data：**官方目录仍为选定赛事/赛季的静态事件与阵容文件；最新目录没有 2024/25 或 2025/26 赛季标签，包含的近期欧洲男子俱乐部赛季仍止于 2023/24 德甲。事件能支持战术动作研究，但不构成当前候选池或当季球员汇总统计；数据使用还受独立 User Agreement 约束。[官方目录](https://raw.githubusercontent.com/hudl/open-data/master/data/competitions.json) · [目录条款与文件结构](https://github.com/hudl/open-data) · [独立 User Agreement](https://github.com/hudl/open-data/blob/master/LICENSE.pdf)

## 发现的增量候选：Stats API（有文档、未证实可用）

相较 2026-10-06 对该服务的旧记录，本轮官方站点现可见玩家目录、当前球队名单、逐场球员统计和球员赛季统计的 OpenAPI 路径；服务条款也明确允许在账户/计划有效且来源限制允许时，将返回事实用于自己的应用、分析、内部流程和 AI-agent 工具。[OpenAPI：球员目录与赛季统计](https://stats-api.com/openapi.json) · [条款 §28](https://stats-api.com/legal/terms)

**但其公开资料互相矛盾，无法据此认定球员数据已进入可供账户使用的当前产品：**

1. OpenAPI 路径确实声明 `/football/players`、`/football/teams/{team_id}/players`、`/football/matches/{match_id}/player-stats` 和球员赛季统计接口；字段包括出生日期/国籍/身高资料、上场分钟、评分、射门、进球/助攻、传球/关键传球、抢断、拦截、对抗和盘带。但其顶层描述与 tags 只列赛事、赛季、球队、赛程/结果和赔率，没有 `Players` tag；schema 也未列渐进传球、渐进带球或压迫字段。接口路径和字段定义不等于已运营的数据覆盖，也不能把基础箱型统计解释成完整战术角色画像。[官方 OpenAPI](https://stats-api.com/openapi.json)
2. 覆盖页一处把“Players & squads”列作可用功能，却同时说“Season player totals”当前不可用；赛季指南展示英超等 2025/26 静态数据和 2026 世界杯，不证明 2026/27 俱乐部男足覆盖。页面没有给出逐项当前赛事球员统计的可核计数。[官方 Coverage](https://stats-api.com/coverage)
3. 官方 Source Ledger 将 CC0 OpenFootball 用于赛程/赛果/赛事/球队，把商业许可的 API-Football 用于赛事、球队、赛程、赛果和球队比赛统计；它没有将球员统计列为已启用数据。台账同页又把 API-Football 列为“未批准转售”，并称其条款禁止直接转售；也未公开说明前述商业协议怎样解决该冲突。变更记录则称 OpenFootball 是唯一已启用来源、当前 12 个操作不含球员功能。[官方 Source Ledger](https://stats-api.com/data-sources) · [官方变更记录](https://stats-api.com/changelog)
4. 定价页宣传 32 个已发布操作，并列球员资料、名单和球员赛季/逐场统计，和“12 个已实现操作且未包含球员”的变更记录不一致；覆盖页还将逐场球员统计列可用、但把赛季球员总计列为不可用。[官方定价](https://stats-api.com/pricing) · [覆盖页](https://stats-api.com/coverage) · [变更记录](https://stats-api.com/changelog)
5. 条款允许 AI-agent 工具使用，但要求遵守逐来源限制；台账列出的已启用来源/用途不含球员表现。API 条款没有明确承诺长期本地保存期限、账户结束后的留存、LLM/RAG 权限如何适用于球员来源，或公开作品集展示球员事实的具体归因/派生规则。[条款](https://stats-api.com/legal/terms) · [Source Ledger](https://stats-api.com/data-sources)
6. 新账户标称可获得 200 次一次性免费请求，之后 Starter 标价为每月 US$19.50；免费配额并非持续开放数据集或可复现的长期免费服务。[官方定价](https://stats-api.com/pricing)

**判断：暂不接入，也不运行 smoke。**它是唯一在本轮发现的“机器接口字段和 AI-agent 条款都有所披露”的新增线索，但缺少公开 2026/27 男足球员数据证据，且其 OpenAPI、Coverage、Source Ledger、Changelog 的功能状态不一致。若将来重新评估，先由服务方书面确认：哪些玩家端点已部署并包含可查询数据；目标男足赛事/赛季的球员覆盖、数据上游来源和更新时间；本地保存与本地 Ollama/RAG；公开作品集中的姓名、数值、派生排名和归因；账号结束后的留存。确认之后才考虑小范围、不送模型的 schema/覆盖核验。

## 已知条件候选没有变成可用新路线

| 来源 | 观察到的/文档化覆盖与指标 | 获取、许可及公开展示 | 结论 |
|---|---|---|---|
| **Understat** | 既有日期化本机样本为欧洲五大联赛 2026/27，指标主要为进球、xG/npxG、助攻、xA、射门、关键传球、xGChain/xGBuildup。样本不证明全注册名单、其他联赛覆盖、年龄或可转会状态。 | 站点未找到公开 API 合约或许可说明。技术上可请求网页所用 JSON，不等于稳定、受支持或授权的 feed；缓存/模型/RAG/公开展示权未核实。 | 可作为明确标注的当前进攻信号，不可宣称已获权利批准或具备完整战术球探指标。 |
| **ASA** | 官方 API 覆盖 MLS、USL Championship、USL League One、MLS Next Pro 等北美赛事，包含 xGoals、xPass、Goals Added 与位置组；不覆盖欧洲转会池。现有 2026 smoke 对 MLS Next Pro 的 xGoals 响应触发 1,000 行完整性上限，必须按现有规则排除该范围；此次没有重读 player rows。 | 无 key API 是可靠技术入口，但 wrapper 的软件许可证不是底层数据许可。ASA 官方应用要求署名；没有明确找到普遍适用的本地留存、模型/RAG、公开逐人展示授权，也没有当前 ASA↔Understat 的精确身份 bridge。 | 保持为范围明确的北美补充；不可把它当成全球球员池，不能跨源按姓名合并。 |
| **foot.io** | 公开 schema 有 304,446 球员资料记录（测量日期 2026-08-06）和赛季统计字段，包括渐进传球/带球、关键传球、成功盘带、抢断/拦截；xG/xA 字段存在但目前没有任何许可层提供。其免费层的 196 项赛事仅表示截至 2026-08-06 至少有当前季比赛，不证明每项赛事有完整球员统计。 | 目前仍为 invite-only closed beta；当前公开价格说明免费层每月 5,000 请求，但 key 需获邀。条款允许在上游许可证允许下做最少缓存及带源署名的 app 事实展示，禁止向第三方分发原始/近原始大子集；未明确确认本地 Ollama/RAG 和公开推荐排名权。[官方文档](https://foot.io/docs) · [数据目录](https://foot.io/data-catalogue) · [条款](https://foot.io/terms) | 能力字段最接近球探需求，仍是条件 NO-GO；申请邀请不等于获得来源特定的模型/公开展示权。 |
| **StatsBomb Open Data** | 当前官网 GitHub 目录有少量旧赛季/赛事事件和阵容文件、部分比赛 360；最新比赛记录元数据可在 2026 更新，但那是旧场次文件更新日期，不是 2026/27 当前赛季。 | 公开下载不等于通用二次分发许可。发布研究需按 README 署名并使用 logo；精确复制、模型处理、公开逐球员输出应按独立 Agreement 核对。 | 用于历史战术方法/离线评估，不能当当前候选池。 |
| **Data Sports Group / GSA** | 厂商宣传覆盖 1,000+ 赛事、47 万球员，并文档化 player stats/xG、球员画像/排名；未找到目标联赛 2026/27 实际逐项覆盖、字段更新 SLA 或本项目账户可用性。 | 商业销售/API，非免费开放；站点没有给当前项目所需的公开长期保存、本地模型/RAG及作品集展示权限。此前已审查，无新的官方变更证据。[官方覆盖](https://datasportsgroup.com/coverage/soccer/) · [官方产品/API文档](https://dsg-api.com/introduction/) | 不重新列为开放路线；仅在预算与书面权利合适时作授权供应商候选。 |

## 观测、推断与未决边界

**本轮直接观察的是发布方材料，不是新采集的球员数据。**Stats API 的字段、费率与允许用途来自其现行网站、OpenAPI 和条款；OpenData 的赛季范围来自 Hudl 官方 `competitions.json`。Understat、ASA、Wyscout 的记录数量来自仓库已完成并标日期的先前验证，不是 2026-10-13 的新一轮实时覆盖验证。

以下仍未知，因此不应包装成已达成：

- Understat 与 ASA 的底层逐行数据是否允许 TactiScout 本地长期留存、Ollama 推理/RAG 及公开作品集逐人展示；项目当前技术接入和用户要求不构成来源授权。
- Stats API 玩家端点是否已部署、对 2026/27 男足开放并含行数据；目标联赛/赛季的实际覆盖率、上游许可、完整名册与更新 SLA；本地保留和公开报告权。
- foot.io 对项目是否发放邀请，目标赛事可读的 player-season 实际覆盖，特定来源对本地模型/RAG/具名排名的权限和数据保留期限。
- StatsBomb PDF User Agreement 对本地长期缓存、生成式模型/RAG和具名公开派生榜单的具体适用边界。

## 建议

1. 当前不新增 provider，不把上游页面或 docs 里的示例数量称为“全球当季球员池”。保留 Understat 与 ASA 作为来源范围明确、更新时间来自实际读取时点的工程信号；按指标族、联赛、赛季和位置分开比较。
2. 保留 Wyscout/StatsBomb 的历史评估用途，并在 UI/简历说明里清楚写明数据赛季；不要与 2026/27 当前表现混排。
3. **若要继续追一个真正有条件的免费许可 API，优先发起 foot.io 邀请与权利澄清；若要试 Stats API，先要求发布方修正玩家端点的当前可用状态并明确上游来源/许可。**没有书面回答前不创建账号、不发请求、不储存球员行或送入模型。

## 既有审计背景

本次优先读取 issue 39（分层球员证据）、111（下一当前表现源）、125（新增开放表现源）和 126（全球球员 feed），并对照以下既有研究以避免重复重开旧候选：

- [当前免费全球球员数据复核](current-free-global-player-data-recheck-2026-10-07.md)
- [开放当前球员源审计](open-current-player-source-audit-2026-10-08.md)
- [下一条来源路线](current-player-source-next-route-2026-10-09.md)
- [全球球员 feed 比较：FotMob 与 DSG/GSA](public-global-player-performance-feeds-2026-10-10.md)
- [本轮 Understat 五联赛验证](understat-current-five-league-live-smoke-2026-10-08.md)
- [本轮 ASA 北美覆盖审查](asa-current-north-america-coverage-2026-10-06.md)

该列表用于说明调查路径；关键数据源事实以上方发布方链接为依据。
