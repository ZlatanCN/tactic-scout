# 当前免费/公开足球球员数据源复核：全球候选池与比赛能力数据

**核验日期：2026-10-07。**问题：截至当日，是否出现了适合 TactiScout 的、免费或公开获取、覆盖比 FPL（英超）和 ASA（北美）更广的现役成年球员候选池或比赛能力数据来源？本轮只查官方产品文档、原始发布方仓库、数据许可和服务条款；没有申请账号或密钥、调用凭证接口、下载/导入球员数据、抓取网页或接触未公开接口。本文是工程准入判断，不构成法律意见。

## 结论

**没有找到一个同时满足“广于 FPL+ASA、当前成年候选池或有用的比赛能力数据、免费/公开、持续更新、允许自动访问与本地保存，并明确允许本地 LLM/RAG 处理”的新来源。**这次找到的来源各有一块增量，但都不能作为新的通用在线 provider：

1. **最近发布的 FIFA World Cup 2026 赛后报告**是有价值的战术方法和具名球员比赛表现参考。官方说赛事共 104 场，比赛报告包含球队和个人表现指标；赛后综合报告于 2026-10-02 发布。它覆盖 48 支国家队的单项赛事，不是俱乐部现役名单或转会市场，且没有公开球员 API、完整年龄字段、数据保存或 LLM/RAG 授权。**只作人工方法参考；不自动采集、不把报告内容放入 TactiScout 的模型上下文。**[FIFA 比赛报告中心](https://www.fifatrainingcentre.com/en/fifa-world-cup-2026/match-report-hub.php) · [FIFA 赛后报告发布说明](https://vod.fifa.com/talent-development/technical-study-group/media-releases/comprehensive-post-tournament-report-fifa-world-cup-2026)
2. **Transfermarkt-datasets** 是这次发现的最广公开静态快照候选：发布仓库标称 65 个赛事、50,000 多名球员、约 189 万人次出场，数据到 2026-07-06，包含球员资料、出场、阵容、转会与估值。但它已暂停更新，未覆盖 2026/27 阵容；而 Transfermarkt 官方条款禁止自动抓取/复制其数字内容，并明确禁止把内容用于 AI 训练或开发。条款没有明确回答将记录放入既有模型的单次推理、prompt、embedding 或 RAG 是否获准；也没有找到这些用途的肯定授权。该仓库声明 CC0，不足以解决上游来源条款与 AI 使用冲突。**不作 provider、不下载/导入、不送入 LLM/RAG；若未来考虑，只能先取得权利人书面许可并澄清仓库数据的授权链。**[数据仓库与状态](https://github.com/dcaribou/transfermarkt-datasets) · [Transfermarkt 官方使用条款](https://www.transfermarkt.com/intern/anb)
3. **BrazilianFootball/Data** 公开了 CBF 比赛文件整理结果，包含巴西杯及 Série A–D 的 2013–2025 赛季比赛名单、首发/替补变化、进球和牌。它扩展到巴西多个级别，但主要是比赛记录，不是球员能力统计；2025 赛季已经结束，仓库未证明 2026 实时覆盖；项目 MIT 文件没有单独明确原始 CBF 数据许可，CBF 条款禁止未经授权复制或再利用站内内容。**不爬、不入库、不作为能力证据；只记录为待权利澄清的巴西历史阵容/事件线索。**[数据仓库说明](https://github.com/BrazilianFootball/Data) · [CBF 使用条款](https://www.cbf.com.br/termos-de-uso)
4. **SkillCorner Open Data** 的公开仓库仍适合作为少量追踪/无球跑动/体能数据的研究样本，但赛事为澳大利亚 A-League 2024/25；不是现役候选池，也未解决数据文件授权是否包含本地持久化或 AI/RAG。**保留既有隔离样本评估思路，不注册新 provider。**[官方开放数据仓库](https://github.com/SkillCorner/opendata) · [仓库许可](https://github.com/SkillCorner/opendata/blob/master/LICENSE)

因此建议维持现有分层：FPL/ASA 仅代表当前季局部表现池；通过现有 FPL→Reep→Wyscout 路径补充具名历史事件表现；SkillCorner/StatsBomb 等用于受限的历史算法评估；第一方观察用于 TactiScout 自有证据采集。不要将“多下载几个名单”包装成全球、实时、已核实的成年球员池。当前限制及来源术语以 [`CONTEXT.md`](../../../CONTEXT.md)、[issue 39](../issues/39-layered-player-evidence.md) 和 [2026-10-07 官方来源复核](current-season-player-source-official-audit-2026-10-07.md) 为准。

## 候选对比

| 来源 | 候选池、球员状态与表现字段 | 覆盖与更新时间 | 认证/价格/自动访问 | 本地保存与再分发 | LLM/RAG | 判断与安全验证 |
|---|---|---|---|---|---|---|
| **Transfermarkt-datasets（第三方数据集发布者；底层来自 Transfermarkt）** | README 声称有 50,000+ 球员档案、65 个赛事、球员当前俱乐部字段、比赛出场、阵容、进球/牌/转会和历史身价等；这比 FPL/ASA 的地域候选扩展更广，但 `current_club_id` 是一个已经停止更新的快照字段，不能证明当前仍注册或可引援。没有将表现字段描述为可复算的渐进传球、推进、压迫等指标。 | 公开页面写明快照更新至 **2026-07-06**；比赛数据截至 7 月 6 日、出场截至 6 月 28 日、估值截至 6 月 12 日，2026/27 squads 未覆盖；自动采集于 7 月中旬停止，无恢复时间表。包含 2026 世界杯小组赛，但这不改变俱乐部名单已过期的限制。[README 状态与表规模](https://github.com/dcaribou/transfermarkt-datasets) | 可从 GitHub/发布者链接静态下载，无 key、无价格；仓库自身公开的采集 pipeline 曾自动运行但现已暂停。**不能据此去自动访问 Transfermarkt。** | 仓库标注 CC0-1.0；但底层网站条款保留数字内容权利，禁止用户通过 bots、spiders、screen scraping 或其他自动方式访问/复制。仓库作者声明不能证明其可替 Transfermarkt 授予上游权利。未经书面澄清，不在产品中本地长期存储或再发布该数据。[仓库许可元数据](https://github.com/dcaribou/transfermarkt-datasets) · [Transfermarkt 官方条款 §11](https://www.transfermarkt.com/intern/anb) | Transfermarkt 条款明确禁止将数字内容用于 AI 训练或开发，包括语言模型、机器学习、神经网络等；未明确回答一次推理、prompt、embedding 或 RAG 是否包含在内，也未找到这些用法的肯定授权。无权据此推断为 Ollama/LangGraph 获准。[官方条款](https://www.transfermarkt.com/intern/anb) | **暂不采用。**它是技术形状上最广的公开快照，但过期、来源权利和模型处理许可均不符合本项目。安全验证仅限查看其 README/许可/来源条款；不下载数据、不访问上游、不建 adapter。若未来仍有兴趣，先请求发布者及上游权利人书面确认 CC0 对具体数据及模型使用的适用范围。 |
| **FIFA World Cup 2026 Match Report Hub / Technical Study Group** | 官方报告说明每场有关键比赛阶段，以及球队和个人表现指标；赛后研究结合专业观察、数据和视频，覆盖推进、压迫、反抢、跑动、门将出球等战术主题。报告中的球员是进入世界杯比赛/名单的参赛者，不是完整现役俱乐部阵容；页面没有足够信息证明全部球员均为成年人，也没有用于筛成年人的统一 DOB 表。[报告中心](https://www.fifatrainingcentre.com/en/fifa-world-cup-2026/match-report-hub.php) · [FIFA 发布说明](https://vod.fifa.com/talent-development/technical-study-group/media-releases/comprehensive-post-tournament-report-fifa-world-cup-2026) | 官方称赛事有 **48 支国家队、104 场比赛**；比赛在 2026 年 6–7 月进行。比赛报告随赛事进行追加；赛后综合报告发布于 **2026-10-02**。属于刚完成的赛事报告，不是 2026/27 俱乐部当前赛季 feed。[FIFA tournament page](https://www.fifatrainingcentre.com/en/fifa-world-cup-2026/tournament-page--fifa-world-cup-2026.php) | 报告网页可公开浏览，无公开球员数据 API 文档、注册 key、配额或价目。官方 ToS 确实提及 FIFA API，但没有为该报告数据提供可用的 API contract 或免费球员接口。自动访问/批量导出未获明确授权。 | FIFA ToS 将数字平台上的数据和内容列为 FIFA/许可方内容，默认许可限于私人、非商业平台使用；版权 FAQ 仅明确允许纯编辑性、非商业使用并署名的 FIFA.com 统计/内容。没有找到将 PDF 表格整体复制进第三方数据仓库、长期缓存或公开再分发的许可。[Terms §§5.1–5.3、6.4](https://inside.fifa.com/terms-of-service) · [版权与使用 FAQ](https://vod.fifa.com/organisation/contact-fifa/legal-branding-and-rights) | 没有明确授权本地 LLM、embedding、RAG 或作为应用排名依据。权限不明时只保留 URL，人工阅读公开报告，自己记录抽象方法笔记并引用来源；不把原始个人数值输入模型。 | **仅人工研究。**它能帮助战术维度设计及解释“什么算推进/压迫”的观察方法，但不扩大全球转会候选池。安全验证：人工查看报告目录或一份公开报告、引用报告链接；不自动抓取、保存表格内容或送入模型。 |
| **BrazilianFootball/Data（第三方 CBF docket 整理仓库）** | 仓库 README 描述其从 CBF 比赛文件抽取比赛、参与球员、分阶段阵容、替补、进球和黄/红牌；这能构建“实际出场过”的球员索引，不等于完整注册阵容或当前球队效力。未见通用赛季级个人能力指标，例如推进、传球/接球、压迫或防守动作。[数据 schema 示例](https://github.com/BrazilianFootball/Data/tree/main/results) | 巴西杯、Série A、B、C、D，README 列出 **2013–2025** 赛季，且 2025 多项赛事接近全场次。它会扩展到巴西多个级别和更广历史球员，但研究日期 2026-10-07 时没有 2026 当前赛季 coverage 证据，不能作为最新候选源。 | 静态 GitHub 文件无需 key/付费；仓库提供从 CBF 页面拉取文件的 scraper。官方 CBF 没有在已查条款中授予该仓库/第三方通用自动采集许可。 | 仓库页面标注 MIT；这只确认仓库提供的代码许可，不是 CBF 文件数据的单独授权。CBF 条款 §3、§6 禁止未经授权复制、再现、修改、传播或使用网站数据/内容，商业及非商业用途都包含在表述中。[仓库许可与 README](https://github.com/BrazilianFootball/Data) · [CBF 条款](https://www.cbf.com.br/termos-de-uso) | 未找到任何 LLM/RAG/模型输入授权；而基础复制/再利用权本身未通过。 | **暂不接入。**技术上是巴西比赛 roster/事件历史补充，不是能力数据。安全验证仅限人工读 README、字段样例和 CBF 条款；不运行 scraper、不导入文件。 |
| **SkillCorner Open Data（现有研究样本，变更复核）** | 官方 repo 给出 2024/25 澳大利亚 A-League 的少量比赛追踪/动态事件，以及全赛季 Physical、Off-Ball Runs、Passing 聚合；这些内容适合测试战术证据映射，不是完整当前名单。仓库当前 README 仍描述 10 场比赛与赛季聚合；不把代码许可自动推断为每份球员统计 CSV 的许可。[官方 README](https://github.com/SkillCorner/opendata) | 单一 A-League、2024/25；公开仓库无在线 roster API 或新赛季更新承诺。2026-09 的 repo activity/代码更新没有把历史样本变成 2026/27 current pool。 | GitHub 公共仓库，无 key/费用；产品 API 属客户凭证路线，非该公开样本的免费在线 API。 | 仓库附 MIT LICENSE，但其文本适用对象写作软件及关联文档；README 请求给 SkillCorner credit，却未明确列出数据级再分发、长期保存权限。 | 未找到明确本地模型输入或 RAG 授权。 | **保留隔离研究样本，不注册在线 provider。**可以查字段说明并用虚构/合成数据验证解析器；真实球员数据进入公开 demo、持久化或模型前仍需数据级许可确认。详见既有 [SkillCorner 来源研究](additional-player-evidence-sources-2026-10.md)。 |

## 相对于 FPL + ASA 的判断

| 需求 | 新发现 | 与当前基线的关系 |
|---|---|---|
| 覆盖更多地区的当前俱乐部候选池 | Transfermarkt 静态全球快照在数量上最广，但停在 2026-07-06、无 2026/27 squad，并且官方条款禁止自动采集和 AI 使用。BrazilianFootball/Data 扩展巴西多级别历史出场，但未证明当前名单或 2026 赛季。 | **没有可准入的新实时池。**不能将快照或已踢过比赛的人说成当前成年可引援对象。 |
| 新增强战术个人指标 | FIFA 2026 官方报告有比赛/个人层分析；SkillCorner 有更贴近无球跑动、身体输出的历史聚合；但两者都不是全市场赛季 feed，授权不够支撑自动 Agent/RAG。 | **能补方法参考或离线样本，不替换候选池。** |
| 免费开放、可自动获取、可存储、可交给 Ollama | 本轮没有找到满足以上全部条件的新增来源。 | **不新增自动 provider。**本地 Ollama 不改变上游数据许可。 |

## 对 TactiScout 的安全可行动作

1. **不用为增加来源数量而添加新爬虫。**本轮的两个广覆盖线索都没有同时通过时效、指标和授权门槛。
2. **可把 FIFA 2026 报告加入方法资料的人工参考索引**，只保存来源 URL、发布日期、主题及自写的抽象方法摘要；不把逐球员统计复制到仓库、向量库、prompt 或报告。
3. **保持当前候选与表现来源分层。**当前候选 discovery 继续用能实际验证的 FPL/ASA 局部赛季池；Wyscout/StatsBomb/SkillCorner 仍以具名历史赛季证据或隔离 benchmark 使用，必须在报告里展示赛季、样本和缺口。若需要更广最新候选池，优先走商业供应商正式许可或书面授权，而不是无契约网页端点。
4. **后续最低风险验证：**如用户希望真实覆盖德国/西班牙等 2026/27 俱乐部，可先用有公开账户/许可契约的供应方计划核对覆盖、价格、成人筛选字段与数据处理条款；在确认可展示、保存和本地 LLM 输入权之前，不请求 key、不调用 API、不写入现有 provider。

## 一手来源索引

- FIFA 比赛报告中心与 2026 赛后研究：[Match Report Hub](https://www.fifatrainingcentre.com/en/fifa-world-cup-2026/match-report-hub.php) · [FIFA tournament page](https://www.fifatrainingcentre.com/en/fifa-world-cup-2026/tournament-page--fifa-world-cup-2026.php) · [FIFA 赛后发布说明](https://vod.fifa.com/talent-development/technical-study-group/media-releases/comprehensive-post-tournament-report-fifa-world-cup-2026)
- FIFA 使用许可：[Terms of Service](https://inside.fifa.com/terms-of-service) · [Legal/Branding/Rights FAQ](https://vod.fifa.com/organisation/contact-fifa/legal-branding-and-rights)
- Transfermarkt 数据快照发布仓库：[README / 数据规模 / 日期 / CC0 声明](https://github.com/dcaribou/transfermarkt-datasets) · [Transfermarkt 官方 Terms of Use](https://www.transfermarkt.com/intern/anb)
- 巴西 CBF 比赛记录：[BrazilianFootball/Data README](https://github.com/BrazilianFootball/Data) · [results schema](https://github.com/BrazilianFootball/Data/tree/main/results) · [CBF 官方 Terms of Use](https://www.cbf.com.br/termos-de-uso)
- SkillCorner 样本：[官方 Open Data README](https://github.com/SkillCorner/opendata) · [MIT LICENSE](https://github.com/SkillCorner/opendata/blob/master/LICENSE)
- 项目现状：[CONTEXT.md](../../../CONTEXT.md) · [数据源扩展 issue 39](../issues/39-layered-player-evidence.md) · [2026-10-07 官方当前赛季来源复核](current-season-player-source-official-audit-2026-10-07.md)
