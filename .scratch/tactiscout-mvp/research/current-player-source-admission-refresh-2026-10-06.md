# 现役球员候选池与表现数据源：准入复核

核查日期：2026-10-06。仅查阅数据发布方/API 提供方的官方产品页、文档和条款；没有读取本地凭据、调用需凭据的接口、下载球员数据或将球员数据交给模型。价格、覆盖和权利判断只代表本次公开页面状态，不构成法律意见。

## 决策

**结论：目前没有找到一条既能立即接入、又能免费公开部署、持续更新、提供广泛现役球员身份与足够战术表现字段，并明确允许本地 LLM 处理的数据路径。不要把公开网页可读或“非商业简历项目”当成批量采集、留存、模型输入和公开展示的授权。**

**条件 GO：foot.io 是本轮最值得争取的免费 API 路线，但当前只能列为待准入来源。**其官方计划说明 Free 为 $0、每月 5,000 次、每分钟 30 次，当前赛季覆盖 196 项赛事；但服务仍处于 invite-only closed beta，不能自助注册购买，也没有 SLA。可读球员档案与许可门控后的赛季统计具有候选画像和可解释能力指标的潜力；然而公开文档没有证明所需主要联赛的当前俱乐部关联完整，五大联赛阵容与比赛事件当前不在可再分发集合，xG 等字段也不可读。公开条款允许在上游许可允许时于 app 展示带来源署名的单条事实、并作最少缓存；未找到将球员行交给 Ollama/LLM 推理的明确条款。拿到邀请后仍须先验证目标赛事的真实行覆盖、当前效力关联和逐来源许可；LLM 输入权限须单独确认。[计划与 API 状态](https://foot.io/api-landing.html) · [API 字段、许可门控与统计口径](https://foot.io/docs) · [数据目录](https://foot.io/data-catalogue) · [服务条款](https://foot.io/terms)

**当前无凭据/无邀请时：NO-GO 做 live provider 集成；GO 继续做来源准入与失败语义。**先把“当前候选池”“球员表现”“历史事件样本”分别建模；真实 source 还未通过账户、许可、字段覆盖和身份关联验证前，不让 Planner 将其视作可用工具，也不把 fixture 标成 live 验收。

## 来源准入矩阵

| 来源 | 当前数据、时效与候选用途 | 价格 / 访问 | 使用边界 | 判断 |
|---|---|---|---|---|
| **foot.io** | 公开目录列有 304,446 个球员档案，含生日、位置、细分位置、惯用脚和外部 ID；赛季统计目录列有出场、分钟、射门、关键传球、推进传球/带球、射门创造、抢断、拦截、空中球、成功盘带等字段。Free key 只能读当前赛季，统计行按来源许可过滤；页面测量时可读 344,937 条许可通过的历史统计中的当前赛季切片。xG/xA 与 shot-level rows 在任何档位均不提供；转会、伤病、市场估值也未开放。顶级五联赛阵容/比赛事件当前不在可再分发集合。更新按来源和入库任务变化，无统一 freshness SLA。公开目录没有建立五大联赛“球员当前效力球队 → 可用当前赛季统计”的端到端完整度，必须在小样本中验证。[字段/行数](https://foot.io/data-catalogue) · [许可门控/更新时间说明](https://foot.io/docs) | Free 计划标为 $0、5,000 请求/月、30/min、当前赛季 196 项赛事；但 key 目前 invite-only，计划不可自助购买。查询分页硬上限 1,000 行，应用应使用窄过滤和分页。[计划](https://foot.io/api-landing.html) · [认证/配额状态与分页](https://foot.io/docs) | 条款允许在邀请权限和每条上游许可范围内构建产品、缓存最少数据、在应用显示事实并保留来源署名；禁止向外再分发原始数据库或重要子集（约单资源超过 5,000 行或可替代获准访问的数据导出）。条款没有明确回答本地 LLM inference/embedding；不发送数据给模型，除非取得明确答复。[条款](https://foot.io/terms) | **条件 GO，优先申请/等待 beta 邀请。**如果目标联赛没有可用阵容/效力链，不能当作完整候选池；先限于经实测能证明的联赛和统计行。 |
| **Cornerflick Open Match Data** | 官方称每场完赛公开 JSON/CSV、每赛事公开赛季结果文件。单场可得比赛、逐事件球员/助攻、首发与替补/位置、球队统计和来源元数据；每份文件有 `last_updated_at`。这有机会提供有限的当季出场/进球/助攻观察，但没有广泛球员赛季能力数据、生日/当前阵容清单或球员级传球防守统计；赛季文件还会导向每场数据，批量遍历不适合作为默认路线。[公开字段/文件](https://cornerflick.com/data) | 发布页称免费、可下载和复用；这是逐场发布物，不是稳定 API/SLA。 | 发布页称其 compilation 按 CC BY 4.0 发布、可商用但须署名；同页又明确底层比赛事实来自第三方数据商，其许可另行适用。独立 Terms 禁止 scrape/harvest/bulk download，并只授予个人、不可转让的非商业阅读许可；与批量再利用的范围存在需要发布方解释的冲突。不能把“链接到 data.json”扩张成全赛季爬取、镜像或公开原始 feed。[发布页许可说明](https://cornerflick.com/data) · [Terms](https://cornerflick.com/terms) | **NO-GO 作为球员池；有限单场证据也先不自动抓取。**可向发布方确认单场文件的自动读取、缓存与公开展示边界后，再做一场/一个案件的窄验证。 |
| **Sports Data Vault** | 2026/27 ZIP 表列有约 23,961 场比赛、170,173 个球员条目和 1,913,952 条球员统计；含评分、位置、分钟、xG/xA、射门、传球、扑救、事件等。数据每日 09:00 HKT 用前一日数据重建。字段丰富且当前，但页面说明数据采自公开网页/市场 API。[数据表与构建日期](https://www.sportsdatavault.com/en/data/) | 当前赛季 US$19 一次性，赛季期内每日重建更新；月费 US$10，订阅有效时含当前季。[价格](https://www.sportsdatavault.com/en/data/) | 条款将购买数据限定为购买者个人研究/内部分析；禁止再分发、再销售、转授权、发布或重托管文件或其重要部分。提供方不隶属/未获 Livescore 等上游背书或授权。没有公开 LLM 处理许可。[条款](https://www.sportsdatavault.com/en/terms) | **NO-GO 用作公开作品集的数据源。**低价格和字段广度不能替代公开展示与上游授权。 |
| **Big Balls Sports Data** | Free 有赛果、赛程和球队/比赛 stats；文档列球员赛季 stats 为 goals/assists，另有 2025/26 五大联赛 club-form（出场、进球、助攻、分钟）；单赛季平均评分仅 Solo 及以上。季节统计页面最后入库日期列为 2026-09-15，但球员统计季节仍是 2025/26，不是当前 2026/27。免费字段不足以做较深战术角色比较。[球员字段与日期](https://bigballsdata.com/soccer-api) · [套餐](https://bigballsdata.com/pricing) | Free $0：250 次/日（连接 GitHub 后 500）、100/min burst、当前和最近赛季；Solo $19/月。[价格/限额](https://bigballsdata.com/pricing) | 条款允许基于 API 构建产品，但禁止转售原始数据 feed；资料不足以证明公开逐球员数据与模型输入的具体范围。须遵守套餐限制。[条款](https://bigballsdata.com/legal/terms) | **NO-GO 作能力评估主源。**免费套餐易试用，但球员能力字段窄且其文档的 club-form 仍旧一个赛季。 |
| **Stats API** | 免费版当前可读赛事、赛季、球队、赛程与赛果；官方 coverage 将 live events、lineups & players、advanced stats 明列为需要授权 feed/路线图。页面所列主要联赛数据仍为 2025/26；无球员候选池/表现。[coverage](https://stats-api.com/coverage) | 每个新账户一次性 1,000 次免费请求、30/min；Starter US$19.50/月 / 100,000 次/月。[价格](https://stats-api.com/pricing) | 条款明确允许账户有效时将返回的事实数据用于自己的应用、分析、内部流程和 AI-agent 工具；另受每个来源的限制，并未授予队徽、照片等版权。[条款](https://stats-api.com/legal/terms) | **NO-GO 作球员数据源，保留其许可模式作参考。**这是本轮少数明确写出 AI-agent 使用权的 API，但当前可用范围没有球员或阵容数据。 |

## 核心判断

- 扩大来源范围后，foot.io 是最贴近目标的免费公开 API 机会，但“有大量球员档案”和“能为当前转会目标生成经过验证的现役候选池”不是一回事。目标联赛的当前队伍归属、可读统计、来源字段和时间必须逐项验证，不能按 provider 总行数推断完整覆盖。
- Stats API 证明“免费 API + 明确 AI-agent 使用条款”有可能存在；其当前 API coverage 没有球员数据，因此不能解决本项目需求。
- Cornerflick 的发布页许可值得进一步询问，但与网站 Terms 及底层供应商条款之间存在范围冲突；目前不建议将其变成自动赛季爬虫。
- Sports Data Vault 是当前表现字段最丰富的新发现，但所购数据仅供内部研究，不能支撑公开作品集里的逐球员结果或数据快照。Big Balls 适合验证 Agent 调用免费 API 的工程，不够支撑能力评估。
- 因此本轮没有对足以满足问题的公开来源作无条件 GO。`foot.io` 必须先拿到 beta 邀请、确认公开部署和本地模型处理条款，再测目标联赛覆盖；否则保留现有许可明确的历史事件样本作历史 benchmark，并把“现役球员池不可用”如实展示。

## 下一实现切片

**实现一个 foot.io 单联赛只读准入 spike；只有获得邀请和条款确认后才进入联网代码。**这是最短能证伪该免费路线的端到端切片：

1. 选一个免费清单中的当季联赛，按 `players` → 当前季 `player_season_stats` 查询；同时检查公开 schema 是否能以稳定 provider ID 将球员关联到该联赛/当前球队。不得用姓名匹配补缺失关系。
2. 只在一场查询里检查有限页（例如最多 100 名球员），记录候选数、年龄/位置空值、分钟和推进/防守字段覆盖、`stat_scope`、`source`、confidence tier、检索时间与来源 URL。若当前队伍关联或 `stat_scope` 不清楚，返回 `partial/unverified`，不排序。
3. 不写入原始批量数据、不展示队徽/球员照片、不将行交给模型；仅检查应用是否能依法显示少量、逐行有来源署名的事实。模型处理单独等服务方答复。
4. 以一个 LangGraph 案件验证成功、零结果、权限/访问拒绝、数据源失败和字段不足五类结果；失败不可折算为空名单。通过后只为实测覆盖范围启用该 source，不能宣称其是全球或完整的现役转会市场。

当前可以先做的代码工作，是把 provider capability 明确标为 `invite_required`、`llm_permission_unconfirmed`、`current_roster_unverified`，并让 Planner 在 source 未准入时选择历史样本/解释缺口，而非伪装成 live 搜索成功。这与 issue 39 的来源失败、证据边界和“不得以 fixture 冒充 live”验收一致。[issue 39](../issues/39-layered-player-evidence.md)

## 一手来源

- [foot.io API 状态、免费计划、MCP 与 freshness 说明](https://foot.io/api-landing.html)
- [foot.io API 文档：认证、筛选、分页、球员字段、许可门控、`stat_scope` 与 provenance](https://foot.io/docs)
- [foot.io 数据目录：球员/统计/阵容字段与可服务行数](https://foot.io/data-catalogue)
- [foot.io 服务条款 v2.2（2026-08-06）](https://foot.io/terms)
- [Cornerflick Open Match Data：文件结构、CC BY 4.0 与上游来源提示](https://cornerflick.com/data)
- [Cornerflick Terms（2026-05-29）：访问、抓取及第三方比赛数据](https://cornerflick.com/terms)
- [Sports Data Vault 当前季数据字段与日更说明](https://www.sportsdatavault.com/en/data/)
- [Sports Data Vault 数据使用许可](https://www.sportsdatavault.com/en/terms)
- [Big Balls Sports Data Soccer API：球员字段和逐项 freshness](https://bigballsdata.com/soccer-api)
- [Big Balls Sports Data 计划/限额](https://bigballsdata.com/pricing)
- [Big Balls Sports Data Terms（2026-08-10）](https://bigballsdata.com/legal/terms)
- [Stats API coverage](https://stats-api.com/coverage)
- [Stats API 价格](https://stats-api.com/pricing)
- [Stats API Terms：AI-agent 使用许可和来源限制](https://stats-api.com/legal/terms)
