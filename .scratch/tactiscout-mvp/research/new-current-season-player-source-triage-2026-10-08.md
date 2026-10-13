# 新增当前赛季球员表现来源：开放与授权复核

核查日期：2026-10-08。问题：在既有研究之外，是否有免费/开放、当前赛季、含具名球员能力或表现数据，并清楚允许自动读取、本地留存、本地 LLM/RAG 与作品集公开展示的新来源。只查数据发布方/服务方文档、许可、条款及其公开仓库；没有创建账号、使用凭据、调用 API、下载或保存球员数据，也没有尝试绕过访问控制。本报告是工程准入判断，不构成法律意见。

## 结论

**没有发现一条新来源能无条件通过全部门槛；Yuvron Football API 是最强的条件候选。**它公开了 2026/27 当前赛季 API、16 项赛事和具名球员的 xG/xA、射门、关键传球、传球、防守动作及评分字段，免费计划每月 500 次请求；FAQ 也说任何计划可商业使用。不过没有找到 API 服务方的数据许可/使用条款，公开文档没有清楚授权保存原始球员表现行、把行或 embedding 放入本地 LLM/RAG、或在公开作品集展示逐球员值。应先取得书面许可，当前不能按“已准入” provider 使用。

其他近似候选的缺口更明确：Estimador.pt 有葡超 2026/27 模型评分 JSON，但公开版本对授权范围矛盾，且部分上游球员统计被排除；Orbistats 有当季统计，但免费访问须人工批准且仅一小时，标准许可没有本地 LLM/RAG 条文；Rising Transfers 的 CC BY 4.0 仓库有具名 per-90 表现数据，但统计赛季是 2025/26，并非当前 2026/27。

| 来源 | 新增情况与当前赛季字段 | 获取/留存/展示边界 | LLM/RAG | 判断 |
|---|---|---|---|---|
| **Yuvron Football API** | 官方说明覆盖当前赛季 16 项赛事、610 支队伍；球员目录、球队阵容、球员 profile/赛季数据、逐场 rating，以及 xG/xA、射门、关键传球、创造重大机会、传球、抢断、拦截、扑救等字段。免费计划为每月 500 次请求，文档称各计划有相同 endpoint。当前覆盖/统计仍只是服务方文档声明，本轮没有调用 API 验证。[主页/字段/免费层](https://football-api.yuvron.online/) · [FAQ](https://football-api.yuvron.online/faq) · [API reference](https://football-api.yuvron.online/reference) | FAQ 称稳定 numeric player IDs 可以存储，并称任何计划（包括免费）可商业使用；数据自述来自公开比赛记录。**ID 可存储不等于获准保留球员统计数据。**没有找到 provider-owned Terms/Data License 明确说明统计值的缓存期限、持久留存、公开展示/再分发权、归因义务或上游授权链。图像、队徽、旗帜另有第三方权利保留。 | 没有 provider 文档明确允许或禁止本地 LLM 输入、embedding/vector store 或 RAG。FAQ 的“商业使用”无法单独回答模型处理与数据再分发边界。 | **条件 GO（待书面准入）；当前 NO-GO 持久化/公开展示/LLM-RAG。**技术与免费层都匹配，要求服务方确认数据行的本地保留、模型推理/embedding、公开作品集展示、衍生输出及来源授权后，再决定是否做小范围 provider 验证。 |
| **Estimador.pt — Liga Portugal open data** | 其 2026/27 目录列出 `players.json`（球员进攻贡献：高于替代水平的进球/助攻每 90 分钟，含区间及相对纯进球榜的变化）、`contested_ratings.json`（争顶/地面对抗能力）、`def_ratings.json` 及守门员评分文件。站点称静态 JSON 无 key、无 rate limit；这是单一葡萄牙联赛的发布方模型输出，不是完整全球候选池。[开放数据页](https://estimador.pt/en/desporto/liga/dados/) | 页面当前直接版本称可免费使用、再分发和转换（含商业用途），仅需署名并链接；但同一 URL 的公开索引版本称模型输出按 CC BY-NC 4.0 授权，同时也写“商业用途包含”，二者相互矛盾（CC BY-NC 本身限制商业用途）。索引版本还明确将球员分钟、比赛数、进球/助攻、对抗次数及守门员原始计数等 SofaScore 字段标为“不在许可范围内”。页面列出的来源包括 SofaScore、FotMob、football-data.co.uk 与 Transfermarkt。[许可/字段列表](https://estimador.pt/en/desporto/liga/dados/) · [CC BY-NC 4.0 法律文本](https://creativecommons.org/licenses/by-nc/4.0/) · [SofaScore 数据 API 说明](https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability?lng=pt-BR) | 对其自有的模型评分，宽泛的“使用、再分发、转换”授权可能覆盖本地索引和非商业分析；但授权标识冲突，且上游事实字段不在授权内。没有一份一致、可核对的条款明确说明具体可向本地模型提供哪些球员字段。 | **条件候选；当前 NO-GO 落盘/模型输入。**只有在发布方确认适用许可、可用字段范围、静态文件留存，以及本地推理/embedding/RAG 是否允许后，才考虑只用其自有派生评分做隔离的葡超补充。不得复制其被标为未授权的原始统计。 |
| **Orbistats Sports Statistics API** | 官方统计产品页称提供当前赛季各场具名球员数据和赛季汇总，另有可用时提供的 xG/高级指标；示例含球员、2026/27 赛季、出场、进球、助攻。字段和覆盖仍需经账户实际核验。[产品与字段示例](https://www.orbistats.com/api/sports-statistics-api.html) | 官网计划页称免费计划为 €0、无信用卡、全部端点 1 小时；但须提交 access request，且请求由团队逐项审核。条款允许在持有 API key 的自有产品内展示，并允许按计划新鲜度间隔缓存；禁止标准计划原始数据再分发，免费层不授予再分发。[价格与申请流程](https://www.orbistats.com/pricing.html) · [数据授权](https://www.orbistats.com/data-licensing.html) · [Terms](https://www.orbistats.com/terms-of-service.html) | 页面面向 analytics/model 产品的描述不等于 LLM 权利。Data Licensing 和 Terms 没有说明向本地 LLM 提供球员记录、做 embedding、持久向量索引或 RAG；缓存权限也受计划刷新间隔约束。 | **NO-GO。**数据形状符合，但免费层是申请后的一小时试用，不是开放的长期源；标准许可不足以确认本地模型/RAG 与长期留存。除非取得书面 LLM/RAG、持久缓存与公开演示授权，否则不接入。 |
| **Rising Transfers — World Cup 2026 Player Data** | 新公开仓库列出 48 支国家队的 1,363 名球员（姓名、国家、位置、俱乐部、年龄及自有估值），另有 1,181 名球员的 per-90 表现字段；仓库数据字典明确这些 per-90 指标来自 **2025/26** 联赛赛季并要求至少 450 分钟。它是 2026 世界杯参赛阵容快照，而不是 2026/27 俱乐部赛季表现 feed。[仓库说明与字段](https://github.com/risingtransfers/world-cup-2026-data) · [数据字典](https://github.com/risingtransfers/world-cup-2026-data/blob/main/docs/data_dictionary.md) | 仓库将数据声明为 CC BY 4.0，要求署名 Rising Transfers；该许可允许在署名条件下复制、改编和再分发，因而是三项中权限最清楚的候选。没有在仓库说明中找到 2026/27 表或持续更新承诺。[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | CC BY 4.0 对数据的复制/改编许可适合本地分析、向本地模型提供已许可内容及带署名的公开展示；仍应把它限定为静态历史赛季数据，不能推断为实时或本赛季 feed。 | **NO-GO 作当前赛季来源；可作有署名的 2025/26 离线历史参照。**不要把世界杯阵容或上季联赛统计描述成 2026/27 现役候选表现。 |

## 具体准入判断

- **Yuvron 是唯一值得先询问准入条款的新 API 候选。**它有免费计划、现行赛季具名球员表现字段，以及服务方自述的商业使用许可；但未找到数据许可页或服务条款。FAQ 说 numeric IDs 可存储，不能外推为 raw stats 可持久保存。要求服务方书面确认：逐球员统计本地缓存/留存期限；本地模型一次推理与 embedding/RAG 是否允许；作品集页面中逐球员值、截图与衍生排名能否公开；需要哪些署名；数据是否由其有权许可的上游提供。没有这些答复前不调用其付费/需 key endpoint，不把它视作已准入。
- Estimador.pt 的授权文字互相矛盾，且部分文件字段排除上游球员统计；**当前不通过本地保存、向模型输入或公开逐球员展示的准入门槛。**如项目需要葡超评分，先只请求其自有模型评分的准确许可，不访问或下载球员文件做技术试验。
- Orbistats 的公开条款允许带计划刷新限制的产品缓存和页面展示，但免费试用须先申请并由人审核；没有当前可自助使用的公开数据接口，也没有 LLM/RAG 条款。**不能把“可用于模型/analytics”的营销描述当作本地生成式 AI 授权。**
- Rising Transfers 的许可明显优于另两项，但性能行明确是 2025/26。**可作为历史比较材料，不满足本次“当前赛季新来源”目标。**

因此不新增 provider，不获取上述球员数据。当前继续按已有来源研究记录的分层策略处理：为公开演示使用已明确许可的来源或合成数据；若需要更广的当前季数据，先取得 Yuvron 的统计留存/LLM/RAG/公开展示书面准入；若需要葡超模型评分，再澄清 Estimador 的授权冲突；Orbistats 只有在获得长期、LLM/RAG 和公开展示许可且解决其仅一小时免费层后才重审。

## 一手来源

- Estimador.pt：[2026/27 开放数据目录、字段说明、许可与 provenance](https://estimador.pt/en/desporto/liga/dados/) · [SofaScore Sports data API availability](https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability?lng=pt-BR) · [CC BY-NC 4.0 Legal Code](https://creativecommons.org/licenses/by-nc/4.0/)
- Yuvron：[Football API homepage and pricing](https://football-api.yuvron.online/) · [FAQ](https://football-api.yuvron.online/faq) · [API reference](https://football-api.yuvron.online/reference)
- Orbistats：[球员统计产品页](https://www.orbistats.com/api/sports-statistics-api.html) · [价格与试用审批](https://www.orbistats.com/pricing.html) · [Data Licensing](https://www.orbistats.com/data-licensing.html) · [Terms of Service](https://www.orbistats.com/terms-of-service.html)
- Rising Transfers：[World Cup 2026 Player Data README](https://github.com/risingtransfers/world-cup-2026-data) · [data dictionary](https://github.com/risingtransfers/world-cup-2026-data/blob/main/docs/data_dictionary.md) · [repository CC BY 4.0 declaration](https://github.com/risingtransfers/world-cup-2026-data/blob/main/LICENSE)
