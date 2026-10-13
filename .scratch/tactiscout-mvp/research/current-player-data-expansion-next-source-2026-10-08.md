# 下一条多联赛当前球员表现源：Sportmonks

核查日期：2026-10-08。目标是找到 Pulselive 英超单源之外，最能支持当前赛季球员筛选与能力评估的下一条数据路线。仅核对官方产品/API 文档、官方服务条款与仓库既有准入设计；没有调用 API、使用凭据、抓取或下载球员数据，也没有修改应用代码。本报告是工程选型，不构成法律意见。

## 建议

**优先把现有 Sportmonks provider 做成真实、有限的多联赛数据路径。暂不再新增一个网页抓取器或重新造 API adapter。**

这不是“一个全球权威源”的结论：Sportmonks 是有套餐和账户授权的数据服务商，不是 Premier League、DFL 等赛事组织的官方数据页面。它适合作为本项目下一条结构化当前表现来源，是因为官方文档明确提供按球员、球队、赛季 ID 组织的赛季统计、统计类型字典和球员档案；公开套餐允许选定多个联赛；仓库已经有 provider、来源身份字段和最多四请求的无模型真实账户 smoke。[Sportmonks 球员统计文档](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/statistics/players-statistics) · [官方统计类型字典](https://docs.sportmonks.com/v3/definitions/types/statistics/player-statistics) · [套餐和覆盖](https://www.sportmonks.com/football-api/plans-pricing/) · [现有 provider](../../../src/data/sportmonks-provider.ts) · [issue 48：有界账户 smoke](../issues/48-sportmonks-current-pool-smoke.md)

若要覆盖主要欧洲联赛，现实起点是 Starter 的 **5 个自选联赛，€29/月**，可将英超、西甲、德甲、意甲、法甲作为验证组合；免费计划仅列丹麦 Superliga 与苏格兰 Premiership，不能验证这五个联赛。14 天试用需要绑卡，条款写明如果到期前未取消会自动扣费，故它不是无条件免费额度。价格与覆盖以本次查看的[官方套餐页](https://www.sportmonks.com/football-api/plans-pricing/)和[免费计划页面](https://www.sportmonks.com/football-api/free-plan/)为准。

## 为什么这比继续叠加 Pulselive 更合适

Sportmonks 文档示范球员档案携带原生球员 ID、位置、生日及球队/赛季统计记录；调用可嵌入 `statistics.details.type`，并通过季 ID 过滤。官方类型字典定义了进球、助攻、传球、关键传球、成功盘带、抢断、拦截、空中对抗、分钟、评分、射门等字段。相比目前只覆盖英超的 Pulselive，这条路线能把跨联赛候选和表现查询落在统一的 API 身份与 schema 下，同时保留每联赛的具体统计覆盖检查。[球员统计响应示例和赛季过滤](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/statistics/players-statistics) · [球员统计类型](https://docs.sportmonks.com/v3/definitions/types/statistics/player-statistics) · [领域上下文](../../../CONTEXT.md)

适合 MVP 的能力证据包括进球、助攻、传球总量/准确量、关键传球、抢断、拦截、成功盘带、空中对抗、出场分钟和比赛评分；必须按官方 type ID 与具体账户返回字段逐项验收。当前实现映射范围更窄，主要是进球、助攻、传球、长球、抢断、拦截和分钟；不能因为供应商文档列出字段，就声称当前 adapter 已接入它们。[当前字段映射](../../../src/data/sportmonks-provider.ts) · [issue 20 的剩余 live 验收项](../issues/20-licensed-player-provider-and-provenance.md)

限制也清楚：Sportmonks 官方文档说明没有跑动距离、冲刺、最高速度等 GPS/追踪指标；它给的是有球与事件统计。xG 等高级指标在官网单列为 **xG & Pressure Index** 附加包，当前套餐页从 €29/月起，需先核对价格和账户 entitlement，第一阶段不应把它计入基础方案。供应商也声明可能存在联赛覆盖缺口，不保证完整性、准确性或持续可用性，所以每个联赛仍要显示实际返回范围、赛季和字段缺失。[统计类型边界](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/statistics/players-statistics) · [xG 附加包与套餐说明](https://www.sportmonks.com/football-api/plans-pricing/) · [条款中的覆盖和准确性限制](https://www.sportmonks.com/terms-of-service/)

## 访问与使用边界必须分开

| 问题 | 官方材料能证明什么 | 对 TactiScout 的处理 |
|---|---|---|
| 自动访问 | 这是需账户 API token 的正式 REST API，文档支持用 `api_token` 查询参数或 `Authorization` 请求头传 token；无需抓官网页面。账号套餐决定联赛 entitlement 与请求限制。Starter 列每小时每实体 2,000 次调用；API token 应只由服务端读取。 | 用官方 API，不抓页面；先用 issue 48 的四请求上限检查一个明确标记为 current 的赛季和一支球队。要覆盖五个联赛，就逐联赛进行同样的有界 smoke。不能把 HTTP 可访问或 mock fixture 当作真实账户验收。 |
| 持久保存和自有产品展示 | 条款称可在自有应用中使用服务数据，并允许存储、传输和分发其提供的数据；禁止未经批准直接转售。条款还说数据按 domain 授权、多个 domain 价格可能变化。网页自身的文字、插图、视频则另受个人非商业使用限制。 | 仅按账户/合同范围保留必要数据；确认作品集实际部署域名及逐球员数据展示是否在账户许可内。不要把整份原始响应或数据库公开提交。 |
| 本地 LLM、云模型与 RAG | 在核验到的官方条款和统计文档中，没有找到对将球员行、统计或其派生值传给本地 LLM、云模型、embedding 或 RAG 的明确许可/禁止表述。 | 保持 `TACTISCOUT_SPORTMONKS_AI_PROCESSING_ALLOWED=false`。在获得服务方对本项目用途的明确答复前，不将 provider 数据放进 Planner、Reviewer、LLM prompt 或向量索引。技术可访问和允许模型处理是两项独立判断。 |
| 公开或商业使用 | 条款允许以服务数据构建应用，并允许存储/分发数据，但禁止直接转售；套餐对 domain 有范围。公开页面材料另有版权边界。 | 面向简历的公开 demo 先按目标域名核对账户许可；商业许可与数据处理权不从“非商业项目”或“本地模型”推断。 |

依据：[官方 API 认证文档](https://docs.sportmonks.com/v3/welcome/authentication) · [官方 API 统计文档](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/statistics/players-statistics) · [官方套餐/调用能力](https://www.sportmonks.com/football-api/plans-pricing/) · [服务条款](https://www.sportmonks.com/terms-of-service/) · [代码中的模型许可闸门](../../../src/data/sportmonks-provider.ts) · [issue 20](../issues/20-licensed-player-provider-and-provenance.md)。这些网页讨论的是 API 访问与账户合同；robots.txt 对已认证 API 的字段许可、留存或 LLM 权利不能作替代证明。

## 为什么不把 PlayerElo 选作主表现源

PlayerElo 值得保留为第二阶段的 **report-only 外部评级对照**：发布方称覆盖 176 个赛事、约 79,000 名球员并每日更新；官方说明其个人 Elo 根据比赛结果、对手强度和出场分钟更新，另提供 EAR 状态值及部分 per-90 风格字段。它能补充“不同联赛整体水平/近期形式”的外部信号，却不是来源可复算的当前赛季事件统计；公开 API 示例的个人档案是生涯/12 个月/180 天评级，未展示明确 season filter 或字段级赛季统计覆盖。把它当作基础数据池会把原始球员表现和供应商模型评级混为一谈。[PlayerElo API/价格/端点](https://playerelo.football/api-access) · [API schema 示例](https://playerelo.football/docs) · [官方评分方法说明](https://playerelo.football/player-ratings-api)

还有两个准入问题：免费档明确标为 evaluation & hobby，Pro 才写明适用于 production apps & dashboards；我没有找到公开的通用 API 授权条款，明确回答缓存、公开简历展示、再分发及把值交给本地/云 LLM 或 RAG 的权限。故它适合之后用一联赛小样本做独立评级对照，不优先于已有的原始统计 API adapter。[PlayerElo 计划说明](https://playerelo.football/api-access)

不建议以 SofaScore 等站点页面替代 API。SofaScore 官方条款明确禁止未经同意嵌入、聚合、抓取或复制站点内容；浏览器能看见数据不等于允许批量采集或产品使用。[SofaScore 使用条款](https://www.sofascore.com/id/terms-and-conditions)

## 下一步：先做来源验收，再接入多联赛报告

仓库已有 Sportmonks adapter 和无模型 smoke，故建议下一张 issue/执行切片沿用已有实现：

1. 在本机使用用户自己的 Sportmonks token，确认所选当前赛季确实在套餐范围内。若不产生费用，免费计划可先验丹麦/苏格兰的 API schema；它不代表五大联赛验证。要验五大联赛，选择 Starter 五联赛套餐前，先确认费用与试用自动续费条件。
2. 对每个目标联赛运行有界 smoke，记录检索时刻、赛事/赛季 ID、球队数、样本球队当前名单量、适配器可解析人数和各字段非空人数；不输出个人身份与数值、不落盘、不调用模型。检查跨联赛的球员、球队、赛季 ID 仍保持来源命名空间，且统计口径/分钟值按来源保留。
3. 在小样本无模型对照中确认现有字段映射及每个联赛覆盖率。必要时再扩展 provider 类型映射，但只加真实响应且定义明确的字段；xG/Pressure Index 单独作为可选预算项。
4. 另行确认本地模型处理、公开作品集展示/存储期限与部署域名权限。未确认前保持模型闸门关闭；权限通过后再将有限范围的数据链放进完整 LangGraph 案件，运行 Reviewer 与报告验收。

**停止/回退条件**：如果用户不接受订阅费用，则只用 Sportmonks 免费覆盖做 schema 验证，同时继续把 Pulselive 标为英超单源；不要暗示已覆盖西甲、德甲、意甲、法甲。若套餐 entitlement、当季标志或关键字段在 smoke 中不成立，保留 Pulselive，不把错误映射成零数据。若 LLM/公开作品集权限未确认，则不把 Sportmonks 统计传给模型或公开逐球员展示，即使 REST smoke 成功。

## 项目当前证据

- 根 `CONTEXT.md` 已将 Sportmonks 规定为配置赛季的当前池来源，并要求来源 ID、赛季、抓取时间、字段覆盖和模型许可边界分开记录。[领域上下文](../../../CONTEXT.md)
- [issue 20](../issues/20-licensed-player-provider-and-provenance.md) 的 adapter、fixture 测试与来源身份已实现，但“真实账户验证目标联赛覆盖和响应字段”仍未完成。
- [issue 48](../issues/48-sportmonks-current-pool-smoke.md) 已实现不超过四个请求的本机无模型 smoke；它不持久化结果，也不赋予 LLM 或公开展示许可。
- [issue 39](../issues/39-layered-player-evidence.md) 要求按候选发现、当前表现、历史样本、外部评级及第一方观察分层。Sportmonks 适合下一条当前比赛表现 provider；PlayerElo 如加入，应继续作为不同类别的外部评级，不能按相似姓名或不兼容字段直接合并/计分。

## 官方来源清单

- Sportmonks：[认证与 token 存储建议](https://docs.sportmonks.com/v3/welcome/authentication) · [套餐与 5/30/120 联赛覆盖](https://www.sportmonks.com/football-api/plans-pricing/) · [免费计划实际赛事范围](https://www.sportmonks.com/football-api/free-plan/) · [球员赛季统计接口](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/statistics/players-statistics) · [球员统计字段字典](https://docs.sportmonks.com/v3/definitions/types/statistics/player-statistics) · [服务条款](https://www.sportmonks.com/terms-of-service/)
- PlayerElo：[API 端点/套餐/使用说明](https://playerelo.football/api-access) · [schema 示例](https://playerelo.football/docs) · [评分方法](https://playerelo.football/player-ratings-api)
- SofaScore：[使用条款](https://www.sofascore.com/id/terms-and-conditions)
