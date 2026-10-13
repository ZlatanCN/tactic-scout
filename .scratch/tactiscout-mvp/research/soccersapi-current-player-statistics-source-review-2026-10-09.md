# SoccersAPI 当季球员数据源复核

核查日期：2026-10-09。针对前几轮来源审查未覆盖的 SoccersAPI v2.2，只查看服务方 API 文档、价格页和服务条款；没有注册账号、调用 API、下载球员记录或修改代码。

## 结论

**SoccersAPI 是新的、值得做小范围技术验真的候选；目前不能作为已准入的公开简历项目数据源。**免费计划可选 3 个联赛，提供球队名单和球员赛季统计接口，当前赛事目录展示 2026/27 赛季；它能补充 Understat/ASA 没有覆盖的联赛，也可能补上阵容、位置、年龄、国籍和基础射门产量。但官方资料没有证明每个联赛当前季球员统计的实际完整度或刷新频率；统计字段不含本项目所需的推进、压迫、创造、争顶等关键战术指标。

最直接的障碍是服务条款：官方条款检索页显示，API 数据归 SoccersAPI，发布/分发须署名，且条款写有不得为公开或商业目的展示、分发或使用材料。条款页面本次打开超时，因此没有核实完整条文如何适用于纯本地、非商业调试。**就可读资料而言，不能确认其足以授权本地持久保存、传给本地 LLM、建立 embedding/RAG 或在简历作品集逐球员展示；也没有核实上游授权链。**技术上私下调用可能可用于尝试，但这不是对本地留存或模型处理的明确许可；在拿到完整可读条款或书面答复前，不应把它作为已准入的数据源。[官方条款](https://soccersapi.com/terms)

## 对候选池的增量与边界

| 项目 | 官方资料可证实内容 | 未证实或不适用之处 |
|---|---|---|
| 球员资料与当季表现 | `teams?t=squad` 可按球队及赛季取得名单；示例含球员 ID、年龄、国籍、身高、位置。`stats?t=player` 可按 player ID 与 season ID 查赛季聚合，也能查单场数据；示例字段含出场/首发、分钟、进球、助攻、牌、越位、换人、点球及射门总数/命中/偏出/封堵。[名单接口](https://docs.soccersapi.com/teams/squad/) · [球员统计接口](https://docs.soccersapi.com/stats/player/) | 球员统计示例是接口 schema 示例，不证明目标 2026/27 联赛已有可用行。未见渐进传球/带球、关键传球、xG/xA、压迫或对抗等深度能力指标。球员统计按球员查询；官方资料未说明一次请求可返回完整联赛球员表现池，广泛逐人读取会受免费额度约束。 |
| 覆盖和新鲜度 | 官方覆盖页列出 1,169 项赛事；入门页示范查询 2026/27 英超赛季。免费计划可在账户中选择 3 个联赛，并提供所有 Standard 数据集。[官方覆盖](https://soccersapi.com/coverage) · [当季示例](https://docs.soccersapi.com/guides/getting-started/) · [套餐与数据集](https://docs.soccersapi.com/guides/plans-and-data-access/) | “覆盖 1,169 项赛事”不等于免费账户可读全部赛事；实际可读范围要以账户返回为准。官方没有给出球员统计字段的刷新 SLA 或逐联赛当前季完整度，并声明缺失数组/null 属于正常覆盖差异。 |
| 访问、价格和接口 | REST/JSON v2.2，账号 API key；支持 Bearer header，官方建议 key 留在服务端。Free 计划为 3 个自选联赛、100 次/日、无需信用卡；当前定价页展示 20 联赛 Basic 档 €40/月（不含 VAT），另有 7 天试用。[入门与鉴权](https://docs.soccersapi.com/guides/getting-started/) · [套餐页](https://soccersapi.com/pricing) | 当前实现若逐个读取数百名球员的赛季行，很可能很快耗尽 100 次/日；需要先用有界样本测请求形状和名单/统计的可用度。 |
| 留存、LLM/RAG、作品集 | 官方条款搜索摘录称发布/分发须署名，并显示公开/商业用途限制。 | 本次打开条款 URL 超时，完整条文与“仅本机、非商业原型调用”的适用关系为**未知**。公开资料没有明确授予本地数据库缓存、本地模型输入、向量化/RAG 或作品集逐球员展示权。不能从免费 key 推断这些权利。[服务条款](https://soccersapi.com/terms) |

## 同轮新候选对照

OpenFootAPI 也有 2026 年推出的 REST/MCP 接口，覆盖 120 项赛事；免费 Starter 只明确列赛事/赛程/积分榜/搜索，Developer（$14/月）增加阵容、事件和 xG。它提供球员进球/助攻榜，但没有与 SoccersAPI 同类的按球员、赛季查询的综合统计表。因此它较不适合本轮“免费扩大当前球员表现池”的目标，尽管其条款对留存和内部模型研究写得更明确。公开输出仍须服从逐赛事上游许可，不能视为无条件公开数据许可。[OpenFootAPI 套餐](https://openfootapi.com/pricing) · [接口/数据范围](https://openfootapi.com/docs) · [服务条款第 7 节](https://openfootapi.com/terms)

## 建议的准入切片

如果要继续评估，只做有界、无模型的验真：选免费账户允许的 3 个目标联赛；核对其 current season ID；记录每队 squad 的人数、年龄/位置/国籍空值；抽样核对球员 stats 的分钟和各计数项是否非空、是否包含明确检索/更新时间；记录所耗 API 请求数。不要将接口文档示例当成 live 验收，不用姓名拼接跨源身份。只有在实测覆盖满足用途，且发布方书面说明持久缓存、本地推理/embedding/RAG、逐球员作品集展示和上游许可范围后，才创建正式 provider issue 并接入 LangGraph 工具层。

## 一手来源

- [SoccersAPI v2.2 球员赛季统计接口](https://docs.soccersapi.com/stats/player/)
- [球队当前/历史赛季阵容接口](https://docs.soccersapi.com/teams/squad/)
- [套餐、可选联赛和数据集范围](https://docs.soccersapi.com/guides/plans-and-data-access/)
- [2026/27 入门请求示例与 API key 处理](https://docs.soccersapi.com/guides/getting-started/)
- [官方赛事覆盖目录](https://soccersapi.com/coverage)
- [官方价格页](https://soccersapi.com/pricing)
- [官方服务条款（页面标注 2025-02-22 更新）](https://soccersapi.com/terms)
