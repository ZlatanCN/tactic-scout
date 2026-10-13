# 当前球员数据源下一条路线：iSports API 未通过准入

核查日期：2026-10-09。目标是在既有来源审查之外，寻找一条对当前球员候选发现和赛季表现分析有增量、官方文档可核实、并且用途边界足以支持 TactiScout 的来源。本次只审阅供应商公开产品页、API 文档、FAQ 与服务条款；**没有注册、调用 API、拉取或抓取球员数据，也没有修改应用代码**。本笔记记录工程准入结论，不构成法律意见。

## 结论

**没有找到截至核查日可立即接入、同时证明覆盖 2026/27 当前赛季且允许本项目留存、LLM/RAG 处理及作品集展示的新增来源。**

本轮唯一值得留下的新增技术候选是 **iSports API 的 European Top Leagues 商品**。官方商品页列明英超、西甲、德甲、意甲、法甲，并提供球员档案/名单路径和球员赛季统计 API；字段较基础候选源更丰富，含分钟、进球/助攻、传球、关键传球、长传/直塞、成功盘带、传中、抢断、拦截、解围、被断、封堵与空中对抗。它有潜力把候选搜索从英超扩展至另外四个主要欧洲联赛。

但它**不是已验证的当前赛季源，也不是许可清晰的作品集来源**：季节列表文档只展示 `2026`、`2025-2026` 作为格式示例，并不证明某个目标联赛的 2026/27 球员数据已经可用；实际逐队名单与统计覆盖没有测过；公开条款没有明确授权球员数据的本地持久缓存、公开展示、派生评分发布、送入本地模型、云端模型或向量 RAG。故本轮决定为：

- **立即实施：不接入 iSports。** 当前不把它加入默认 provider、LangGraph 工具或报告链路。
- **可考虑的下一项工作：需先确认用途许可和目标赛季覆盖。** 只有用户决定接受其标示的订阅价格，且供应商书面确认缓存、LLM/RAG、派生报告及公开作品集展示权限后，才做受限的无模型覆盖验证。
- **不要把 15 天试用当作免费长期数据源。** 它只是短期验证窗口，不能支撑部署后的持续刷新。

既有研究已把 Sportmonks 作为可配置的多联赛结构化表现源，但其账户覆盖和授权边界也待验收（见[此前路线审查](current-player-data-expansion-next-source-2026-10-08.md)）。iSports 的新增价值是商品页明确打包五大联赛和较宽球员统计字段；没有证据表明它在用途许可、赛季新鲜度、池完整性或成本上优于 Sportmonks，故不替换既有路线结论。

## iSports API：可证实的增量与证据缺口

| 维度 | 官方资料能确认的内容 | 未能确认的内容 | TactiScout 决策 |
|---|---|---|---|
| 联赛覆盖 | [European Top Leagues 商品](https://www.isportsapi.com/products/detail/football-api-product-184.html?lang=en)明确写出 Premier League、La Liga、Bundesliga、Serie A、Ligue 1，页面列出五个 league ID。 | 商品页品牌总览另称覆盖 2,000+ 联赛/杯赛；这不能推导出所有联赛都有球员档案与赛季球员统计。 | 五大联赛属于明确的商品范围声明，技术上比当前 FPL 英超池广；不是实际完整度验收。 |
| 候选池与球员身份 | 同一商品包含 Player Profile 和 Teamlist with Player Profile；文档说明名单接口列出数据库中有关联球员档案数据的球队 ID，并称为有 active roster 的 team IDs；球员档案接口建议先列球队 ID，再获取 squad profile。([名单文档](https://www.isportsapi.com/en/docs.html?id=246) · [商品接口列表](https://www.isportsapi.com/products/detail/football-api-product-184.html?lang=en)) | “active roster”是供应商对其数据表的描述，未承诺与官方注册名单完全一致；未说明无赛季出场球员是否会出现在赛季 stats 端点；球员 profile 中年龄/位置字段需看真实 schema 和样本确认。 | 可能能建立 roster 候选池，但覆盖完整性、年龄/位置可用性和 profile↔stats 联结均未 live 验证。不能直接评分。 |
| 赛季表现 | [Player Stats (League & Cup)](https://www.isportsapi.com/docs.html?id=51)按 league ID 返回球员赛季统计，要求 Stats 计划。文档字段包括出场、替补、分钟、非点球进球、点球、射门、射正、评分、传球/成功传球、关键传球、助攻、长传、直塞、成功盘带、传中、抢断、拦截、解围、被断、封堵、空中对抗、犯规和牌；主客场拆分，要聚合成总计。相较 FPL 的宽泛 fantasy 属性，此 schema 提供若干更有球探价值的过程指标。 | 文档没有 progressive passes/carries、pressures、xG 或 tracking 跑动；字段定义没有提供更细分的比赛情境。接口记录不等于覆盖名单中的每个球员。 | 作为基础/中级事件统计有增量；不能宣称为完整的战术能力模型。缺失指标应保留 unknown。 |
| 当前赛季与刷新 | [List of Player Stats 文档](https://www.isportsapi.com/docs.html?id=49)列出“可获取球员赛季统计的联赛”，`season` 的例子包括 `2026` 与 `2025-2026`；文档建议每日调用一次。球员赛季统计返回 `modifyTime`。 | 示例值不是 2026/27 覆盖承诺，也没有 2026/27 数据可用清单或目标联赛 SLA。文档更新时间（页面注明 2026-06-29 / 2026-08-03）是文档时间，不是球员数据刷新证明。每日调用建议也不是刷新承诺。 | 对当前季状态判为 **未证实**。不得以页面写了 `2026` 就假设覆盖目标的 2026/27 赛季。 |
| 比赛级补充 | 商品页说明 Player Stats (Match) 仅支持部分顶级联赛，可回查一周内比赛。 | 未承诺覆盖五个商品联赛的每场比赛或所有字段；没有长期比赛记录读取保证。 | 不假设其能替代完整事件数据源或历史数据库。 |
| 访问和成本 | 需要注册账户/API key。商品页显示五大联赛商品为 **$149/月**，并写有 **15 天全功能试用**；FAQ 写明试用 200 次/运动/日、live data 约 2 分钟延迟、无需付款信息。[试用说明](https://www.isportsapi.com/en/faq/article/is-there-a-free-trial-available-72.html) · [试用额度](https://www.isportsapi.com/en/faq/article/are-there-limitations-for-free-trial-32.html) | 试用不是长期免费服务；套餐 FAQ 说价格依运动、数据模块和订阅期限而异，其他组合需联系销售；没有确认商品价是否含目标统计的完整生产 entitlement。([套餐 FAQ](https://www.isportsapi.com/en/faq/article/what-pricing-plans-are-available-81.html)) | 对单个有界 demo，试用窗口理论上可做验证，但在用途许可通过前不注册/不拉数；产品不满足长期免费偏好。 |
| 本地缓存/持久保存 | API 文档建议部分端点每天调用一次，并暴露行级 `modifyTime`；这只是同步技术线索。 | 服务条款没有明确授予或限制球员数据的本地缓存期限、建立本地数据库或保存历史快照的权限。 | 必须向供应商书面确认可存字段、保留期限、删除义务和缓存策略。不能把 rate-limit 建议视为保存许可。 |
| LLM、RAG 和派生报告 | 没有发现官方文件明确写允许将球员记录、统计或派生统计输入本地模型、云模型、embedding/向量库，或据此发布球探报告。 | 公开资料未回答模型处理、训练/推理、embedding 留存和派生排名展示。 | **默认不得将 iSports 数据放进 LLM、LangGraph state、RAG 索引或模型日志。**书面授权通过前，模型开关应关闭。 |
| 简历/作品集展示与上游权利 | 服务条款要求个人账户不共享，并写明数据可能由人工提供、可能出错，服务可能中断；条款保留随时修订权。[Terms of Service](https://www.isportsapi.com/en/home/terms.html) | terms 没有公开明确地说明原始逐球员数值的公开展示、再分发、截图/导出、派生排名或数据上游授权链。未找到公开数据集许可证或作品集许可。 | 不在公开 demo 展示供应商原始逐人数据或声称有公开使用权。让供应商书面回答目标用途、署名、部署域名、上游 rights 和退出/删除要求。 |

### API 文档对新鲜度与池完整度的实际证明范围

季节可用性接口提供一个很适合后续验收的 discovery endpoint：先读联赛与可用 season 列表，再选商品内联赛检查是否出现目标 2026/27 season。按本任务边界，本轮没有调用该接口，因此不得写成 2026/27 已覆盖。即使接口列出了赛季，也仍要比较 roster profile 数、season-stat 记录数和关键字段非空率，区分“无数据”“未出场”“未覆盖”和“字段缺失”。

API 端点的每日调用建议及 `modifyTime` 字段支持后续设计增量同步，但不构成固定 freshness SLA。Live-data 的 2 分钟试用延迟仅针对 live feed，不能挪用成赛季球员统计新鲜度承诺。

## 许可验收：必须逐项问清

iSports 的[服务条款](https://www.isportsapi.com/en/home/terms.html)总共只涵盖账户、试用、退款、准确性/可用性免责、违法用途和终止账户等条款，未公开承诺以下产品用法。开始实际数据验证前，要求服务方针对 TactiScout 书面确认：

1. 个人学习与非商业 portfolio 项目能否使用五大联赛商品数据，部署于公开 URL 是否允许；
2. 是否允许短期或长期缓存球员 profile、roster 和赛季统计，允许的 TTL、历史快照和删除期限；
3. 是否允许把原始字段及其派生特征/排序/文字摘要输入本地 Ollama 模型，是否允许任何云端模型、embedding 和 RAG；
4. 公开报告可展示哪些原始字段、派生数值和球员姓名，是否要求署名或禁止原始数据再分发；
5. 这五个联赛商品是否包含 Player Profile、Teamlist 和 Stats season endpoints 的目标赛季 entitlement，数据上游权利是否足以覆盖以上用途；
6. 2026/27 五个联赛分别的 season ID、名单/统计覆盖和赛季聚合刷新机制是什么。

FAQ 的缓存建议或请求限制只能帮助减少接口访问；它不是数据使用权的 grant。网站的 robots.txt 同样不能证明 API 数据的缓存、模型处理或再发布许可。

## 为什么不直接判为可接入

1. **当前季证据不足**：没有目标联赛的 2026/27 season availability 或真实样本覆盖证据。
2. **用途授权缺口**：公共条款未说明缓存、AI/RAG 和 portfolio 的许可范围。
3. **候选池完整度未证明**：有 roster 接口是积极信号，但 provider 自述的 active roster 不等于完整官方注册名单，赛季 stats endpoint 也未承诺包括零出场球员。
4. **非免费长期路线**：目标五大联赛商品页面展示 $149/月；试用只有 15 天。相对既有 Sportmonks 五自选联赛 Starter 页面显示 €29/月，iSports 没有显示成本优势（价格仅据核查时公开页面，套餐范围不完全等价，需分别以销售/账户 entitlement 核验）。
5. **指标不能完全支持战术评分**：公开字段比 FPL 深，但仍缺压迫、渐进推进、xG 及追踪类指标。可作为有定义的描述统计，不能据此声称完整能力画像。

## 下一步闸门

若用户仍想核验这条路线，可先决定是否接受最多 15 天试用和 $149/月标价，再向服务方确认上述书面用途许可。授权明确后，最小验证应先于代码接入：只选一个目标联赛、少量请求、无模型、无持久化，记录季节 ID、球队数、来源 roster 数、赛季统计人数和字段缺失率；验证通过再讨论本机缓存和工具链。任何一步不成立就停止，不以错误响应解释为零候选。

## 官方一手来源

- [European Top Leagues 商品、端点清单、五个联赛 ID、标价和试用入口](https://www.isportsapi.com/products/detail/football-api-product-184.html?lang=en)
- [球员赛季统计字段、Stats 计划、主客场拆分与每日调用建议](https://www.isportsapi.com/docs.html?id=51)
- [可用球员赛季统计联赛/赛季列表端点](https://www.isportsapi.com/docs.html?id=49)
- [active roster team ID 清单接口及其调用建议](https://www.isportsapi.com/en/docs.html?id=246)
- [15 天试用、无需支付信息、请求额度与 live 延迟](https://www.isportsapi.com/en/faq/article/is-there-a-free-trial-available-72.html) · [试用限制](https://www.isportsapi.com/en/faq/article/are-there-limitations-for-free-trial-32.html)
- [模块化价格说明与联系销售要求](https://www.isportsapi.com/en/faq/article/what-pricing-plans-are-available-81.html)
- [服务条款](https://www.isportsapi.com/en/home/terms.html)
- [既有 Sportmonks 下一条数据路线审查](current-player-data-expansion-next-source-2026-10-08.md)
