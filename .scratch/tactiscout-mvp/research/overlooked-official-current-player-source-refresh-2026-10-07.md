# 官方竞赛与联赛当前球员数据：遗漏来源复核

核查日期：2026-10-07。范围：仅检查 UEFA、FIFA、AFC、CAF、CONMEBOL、联赛和赛事组织方自己的页面、条款与公开数据产品信息，寻找覆盖 2026/27 或仍在进行赛季、含具名球员表现字段的来源。没有登录、申请密钥、探测未公开接口或绕过访问控制；网页可见不视为可自动采集许可。本记录是工程准入判断，不构成法律意见。

## 结论

**本轮发现了数个遗漏的当前赛季官方统计页面，但没有找到一个同时公开文档化数据接口、免费或开放访问、允许自动采集与本地保存、并明确允许将球员记录交给 LLM 处理的来源。** 因此，没有新增来源可以直接作为 TactiScout 的自动球员仓库。

最值得保留为**人工核验链接**的是 UEFA Champions League 2026/27 官方球员统计页：当前页面有具名球员及进球、助攻、速度、射正、传球准确率、抢断、球权回收和扑救等指标。不过 UEFA 条款明确禁止自动抓取、系统性建库，以及将内容用于开发或训练任何软件、模型或 AI 工具。公开页面不能进入 Agent 的检索、RAG、提示词或评分数据流。

CAF 条款是一个值得留意的正式联系入口：条款提到 CAF feeds/APIs，并允许在自有网站显示这些 feeds/APIs，要求署名与回链。但我没有找到公开的 API 文档、访问注册、价格、球员统计 schema 或当前数据刷新说明；故不能据此声称存在可用的免费球员统计 API。

## 候选排序

这里按“对球探研究的参考价值”排序；**排名不代表获准接入**。

| 排名 / 来源 | 公开页面和当前性 | 有用球员数据 | 接入、刷新、key 与费用 | 使用边界与判断 |
|---|---|---|---|---|
| 1. **UEFA Champions League** | 官方统计页标为 2026/27，当前赛季榜单中已有具名球员行。[赛事统计](https://www.uefa.com/uefachampionsleague/statistics/) · [球员统计页](https://www.uefa.com/uefachampionsleague/statistics/players/) | 公开榜单包括进球、助攻、最高速度、射正、传球准确率、抢断、球权回收、门将扑救；比赛开始后页面显示当前赛事累计榜。它没有形成广泛候选池，也不提供本页可复核的年龄、合同、估值或全联赛球员名单。 | 未找到公开 player-data API 文档、免费 API key/配额或公开价目。UEFA Data Products Portal 展示业务数据产品，并要求联系 Business Data Management 团队；页面没有公布球员 feed 的接口、价格或自助申请方式。[UEFA 数据产品](https://data.uefa.com/products/) | UEFA Terms §6.2 限定个人、非商业的平台浏览；禁止系统性收集建库、用机器人/爬虫/脚本采集，以及用内容开发或训练软件、模型、算法或 AI 工具。[UEFA 条款](https://www.uefa.com/termsconditions/) 2026/27 UCL 规则 §12.02 还称比赛及球员参与相关数据和统计（含数据库）归 UEFA 独有。[赛事数据权利](https://documents.uefa.com/r/Regulations-of-the-UEFA-Champions-League-2026/27/Article-12-Intellectual-property-rights-Online) **仅供人工浏览定位指标；不得当自动 Agent 数据源。** |
| 2. **Bundesliga** | 官方 2026/27 球员统计页覆盖当前赛季。[球员统计](https://www.bundesliga.com/en/bundesliga/stats/players) | 进球、助攻、射门、开放式传球成功率、对抗、空中对抗、冲刺、跑动距离和速度，指标维度在本轮联赛页中较丰富。 | 未找到公开统计 API、开发者 key、免费计划、价格或稳定刷新 SLA。 | Legal Notices 保留网站内容的权利，并禁止自动程序/bot访问、分析或下载（包括 AI 相关用途）。[法律声明](https://www.bundesliga.com/en/bundesliga/info/legal-notices) **不要接入爬虫或把网页数据送入模型。** |
| 3. **Serie A** | 官方站点有 2026/27 赛季统计和球员比较入口。[统计页](https://www.legaseriea.it/serie-a/statistiche) · [球员比较](https://www.legaseriea.it/serie-a/statistiche/confronto-club-giocatori) | 官方个人表现文章包含 xG、关键机会、最后三区传球和渐进带球等球探相关字段。[个人统计文章](https://www.legaseriea.it/serie-a/news/leader-e-specialisti-chi-domina-le-statistiche-individuali) 这些文章不等于有可批量使用的完整球员数据表。 | 未发现公开 API 文档、key、免费额度、价目或更新 SLA。`dapi.legaseriea.it` 根域显示 API 版本标识，但没有公开 schema/访问条款；没有探测其路径或调用接口。 | 官方使用条款限制数据集提取，包括 data mining、robots 或类似工具；获取官方数据需书面许可。[使用条款](https://en.legaseriea.it/terms-and-conditions) 官方 True Data 声明也表示赛事数据不是可自由使用资源。[True Data](https://www.legaseriea.it/serie-a/news/al-via-la-campagna-true-data-a-tutela-del-dato-ufficiale) **指标参考价值高，自动接入不准入。** |
| 4. **Saudi Pro League (SPL)** | 官方统计中心有 2026/27 赛季筛选。阿拉伯语页的当前索引结果显示具名球员，以及出场、分钟、进球、助攻和牌；栏目包括 General、Attack、Passes、Defence。[球员统计中心](https://www.spl.com.sa/ar/stats/players) 但同日英文页显示“Player statistics are currently unavailable for the selected season”，说明英文页面当前访问不稳定。[英文统计页](https://www.spl.com.sa/en/stats/players) | 官方主页出现基于 Performance Index 的球员榜；统计中心标出一般、进攻、传球、防守分类。当前可查资料未给出各分类完整字段定义或评分方法。 | 未发现公开 API 文档、key、配额、费用、导出格式或更新 SLA。SPL 公告称 Opta feeds 支持公开 stats hub 和 app，同时完整 Opta Vision tracking / on-ball event / fitness / predictive 数据提供给俱乐部分析部门；不能把俱乐部数据包推定为公众可用。[Opta 合作公告](https://www.spl.com.sa/en/news/spl-clubs-embrace-optaai-in-expanded-stats-perform-partnership) | Terms §13 限制未经书面许可、会在短时间内制造大量请求的机器人/爬虫/离线阅读器；§14 禁止超出普通用户行为逆向协议；§27 禁止未经事前书面同意为公开或商业目的复制、传播或制作衍生内容。[SPL 条款](https://www.spl.com.sa/en/terms-and-conditions) 页面也不授予本地数据库或 LLM 使用许可。**先联系 SPL 取得书面授权，不自动采集。** |
| 5. **Premier League** | 官方 2026/27 stats 页面有球员进球、助攻、传球等榜单。[球员统计](https://www.premierleague.com/en/stats?se=85) 官方说明表现数据由 Opta/Stats Perform 收集分析。[统计口径](https://www.premierleague.com/en/stats/clarification) | 可见进球、助攻、总传球、零封等榜单，且为 EPL 当前赛季数据；不是可证明完整 roster 或转会可得性的来源。 | 未找到公开数据 API 文档、免费 key 或公开费率。官方许可问题指向 Football DataCo 的 match-data permission 渠道。[官方许可指引](https://www.premierleague.com/en/news/102426) | Terms §52–59 限制下载内容的用途，并禁止未经书面批准建立含官网材料的数据库、再利用或再分发。[PL 条款](https://www.premierleague.com/en/terms-and-conditions) 当前 `robots.txt` 没有针对所有 stats 页面的一条明显全站封锁，但它不是内容授权；条款仍然限制数据入库。**仅人工浏览，或走正式许可。** |
| 6. **LaLiga / Ligue 1** | 两者均有当前赛季球员榜。LaLiga 示例展示射手榜和传球榜；Ligue 1 Data Zone 有球员零封等榜单。[LaLiga 射手榜](https://www.laliga.com/en-GB/stats/laliga-easports/scorers) · [LaLiga 传球榜](https://www.laliga.com/en-GB/stats/laliga-easports/passes) · [Ligue 1 Data Zone](https://ligue1.com/en/data-zone/1/season-stats) · [Ligue 1 零封榜](https://ligue1.com/en/data-zone/ligue1mcdonalds/season-stats/players/cleanSheets) | 当前可见指标以进球、出场、传球、助攻、零封等基本榜单为主；本轮没有找到公开的统一战术/推进指标 schema。 | 未发现开放球员 API、key、配额、公开价格或 SLA。 | LaLiga 法律页授权个人非商业浏览，复制/复用须权利人许可。[LaLiga 条款](https://www.laliga.com/en-GB/legal/legal-web) Ligue 1 CGU 限制通过其提供的界面访问网站，内容复制或复用要事先书面许可。[LFP 条款](https://ligue1.com/fr/legal/cgu) **不自动采集或入库。** |
| 7. **CONMEBOL Libertadores** | 官方统计页标为 2026 Tournament Stats 并有 Player Ranking 标题；赛事当时仍在进行。[赛事统计](https://gol.conmebol.com/libertadores/en/tournament-stats) 页面提示登录/注册后访问全部比赛内容。 | 本轮官方可读取页面仅确认有球员排名区，没有取得可验证的字段 schema。官方编辑文章会引用具名球员的进球/助攻和阶段表现，但不能视为全体球员统一数据表。 | 未找到 public API docs、key、价格、配额或数据更新频率。没有登录、尝试隐藏接口或批量收集。 | 官方平台条款将 CONMEBOL 内容限定为个人、非商业用途；没有授予本地长期存储或模型处理许可。[CONMEBOL 平台条款](https://gol.conmebol.com/libertadores/en/terms-and-conditions) **这是一个当前页面线索，不是可用的候选池来源。** |

## 其他赛事组织方的排除结果

- **CAF Champions League 2026/27：**当前赛季预选赛在 2026 年 9 月开始，官方日历把小组赛排在 2026 年 11 月至 2027 年 1 月。[官方赛程](https://www.cafonline.com/news/caf-announces-match-calendar-for-totalenergies-caf-champions-league-2026-27-and-totalenergies-caf-confederation-cup-2026-27-seasons) 本轮找到的是官方新闻、赛前人物和少量比赛统计稿，未找到当前赛季具名球员表现数据库或 API 文档。CAF Terms §4.1 限定平台内容为私下非商业访问；§4.9 确有一项例外，允许在自有网站展示 CAF feeds/APIs，并要求正确署名、尽可能回链。[CAF Terms](https://www.cafonline.com/en/terms-of-service/) 但官方公开资料未说明球员数据 API 是否存在、如何申请、是否免费、字段及刷新频率，也未说明可本地保存或交给 LLM。**可向 CAF 询问 feed/API 产品，不能按公开页面自行实现。**
- **AFC Champions League Elite 2026/27：**官方页面确认联赛阶段已在 2026 年 9 月开始，并持续发布 Player of the Match / 比赛人物新闻，但本轮没找到含可验证球员统计 schema 的当前赛季公开 API 或标准榜单。[AFC 官方竞赛页](https://www.the-afc.com/en/club/afc_champions_league_elite.html) 官方 stats 子站在本次只读浏览中返回 502，未重试规避。AFC Terms §§7、12 只许可个人非商业用途，并要求经其提供的界面访问；复制、商业或非商业利用网站内容均须事先书面同意。[AFC 条款](https://www.the-afc.com/en/legal/terms__conditions.html) **不把 AFC stats 子站错误页当成可访问数据，也不探测其内部端点。**
- **FIFA World Cup 2026：**官方赛后球员统计覆盖 attacking、distribution、defending、movement、physical 等类别，并有球员级赛事表现；但世界杯决赛已于 2026-07-19 结束，不能算 2026/27 正在更新的候选人表现源。[官方球员统计](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/statistics/player-statistics?searchOverlay=1) · [决赛结果](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/final-tournament-standings) FIFA Terms §5.1 将 feeds 与 FIFA API 都列为其拥有或许可的内容；§5.3 限定个人、非商业平台使用，§6.4 仅另行许可在非商业网站显示 FIFA 内容并署名，没有在本轮发现公开球员 API 文档或本地存储/LLM 授权。[FIFA Terms](https://legal.fifa.com/terms-of-service) **适合作为已结束赛事的人工参考，不是当前赛季数据源。**

## robots.txt 与许可核对

robots.txt 只规定搜索爬虫抓取路径，不能替代内容许可。已用只读方式检查官方 robots 文件：UEFA、Premier League、LaLiga 和 FIFA 文件可读取；Bundesliga、Serie A、Ligue 1、SPL、CONMEBOL、AFC、CAF 的 robots 文件在本次官方页面读取器中不可访问。不可访问不代表允许抓取，也没有尝试绕过。LaLiga robots 可见 stats 路径允许搜索爬虫，但 LaLiga 条款仍仅授权个人非商业浏览；PL 的 robots 文件没有广泛封禁所有 stats 页面，但其条款仍禁止未经许可建立数据库。对 TactiScout 来说，最终以 API/许可文件为准，而不是以 robots 的 Allow 或文件抓取错误为准。

## TactiScout 下一步建议

1. **本轮没有新发现可直接接入的官方免费球员统计源。**继续用现有明确可用的数据范围做 Agent 与评估；不要因官网打开无需登录就加入自动 scraper。
2. UEFA UCL、Bundesliga、Serie A、PL、LaLiga、Ligue 1、SPL 和 CONMEBOL 页面可以作为研究人员人工打开的来源链接，用于解释数据术语或检查公开叙述。不要保存逐球员网页数据，不要把网页内容作为本地 LLM prompt/RAG/评分输入，也不要在 TactiScout 报告中复制其统计表。
3. 如果要扩成官方当前赛季数据，按正式渠道先问授权与产品文档：CAF（条款提及可显示的 feeds/APIs，但产品未知）、UEFA Business Data Management、Premier League 的 Football DataCo。问题要覆盖免费/付费、球员赛季与逐场字段、更新频率、可否本地缓存、可否给本地 LLM、可否在作品集演示中展示。拿到明确许可和 schema 后再实现 provider。
4. 当前能得出的最优路线是“保留已准入来源 + 官方页面作人工研究索引”，而不是把这些网站当作免费公共 API。

## 主要官方来源

- [UEFA Champions League 2026/27 player statistics](https://www.uefa.com/uefachampionsleague/statistics/players/) · [UEFA General Terms](https://www.uefa.com/termsconditions/) · [UEFA Data Products](https://data.uefa.com/products/)
- [Premier League player statistics](https://www.premierleague.com/en/stats?se=85) · [PL Terms](https://www.premierleague.com/en/terms-and-conditions) · [Football DataCo permission guidance](https://www.premierleague.com/en/news/102426)
- [Bundesliga player statistics](https://www.bundesliga.com/en/bundesliga/stats/players) · [Legal notices](https://www.bundesliga.com/en/bundesliga/info/legal-notices)
- [LaLiga statistics](https://www.laliga.com/en-GB/stats/laliga-easports/scorers) · [LaLiga legal terms](https://www.laliga.com/en-GB/legal/legal-web)
- [Serie A statistics](https://www.legaseriea.it/serie-a/statistiche) · [Serie A Terms](https://en.legaseriea.it/terms-and-conditions)
- [Ligue 1 Data Zone](https://ligue1.com/en/data-zone/1/season-stats) · [LFP CGU](https://ligue1.com/fr/legal/cgu)
- [SPL player statistics](https://www.spl.com.sa/ar/stats/players) · [SPL Terms](https://www.spl.com.sa/en/terms-and-conditions)
- [CONMEBOL Libertadores stats](https://gol.conmebol.com/libertadores/en/tournament-stats) · [CONMEBOL Terms](https://gol.conmebol.com/libertadores/en/terms-and-conditions)
- [AFC Champions League Elite](https://www.the-afc.com/en/club/afc_champions_league_elite.html) · [AFC Terms](https://www.the-afc.com/en/legal/terms__conditions.html)
- [CAF 2026/27 calendar](https://www.cafonline.com/news/caf-announces-match-calendar-for-totalenergies-caf-champions-league-2026-27-and-totalenergies-caf-confederation-cup-2026-27-seasons) · [CAF Terms](https://www.cafonline.com/en/terms-of-service/)
- [FIFA World Cup 2026 player statistics](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/statistics/player-statistics?searchOverlay=1) · [FIFA Terms](https://legal.fifa.com/terms-of-service)
