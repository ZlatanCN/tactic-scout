# 新球员数据源授权路线核查（2026-10-09）

核查日期：2026-10-09。目标是在避免复查已评估来源的前提下，找一条有第一方文档、能扩展当前/近季球员发现或能力证据，并且足以支撑本地留存、本地 LLM/RAG 和公开作品集演示的新路线。只读发布方/API 文档、schema/端点说明、服务条款和许可文本；没有注册账号、提交表单、请求任何 API、抓取或下载球员数据、保存球员行、引入 provider 或修改应用代码。本结论是工程准入筛选，不构成法律意见。

## 决定

**NO-GO：本轮没有找到一条全新的数据源，能同时证明有实质候选/能力增量、受支持的自动访问、本地留存、本地 AI/RAG 处理和作品集公开展示权。**

有两条值得分辨的新增线索：NCAA 的 2026 大学足球个人统计榜是真实、当季、官方的美国青年球员表现入口；Football Web Pages 的 API 宣称覆盖英格兰各级联赛并提供球员出场和进球榜。两者都没有通过 TactiScout 的产品用途授权门：NCAA.com 的条款限制公开使用和复制内容；Football Web Pages 的免费 API 明确只给非联赛俱乐部用于其官方/公共网站。没有从接口可见、可免费浏览或本项目非商业推断模型处理权。

因此当前不新增爬虫、数据请求或 provider。最小可行的下一步是先向 NCAA.com/NCAA 统计与版权联系人询问：是否提供可用于公开个人项目的正式 feed/API，以及其对自动请求、最小字段的本地保存、Ollama/RAG、具名派生报告公开展示的权限和署名要求。收到明确答复和正式接口说明前，只把 NCAA 统计榜当作人工研究链接。

## 已有来源审查范围

本轮先读项目已有的数据源路线、许可矩阵和近期审查，并排除重复候选，包括 FPL、ASA、Understat、StatsBomb/Wyscout、FBref、TheSportsDB、Sportmonks、foot.io、OpenLigaDB、FIFA/联赛官网、xG Stat、OpenFootAPI、Yuvron、Live Football API、SoccersAPI、PitchAPI 等。参见[当前球员表现来源扩展复核](current-player-source-expansion-2026-10-09.md)、[当前球员数据源路线复核](current-player-source-routes-2026-10-09.md)、[新赛季开放/授权来源复核](new-current-season-player-source-triage-2026-10-08.md)、[当前球员数据源审查](open-current-player-source-audit-2026-10-08.md)、[来源准入矩阵](player-evidence-source-admission-matrix-2026-10-08.md)。本报告不复述这些候选的既有结论。

## 新线索评估

| 来源 | 有证据支持的增量 | 自动访问 | 本地留存 | 本地 AI / RAG | 作品集展示 | 结论 |
|---|---|---|---|---|---|---|
| **NCAA / NCAA.com 男子足球个人统计榜** | 官方页面公开当前 2026 NCAA 男足个人统计榜，并提供进球、助攻、射门、射正、扑救等分类；当前页面标有榜单更新日期和统计截止比赛日。NCAA 官方统计入口覆盖 DI、DII、DIII 与历史统计。可补充美国大学赛的年轻球员发现和基础比赛表现，但不是完整球员档案或当前职业球员池；榜单不证明覆盖所有注册球员，也没有年龄、合同、职业球队/转会状态或推进、压迫等战术指标。[2026 NCAA 男足当前统计榜](https://www.ncaa.com/stats/soccer-men/d1/current/individual/573) · [NCAA 统计与档案入口](https://www.ncaa.org/championships/statistics-and-records/) | **未获准自动访问。**官方公开的是网页榜单及统计搜索入口；本次未找到受支持的公开开发者 API、球员数据 schema 或自动访问许可。网页能浏览不能代替系统化访问许可。 | **未获准项目数据库留存。**NCAA.com 条款将统计列为受保护内容，并限制条款未许可的复制和其他利用；没有授予 TactiScout 结构化建库或持久缓存权。[NCAA.com Terms of Service §4](https://www.ncaa.com/tos) | **未授权/未说明。**条款没有授予把球员行交给本地模型、生成 embedding 或纳入 RAG 的权利；不能从网页浏览权限推出模型处理权。 | **NO-GO，除非先获书面许可。**条款限制未经许可公开发布、复制或利用 NCAA 内容；具名统计或派生球探报告不应直接放进公开演示。[NCAA.com Terms of Service](https://www.ncaa.com/tos) | **有体育发现价值，但不准入。**如目标改为美国大学新秀，向 NCAA/运营 NCAA.com 的权利方问询正式 feed 与许可后再评估。 |
| **Football Web Pages API**（独立数据商，非联赛官方） | 官方 API 文档列有 `appearances` 和 `goalscorers` 球员榜端点，支持按球队/赛事和页码查询，每页最多 25 条；站点列出英格兰低级别/非联赛和部分苏格兰及欧洲比赛。理论上可增加英格兰较低级别的球员线索，但文档只证明出场、进球榜，不证明完整注册名单或足够的战术能力指标；未在本轮实请求验证当前赛季覆盖。[API 文档](https://www.footballwebpages.co.uk/api) | **受限且不适用于本项目。**发布方称 API key 通过邮件发放；免费数据只面向“非联赛俱乐部”，且仅用于该俱乐部自己的官方/公共网站。文档列每分钟 10 次限制。TactiScout 是独立球探作品集应用，不符合公布的免费使用场景；不得为探测而申请或调用。 | **未授予。**API 文档没有授予本地数据库、缓存期限或终止服务后的留存权。网页免费浏览并不等同 API 数据的可持久复制授权。[API 使用范围](https://www.footballwebpages.co.uk/api) | **未授权/未说明。**未找到 provider 条款允许将 API 球员数据输入本地 LLM、生成 embeddings 或建立 RAG 索引。 | **不适用于 TactiScout。**免费 API 使用场景限定于非联赛俱乐部官方网站；个人项目的公开球员统计或派生报告没有获得许可。站点一般条款没有替代 API 的专门许可。[API 页面](https://www.footballwebpages.co.uk/api) · [站点条款](https://www.footballwebpages.co.uk/united-counties-league-division-one/terms-and-conditions) | **NO-GO。**只有当项目变成某非联赛俱乐部官网的授权展示功能时，才值得向 provider 澄清本地处理及 LLM 用途。 |

## 判断依据与边界

- NCAA 统计榜是**榜单样本**而非由公开文档承诺的完整可发现球员仓库。NCAA 的统计政策说明统计由比赛现场统计人员及学校/协会流程汇总；这说明榜单的官方统计流程，不扩展其第三方复用许可。[NCAA 男足统计页](https://www.ncaa.com/stats/soccer-men/d1/current/individual/573) · [NCAA 官方统计政策 PDF](https://s3.amazonaws.com/fs.ncaa.org/Docs/stats/ForSIDs/Policies.pdf)
- NCAA.com 条款明确内容包含统计，并把复制、发布、传输、衍生和其他利用限制在条款许可内；该页面的开放浏览不是机器访问、模型输入或公开第三方应用的许可。[NCAA.com Terms of Service](https://www.ncaa.com/tos)
- Football Web Pages 的 API 文档明确给出 API 访问对象、用途、认证和限流，但没有公开数据许可或 schema 文件。不能把网页能读、API 路由被文档提到或“免费”理解成对本地模型/公开作品集的授权。[Football Web Pages API](https://www.footballwebpages.co.uk/api)
- NCAA 数据比 TactiScout 当前职业联赛源多的是美国大学发现范围，不是更广的全球职业转会市场；Football Web Pages 可能拓展英格兰基层，但既有源已覆盖部分主流联赛，而其免费 API 权限对象不匹配。故二者都不改变“候选范围须按数据源实际覆盖说明”的产品要求。

## 最小下一步

1. **先问 NCAA 权利方一次，不访问数据接口。**确认是否有可用于个人、公开作品集项目的官方球员统计 API/批量 feed，并逐项询问：自动查询、最小字段的本地保存及期限、本地 Ollama 推理、私有 embedding/RAG、公开具名球员事实和派生报告、署名/链接要求、可用统计范围和 freshness。使用官方[统计与媒体资源联系人入口](https://www.ncaa.org/championships/statistics-and-records/)；不提交球员数据样本。
2. 只有拿到书面许可和机器接口契约后，再计划单个赛季/分区的无模型、无落盘 schema smoke；该 smoke 通过后再分别确认模型与公开展示权限，不自动开启这些处理。
3. Football Web Pages 当前免费 API 明确限于俱乐部官网，所以不为一般作品集继续申请。除非先取得 provider 对本应用形态的书面例外许可，否则不做技术验证。

## 核查的一手来源

- NCAA：[2026 NCAA 男足当前个人统计榜](https://www.ncaa.com/stats/soccer-men/d1/current/individual/573) · [统计/历史数据入口](https://www.ncaa.org/championships/statistics-and-records/) · [NCAA.com Terms of Service](https://www.ncaa.com/tos) · [NCAA Statistics Policies and Guidelines](https://s3.amazonaws.com/fs.ncaa.org/Docs/stats/ForSIDs/Policies.pdf)
- Football Web Pages：[API 文档/用途限制/端点列表](https://www.footballwebpages.co.uk/api) · [站点条款](https://www.footballwebpages.co.uk/united-counties-league-division-one/terms-and-conditions)
