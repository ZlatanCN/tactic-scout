# 下一条当前赛季表现源：J.League 官方球员统计

核查日期：2026-10-08。只查了 J.League、Data Stadium 及候选 API 提供方的一手页面和条款；没有调用数据接口、下载球员名单或将数据写入仓库。目标是扩展 FPL、ASA、英超 Pulselive 和 Understat 五大联赛之外的具名球员表现覆盖。

## 建议

**J.League 官方球员统计有补充指标价值，但当前不适合作为完整候选池，也没有找到可直接采用的机器接口。**它能填补日本 J1/J2/J3，并提供 Understat 不覆盖的对抗、拦截、跑动距离、冲刺和最高速度等可观察维度。官方 HTML 的指标“View more”榜单目前只渲染有限名次（核验的 scorer 页为十名），未见完整球员目录/明确分页；对有限榜单做并集会偏向榜单领先者，不能称为该联赛候选库。公开官方资料也没有公开 developer API 合约；页面注明复制/转载文字或图片需要许可，条款要求合法使用且保留权利。批量留存、LLM/RAG 输入或作品集具名展示授权未确认。

这是一条**有条件的源谈判任务，不是马上实现 provider**。官方统计页把“按比赛后 1–3 天更新”作为预期，但仍需用获准的正式接口验证 roster 覆盖、字段定义、freshness 和单球员身份键。数据站称赛事记录由 J.League 数据中心管理，并与 Data Stadium 合作；Data Stadium 是应确认授权/交付方式的相关方。[J.League 数据管理说明](https://www.jleague.jp/corporate/activities/various_rights/) · [使用条款](https://www.jleague.jp/sp/general/kiyaku.html?mode=pc)

## 一手资料核验

| 项目 | 官方页面证据 | 对 TactiScout 的意义 |
|---|---|---|
| 当前赛季和新地域 | J1、J2、J3 官方统计页面列出 2026/27 赛季；J.League Data Site 也提供注册球员入口。[J1](https://www.jleague.jp/en/j1/stats/player/) · [J2](https://www.jleague.jp/en/j2/stats/) · [J3](https://www.jleague.jp/en/j3/stats/player/) · [球员登记目录](https://data.j-league.or.jp/SFIX03/) | 与现有五大联赛、MLS/North America 等来源互补。可按 J1/J2/J3 逐赛区限定，不代表全球候选池。登记目录和表现排名是不同页面，尚未证实能靠稳定 ID 完整连接。 |
| 能力字段 | 当前页面可见进球、助攻、争顶/地面对抗赢球、拦截、空中对抗、射门、传球准确率、总跑动距离、冲刺和最高速度等分类。[官方 J1 统计](https://www.jleague.jp/en/j1/stats/player/) · [官方 J3 拦截/空中对抗](https://www.jleague.jp/en/j3/stats/player/) · [官方 J1 最高速度](https://www.jleague.jp/en/j1/stats/player/2026-27/top_speed/search-list/) | 比只含 xG/xA/射门构建数据面的指标更适合“跑动、对抗、防守参与”等用户需求；必须只呈现实际提供的定义。总量指标要核实分钟分母，不可直接跨位置或跨联赛排名。 |
| 更新情况 | J.League 公布 J1/杯赛赛后约 1–2 天、J2 约 2 天、J3 约 2–3 天更新。2026-10-08 官方页面快照显示 J1 更新于 2026-09-21、J2 于 2026-10-06、J3 于 2026-09-28。[更新说明与 J3 时间戳](https://www.jleague.jp/en/j3/stats/player/) · [J1 时间戳](https://www.jleague.jp/en/j1/stats/player/) · [J2 时间戳](https://www.jleague.jp/en/j2/stats/) | 有赛后目标更新窗口，但页面实测更新时间并不一致；每次检索仍要报告页面时间戳。J1/J3 页面当时显著早于 J2，需结合实际赛程核实，不能只照搬更新承诺。 |
| 自动访问 | 页面提供 HTML 统计榜与“View more”榜单；J.League Data Site 提供网页筛选。官方 J1/J2/J3 player-stat HTML 页的实读视图呈现每个榜单的前十名，未显示完整候选目录或可复用分页合同；公开资料未找到 developer portal、稳定 API schema、调用配额或下载格式。 | 不调用或绕过隐藏网页请求/未文档化 JSON endpoint。该页面只能作人工球探核对线索，不足以成为 TactiScout 候选来源。 |
| 保存、模型和展示 | J.League 网站注明未获许可不得复制/转载其文字或图片；一般条款要求合法使用、保留 J.League 定义的权利，并未授予 TactiScout 批量数据库、缓存、AI/RAG 或对外派生报告的权利。[球员统计页权利提示](https://www.jleague.jp/en/j1/stats/player/) · [J.League 使用条款](https://www.jleague.jp/sp/general/kiyaku.html?mode=pc) | 留存期限、Ollama/LLM 输入、embedding/RAG、派生排名与作品集展示目前均为**未知，须单独书面确认**。仅人工浏览与技术可访问不等于这些用途获准。 |

## 为什么不是先接其他免费 API

- **SportScore** 的官方文档称其 key-free 公共接口覆盖 player stats 与 metadata，API 条款允许缓存及组合为分析/仪表板，但要求每个展示数据的页面放可见 dofollow attribution，并禁止镜像原始响应。其公开 endpoint 描述只明确“player stats + metadata”、联赛 goals/assists 榜；没有结构化指标字典、赛季 roster 完整性或逐字段上游来源保证。它可作以后低风险技术 smoke，不足以替代 J.League 官方统计做有解释力的能力评估。[API 文档](https://sportscore.com/developers/) · [API 条款](https://sportscore.com/developers/terms/)
- **OpenFootAPI** 的官方文档有各赛事 source/license 元数据、阵容/事件/单场 xG；但文档未列具名球员的全赛季表现表，Developer 才开放事件、阵容和 xG，官网标价 US$14/月。它可用来验证跨赛事比赛级证据管线，不是最直接的免费球员表现主库。[API 覆盖与资源](https://openfootapi.com/docs) · [套餐](https://openfootapi.com/pricing) · [条款](https://openfootapi.com/terms)

## 推荐 issue

**标题：评估 J.League 授权数据交付是否值得作为后续来源**（若启动联系，建议标签：`ready-for-human`）。这条路线是可选的授权谈判，不是当前 provider 实施任务；本项目会继续寻找不依赖付费 API、具备完整候选列表与可解释能力指标的来源。

验收边界：

1. 确认 J.League/Data Stadium 是否提供当前赛季 J1/J2/J3、杯赛球员数据的正式 API/feed/导出及稳定 ID；确认更新窗口、分页、配额、字段定义、roster 完整性和使用费用。
2. 书面确认本地缓存/数据库期限、向本地模型传入事实、embedding/RAG、生成并公开展示具名球员派生指标、署名和部署域名是否获准；分别记录来源授权与服务方条款。
3. 仅在以上准入后，先对一个联赛/一个赛季做有界 smoke：检查稳定球员键、球队/赛季归属、分钟与位置字段、更新时间、目标能力指标非空率及缺失语义；禁止按姓名跨源自动合并。
4. 再用一个 LangGraph 案件验证：自然语言提出日本联赛引援需求，工具说明可用联赛/字段范围，Agent 检索并引用每名候选人的官方来源和观测日期，Reviewer 阻止把总量数据误作 per-90 或完整球探能力。
5. 若拿不到正式访问或使用许可，issue 以 `wontfix`/记录原因关闭；保留官方链接作为人工核对来源，不实现隐藏 endpoint 抓取。

## 官方来源

- [J.League 官方球员统计：J1](https://www.jleague.jp/en/j1/stats/player/) · [J2](https://www.jleague.jp/en/j2/stats/) · [J3](https://www.jleague.jp/en/j3/stats/player/)
- [J.League Data Site：球员登记目录](https://data.j-league.or.jp/SFIX03/)
- [J.League：官方记录、数据中心与 Data Stadium](https://www.jleague.jp/corporate/activities/various_rights/)
- [J.League 网站使用条款](https://www.jleague.jp/sp/general/kiyaku.html?mode=pc)
- 对照：[SportScore API](https://sportscore.com/developers/) · [SportScore Terms](https://sportscore.com/developers/terms/) · [OpenFootAPI Docs](https://openfootapi.com/docs) · [OpenFootAPI Terms](https://openfootapi.com/terms)
