# 新增当前赛季球员数据源：技术可用性与权利边界

核查日期：2026-10-08。仅核对本目录先前未提及的 provider/repository 的官方文档、服务条款与 README；没有注册账户、使用凭据、调用球员数据端点、下载或保存球员行，也没有尝试绕过访问限制。结论是工程准入判断，不构成法律意见。

## 决定

**没有找到一个新来源能清楚通过当前赛季、数据访问、本地长期留存、本地 LLM/RAG 和作品集公开展示全部准入项。**新发现中，**Live Football API 是最实用的条件候选**：新账户可获 500 次免费调用，API 有当前赛季阵容和实名球员表现端点；服务条款明确允许把 API 数据用于自有应用并再分发给应用用户，定价页称所有计划可商业使用且无须归因。但条款没有明确写本地持久留存、LLM 推理、embedding 或 RAG，也没有说明上游数据授权链；文档球员指标主要是出场、进球、助攻和牌，缺少分钟与战术统计。因此，当前可做的是小范围技术候选评估计划，**不是已准入的 TactiScout LLM/RAG 数据源**。

| 新线索 | 技术与赛季 | 访问 / 留存 / LLM / 公开演示 | 判断 |
|---|---|---|---|
| **Live Football API** ([docs](https://www.live-football-api.com/docs) · [terms](https://www.live-football-api.com/terms) · [pricing](https://www.live-football-api.com/pricing)) | `team_squad` 文档称省略 season 参数即取当前赛季；例子字段有 provider player ID、姓名、位置、号码、年龄、出场、进球、助攻与牌。`player` 有生日、位置、惯用脚、身高/体重、市场估值与生涯赛季汇总；`player_matches` 有逐场进球/助攻/牌/首发。它能形成成年筛选入口和基础 box-score 证据，**不能支持分钟归一化或精细战术能力评分**。文档响应示例仍以 2024/25 为主，故 2026/27 目标赛事、当前 roster 完整性和实际更新状况未验证。 | **访问：**新账户 500 credits、免信用卡，常见球员端点每次 1 credit；需要账户 API key，并非匿名开放数据。**留存：**Terms §§5–6 允许在自己的 app 中使用及向终端用户再分发 API 数据，但没有明确缓存/永久本地留存期限。**LLM/RAG：**公开 Terms、Docs 没有 LLM、embedding、模型输入或 RAG 授权文字；持久向量化无明确许可。**公开：**Terms 明确允许在应用/产品中再分发；Pricing 称所有计划含商业使用许可、无须归因。仍须核实 provider 的上游授权范围；避免默认使用球员照片、队徽等媒体。Terms 禁止公开 API key。 | **条件 GO，需先补条款确认。**目前不将其登记为已准入的持久化/LLM/RAG/公开原始统计来源。 |
| **FPL Core Insights** ([README/repository](https://github.com/olbauday/FPL-Core-Insights) · [2026/27 data directory](https://github.com/olbauday/FPL-Core-Insights/tree/main/data/2026-2027) · [Premier League Terms](https://www.premierleague.com/en/terms-and-conditions) · [FPL Terms](https://fantasy.premierleague.com/help/terms)) | 新 README 声称有 2026/27 球员/赛季表、每场球员统计（含 xG/xA、射门、传球、抢断、拦截、对抗等），并每天自动更新两次。它是可见的公开 repo，不代表其许可已确认。 | README 说可将数据用于网站、博客或其他项目并“尽可能”回链，但仓库根目录文件清单没有显示正式数据许可证；数据来源包括官方 FPL API 和作者所称的手工整理“Opta-like”比赛统计。Premier League Terms 的 **Intellectual Property Rights** 部分限制未经书面批准再利用/再分发网站或 App 内容及建立含该内容的数据库；FPL Terms 也已在既有项目研究中确认限制自动系统读取/提取。README 的宽泛邀请不能解决上游权利、留存、LLM/RAG 或公开逐球员行的许可。 | **NO-GO。**当前且字段丰富，但不能按公开 repo 或非商业用途推断数据可自由再用；不下载、不接入。 |

## 推荐的非商业本地原型路径

Live Football API 是本轮最强的新技术线索。若服务方书面确认“持久本地保存选定字段、将选定字段传给本地推理模型、模型生成报告对外展示具名球员统计”均在许可范围内，可做一联赛/一赛季/少数球队的只读原型：

1. 用户自行申请免费 key；服务端保存密钥，不放在公开代码或浏览器端。500 次额度足够小型 schema/freshness 验证，但不是持续更新的生产免费额度。
2. 从 league/team 目录选一支球队，用 `team_squad` 取当前赛季名单；只在响应确实提供年龄时纳入 18+ 球员。保留 provider 原生 ID，不按姓名跨源合并。对少量入选者再取 `player_matches`，并明确仅比较出场、进球、助攻、首发和牌等实际字段。
3. 若获准保存，将数据放在本地关系型表，以 SQL/工具调用按需选出少量事实给本地模型解释；先不把供应方原始行做持久向量 embedding。页面注明 provider、赛季、抓取时间和指标范围，并避开照片/队徽。模型不应把基础 box score 包装为完整战术能力评估。

**进入真实数据原型前，先向服务方索取一封书面确认**：可否在个人本地 DB/checkpoint 持久缓存球员字段及多久；可否用于本地 LLM 单次推理、embedding/RAG 与报告生成；可否在公开作品集展示具名球员及逐人原始统计；供应方是否有权授予上述范围的下游使用。联系地址见 Terms：`legal@live-football-api.com`。确认前，继续以项目已有明确许可的历史样本或合成球员行为验证本地检索与报告路径，不写入真实球员行。

## 一手来源

- Live Football API：[API 文档（`team_squad` / `player` / `player_matches`）](https://www.live-football-api.com/docs) · [Terms of Service（2026-01-01，v2.1，§§5–9）](https://www.live-football-api.com/terms) · [Pricing（500 免费额度、每端点成本、归因说明）](https://www.live-football-api.com/pricing)
- FPL Core Insights：[repository README](https://github.com/olbauday/FPL-Core-Insights) · [2026/27 数据目录](https://github.com/olbauday/FPL-Core-Insights/tree/main/data/2026-2027) · [Premier League Terms of Use（知识产权及再利用限制）](https://www.premierleague.com/en/terms-and-conditions) · [FPL Terms](https://fantasy.premierleague.com/help/terms)
