# PlayerElo 官方 API 与使用边界复核

核查日期：2026-10-10。目标是为 issue 39 / issue 32 判断 PlayerElo 能否作为 TactiScout 的当前候选来源或补充表现信号。本轮只查看 PlayerElo 发布者维护的网站与仓库；**没有注册、申请/测试 key、调用 API、下载数据、联系供应商或改代码**。覆盖、更新和模型效果均为供应商公开自述，不是本项目独立验证。

## 结论

**适合作为待准入的 report-only 外部整体表现信号，不适合作为唯一候选池，也不应取代 TactiScout 自己的职责评估。当前仍不启用数据留存、报告展示或 LLM/RAG。**

重要更新：当前官方 API 页面明确称 PlayerElo 的 Elo、历史和 EAR 是可用于 “a model, a scouting tool or a piece of research” 的 inputs；免费 key 入口显示可申请，免费档为每月 500 次、每分钟 10 次的 evaluation/hobby 额度。另一方面，页面没有给出完整 API 使用许可；这段用例文案没有界定第三方/本地 LLM 推理、embedding、持久化、公开 portfolio 展示、派生结果再发布或删除规则。因此旧笔记关于这些具体权利“未说明”的核心判断仍成立，但应补上有限的模型/球探/研究输入用途已有产品页文案这一正面证据。

建议将它定位为可选的**结果型整体信号**：仅用已验证的来源 ID（API-Football ID，或本项目已有 Reep 精确 crosswalk）按 ID 读取；保留 Elo、EAR、历史窗口、取得时间和来源；不将它并入 TactiScout 能力分或候选排序，不以其估值当转会费/预算，不让 Planner/Reviewer 在权限未确认时看到数据。

- **当前集成准入：NO-GO**。现有本地 checkpoint / 浏览器 localStorage、公开报告和 Ollama 路径都超过官方页面明确描述的边界；既有 gates 保持关闭。
- **受限探索：有条件 GO**。若用户提供可用 key，可另做小规模、无模型、无持久化 smoke，只记录脱敏 schema/命中情况；这仍只证明 key entitlement 与响应形状，不代表数据使用许可。不得把 key 或原始 JSON 写入仓库。
- **应用留存、面向用户展示、送本地/远端 LLM 或 embedding/RAG**：先取得覆盖这些具体用途的书面许可，或等待可公开核验的许可文本。

## 端点、字段和语义

根地址为 https://data-api.playerelo.football；请求使用 HTTPS JSON 与 Authorization: Bearer key。列表端点最大 limit=100，通过 offset 翻页。文档示例错误为 401（缺 key/无效 key）、404（未知 ID）、429（限流或月配额耗尽）。[API 基础与字段示例](https://playerelo.football/docs) · [端点总览](https://playerelo.football/api-access)

| 端点 | 官方文档可核实的内容 | TactiScout 中的边界 |
|---|---|---|
| GET /v1/players | 按 Elo 降序；search 是不区分大小写的名字子串查询；limit 1–100（默认 20），offset 从 0 开始。示例含 player_id、player_name、elo、宽位置、当前球队/联赛、ear_label。[文档](https://playerelo.football/docs) | 不把姓名搜索当身份匹配。本次文档没展示年龄、国籍、预算、合同过滤器。Elo 排名不是角色筛选。 |
| GET /v1/players/{id} | 示例字段：来源 ID、姓名、类型、Elo、位置/宽位置组、当前球队和联赛及其 ID、当前排名、累计比赛数/分钟、ear_career、ear_12m、ear_180 与对应 label。[文档](https://playerelo.football/docs) | 当前球队/联赛是 API 当前记录，不是独立核验的注册/可转会事实；值须保留来源和取得时间。 |
| GET /v1/players/{id}/history | 每场的日期、Elo、EAR，按从旧到新排列；可用含边界日期的 frm、to；较旧记录的 EAR 可为 null。API 总览另说 ?context=full 可加入 fixture、对手、分钟和 Elo change。[文档](https://playerelo.football/docs) · [总览](https://playerelo.football/api-access) | 这是模型评级轨迹，不是逐事件传球、推进、压迫或对抗数据；null 不可补零。完整 context=full 响应 schema 未在可读示例中提供。 |
| GET /v1/players/{id}/trend | 当前 Elo/排名以及 28 天前 Elo/排名和变化量；正 rank_delta_28d 表示排名上升。[文档](https://playerelo.football/docs) | 仅作为 28 天走势，不解释为单项能力提升。 |
| GET /v1/players/{id}/style | API 总览只称 playing-style radar 与 per-90 profile。[总览](https://playerelo.football/api-access) | 没找到 radar 维度、字段字典、单位、分母、样本和缺失字段的完整 schema。未取得响应体前不能映射为 TactiScout 职责指标。 |
| GET /v1/players/{id}/value | 总览标为计算出的欧元市场估值；供应商称 computed market-value estimate。[总览](https://playerelo.football/api-access) | 不是已核验的要价、转会费、薪资或预算事实，不应用作硬预算筛选。 |
| GET /v1/leagues/{id}/players；GET /v1/clubs/{id}/players | 总览描述为联赛球员和按球队 ID 取 squad。[总览](https://playerelo.football/api-access) | 可能用于定位来源记录；文档没有说明候选完整性、筛选能力、赛季归属或 squad 时效保证。不得称为完整注册阵容。 |

总览还列出 /fit、/players/{id}/opportunities、/clubs/{id}/squad-gaps 等招聘产品，并描述合成的战术、财务、策略信号。[Recruitment & fit 文档](https://playerelo.football/api-access#recruitment-fit) 这些是供应商派生分析，不能替代 TactiScout 自己的 Agent 推理或评估器；fit 的财务信号还依赖供应商估值。

## 评级方法与适用范围

PlayerElo 自述：比赛强度基于实际阵容（首发、替补上场者）与教练，并按位置权重聚合，前锋权重最大；结合联赛主场优势估计胜/平/负概率。赛后 Elo 按结果与预测差、上场分钟、胜差和冷门程度调整；不同位置应用渐进年龄衰减/峰值（页面举例攻击手约 24 岁、门将约 28 岁）。[官方方法说明](https://playerelo.football/) EAR 是分开的信号：逐场与该位置平均球员比较并累计；EAR180 累计过去 180 天，career EAR 覆盖职业期评级记录。[方法说明](https://playerelo.football/) · [API 定义](https://playerelo.football/docs)

所以球员 Elo 是**由比赛赛果、阵容贡献权重和模型更新规则驱动的整体强度估计**，不是直接观测的传球、跑动、压迫、盘带等事件统计。EAR 是位置参照下的模型派生近期/生涯信号，不等同于某项战术职责的适配标签。方法页是作者概要；本轮未找到模型源码、训练/校准数据、位置权重表或独立验证报告，不能把供应商自述当成独立审计的“客观能力真值”。

## 覆盖、更新与免费额度

官方 API 页面于 2026-10-10 标注最后更新日期为 2026-10-10；Free 为 €0、500 requests/month、10 req/min、Evaluation & hobby use，FAQ 称无需信用卡。Pro 为 €19/月、10,000 次/月、120 req/min，定位 production apps/dashboards；Ultra 为 €49/月、50,000 次/月、300 req/min，定位 daily full-dataset refresh/backtesting；Business 为 €199/月、300,000 次/月、600 req/min，并列 daily top-league Elo/EAR history、commercial licence 与 SLA。[套餐、额度、计划说明](https://playerelo.football/api-access)

供应商当前声称覆盖 **79K+ 球员、176 个赛事**，比赛日后每日更新；首页单次快照显示 79,377 球员、269,375 场 processed matches、176 competitions。[API 商品页](https://playerelo.football/api-access) · [首页计数与更新说明](https://playerelo.football/) 这是总体覆盖声明，不是逐联赛覆盖、2026/27 赛季完整度、更新时间 SLA、完整候选池或字段非空率证明。历史 endpoint 虽称 full match history，但没列出逐球员最早赛季、缺赛处理或覆盖表。

免费额度足以验证少数已知球员，不适合无差别扫描/同步全库。API 页面说所有计划都含所有 endpoints；发布者维护的 [MCP README](https://github.com/mwolters-cmyk/playerelo-mcp#tools) 同时将 transfer-fit 标为 Ultra、player opportunities 标为 Business。这是招聘端点 entitlement 的公开不一致，须以当前账号实际授权或书面回复确认。即使基本球员 API 对 Free 可用，500 次/月也不构成全局候选扫描能力。

## 使用许可：明确写明与未找到

| 事项 | 官方材料支持的最窄结论 |
|---|---|
| Free 用途 | 明确标记 evaluation & hobby use。[API 计划](https://playerelo.football/api-access) 不等于 production/公开产品或持久化授权。 |
| 模型/球探/研究输入 | API 页称球员/教练 Elo、历史、EAR 是 “a model, a scouting tool or a piece of research” 的 inputs。[API 使用说明](https://playerelo.football/api-access) 这正面支持用于某种模型/球探/研究输入，但没定义是否包含生成式 LLM prompt、发给 Ollama/云供应商、第三方处理、训练、embedding、向量库或推理日志。**不能把这句话扩成可把原始响应发给任意 LLM/RAG 管线。** |
| 公开作品集/展示 | Free 标为 hobby/evaluation；Pro 描述 production apps/dashboards；FAQ 称付费计划允许商业使用、Business 增加 commercial licence。[计划与商业 FAQ](https://playerelo.football/api-access) 没找到免费 hobby 数据在公开作品集逐球员展示的明确条款，也没找到逐字段展示、署名、截图、导出或派生排名规则。供应商公开网页展示数据不自动给予 API 用户再展示许可。 |
| API 数据许可 | 发布者维护的 Python client README 写着 “Data © PlayerElo; API use is governed by the plan terms”；其 plan terms 链接回 API 商品页，而不是完整许可文本。[Python client README](https://github.com/mwolters-cmyk/football-prediction-api-python#license) 本轮在官方 API、Docs、首页与 client/MCP README 未找到完整 API license/terms 文本或许可版本。 |
| 缓存/本地留存/删除 | 未找到公开缓存 TTL、持久化/快照、再分发、撤销后删除、历史保留或删除规则。每日刷新是供应商更新频率，不等于客户缓存许可。 |
| 本地/远程 LLM、embedding/RAG | 页面有泛称 “model inputs” 和 MCP for AI agents 产品/示例；没有找到允许将 API 数据交给本地 Ollama、云模型、embedding 模型或持久向量存储的明确许可，也没找到数据处理者、日志或模型训练规则。MCP README 的 MIT 适用于客户端代码；该客户端自称无数据库的认证 API 薄客户端，不能转授 API 数据权利。[MCP README](https://github.com/mwolters-cmyk/playerelo-mcp) |
| Terms/privacy | 本轮检查的官方 API、Docs、首页、发布者 client/MCP 页面及常见 /terms、/privacy 路径，没有找到可引用的完整 API terms/privacy 页面。这只是本轮未发现，不证明其他位置或账户约定绝对不存在。API 页说 key 是身份标识、可通过 /v1/usage 查用量，但没说明请求日志、个人信息留存或删除期限。[API usage 说明](https://playerelo.football/api-access) |
| 上游数据权利 | 首页称评分是 PlayerElo 自算分析，不是第三方原始 feed 原样转售；client README 标注数据版权归 PlayerElo。[首页](https://playerelo.football/) · [client README](https://github.com/mwolters-cmyk/football-prediction-api-python#license) 本次没有找到完整说明计算输入数据来源、上游授权链与下游再许可范围的文件。 |

## 与已有笔记的差异

- [2026-10-09 数据源下一条路线](current-player-source-next-route-2026-10-09.md) 主要核查 iSports，没有重查 PlayerElo；其对缓存、模型/RAG、公开展示需书面确认的边界仍适用，不能据此说 PlayerElo 比 iSports 更容易准入。
- [2026-10-07 当前赛季来源官方审查](current-season-player-source-official-audit-2026-10-07.md)、[PlayerElo 来源扩展研究](football-data-source-expansion-2026-10.md) 和 [Reep 身份映射研究](playerelo-reep-exact-identity-crosswalk-2026-10.md) 中“没有配置 key、无 live coverage 验证”的状态不变。本轮未申请 key 或调用端点。旧记录称模型、缓存、公开展示授权未明；现在应精确表述为：**官方已正面写明可作为 model/scouting/research input，但没有解决 LLM vendor、embedding、持久化、公开逐球员展示和再分发范围**。
- [2026-10-10 来源选项矩阵](current-player-data-source-options-2026-10.md) 正确指出产品页 78K/79K 口径不同、无完整公开 API licence、不可据免费 key 假设公开部署或模型权利。本次较新的 API 页更新为 2026-10-10，统一宣称 79K+ 并补充 input 文案；首页动态计数仍只是供应商快照，不是逐赛事 coverage 验收。
- [Issue 32](../issues/32-query-scoped-player-source-contract.md) 的 API key、报告展示、checkpoint/localStorage 保留和未来 Ollama gates 继续关闭；[issue 43](../issues/43-playerelo-reep-identity-mapping.md) 的 ID 关联只证明精确 ID 路径，不证明 PlayerElo 有实时记录或授予许可。

## Issue 39 的落地建议

1. 将 PlayerElo 留在“外部整体表现信号”，不注册成主候选池，不用 Elo/EAR 替代可观察职责指标，也不把 /fit、prospect 或估值当 TactiScout 的结论。
2. 凭据和权限通过后，先选少量已知候选和一个有限 league pool 验证 /players、league players、player details、history、style；记录字段来源与观测时间，区分端点不支持、无记录、null 与请求失败。不得先建全库定时同步。
3. smoke 期间不将数据放入模型、checkpoint、localStorage、向量索引或公开 UI。公开简历演示需先澄清获取、留存、展示、AI 处理权限。
4. 权限未澄清不阻塞 Agent 主链：继续使用已验证候选源和本项目自有 evaluator；PlayerElo 保留为待授权可选支路。

## 一手来源

- [PlayerElo API access、计划与全部 endpoint](https://playerelo.football/api-access)
- [REST API 文档与 JSON 示例](https://playerelo.football/docs)
- [方法、动态覆盖计数与每日更新说明](https://playerelo.football/)
- [Player-level rating API 与 Davidson 三结果模型说明](https://playerelo.football/player-ratings-api)
- [Football Data API 产品介绍](https://playerelo.football/football-data-api)
- [发布者维护的 Python client README（数据版权/plan terms 说明）](https://github.com/mwolters-cmyk/football-prediction-api-python)
- [发布者维护的 PlayerElo MCP server README](https://github.com/mwolters-cmyk/playerelo-mcp)
