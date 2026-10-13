# Impect 与 StatsBomb：历史球员表现池扩展审查

核查日期：2026-10-07。只检查提供方官方 GitHub 仓库、数据文件、README 和随仓库发布的许可文件页面。没有下载数据到工作区、没有做本地导入或业务代码修改。这里区分“仓库可公开下载”与“获准在项目中留存、展示或交给模型处理”；本报告是工程准入判断，不是法律意见。

## 结论

**如果许可得到确认，Impect Open Data 比 StatsBomb Open Data 更适合扩展 TactiScout 的历史球员表现池。**Impect 发布的是 Bundesliga 2023/24 单季数据，包含逐场球员/位置 KPI、出场时长、阵容和替补、球员主数据及 KPI 定义。它适合构造一个边界清楚、具备实际球员样本和可解释能力指标的历史评估集。它不是当前赛季数据，也不包含转会市场、薪资、合同或当前可引进状态。[Impect README](https://raw.githubusercontent.com/ImpectAPI/open-data/main/README.md)

Impect 的赛季清单将本季标为迭代 `743`、`1. Bundesliga`、`23/24`、数据版本 `V3`，记录 `lastChangeTimestamp` 为 2025-10-06。比赛清单覆盖第 1 至第 34 轮，比赛 ID 从 `122838` 到 `123143`；端点 ID 的闭区间正好是 306 个编号，且清单样例明确有 `available: true`。这支持“完整 306 场赛季”的数据源判断；真正接入时仍应在解析器验收中断言 306 条去重比赛记录、各自的可用状态和 player KPI 文件覆盖，而不能只信编号区间。[迭代清单](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/iterations.json) · [比赛清单](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/matches/matches_743.json)

**StatsBomb 能提供更细的事件与阵容证据，但选定比赛集不等于当前或完整赛季球员库。**实际读取其 2023/24 德甲比赛文件可以看到具体日期：包括 2023-10-08、2024-04-06、2024-05-18 的 1. Bundesliga 比赛，并非仅由赛事 manifest 的季名推断；但该文件本身是有限比赛集合，无法据此声称有完整 306 场德甲或当前球员赛季池。StatsBomb 结构主要是比赛事件和阵容，另有仅覆盖部分比赛的 360 数据；其 2024 年欧洲杯/美洲杯提供历史国家队事件数据，不解决俱乐部现役球员完整池。[StatsBomb README](https://raw.githubusercontent.com/hudl/open-data/master/README.md) · [StatsBomb 2023/24 德甲实际比赛清单](https://raw.githubusercontent.com/hudl/open-data/master/data/matches/9/281.json) · [StatsBomb 当前赛事/赛季清单](https://raw.githubusercontent.com/hudl/open-data/master/data/competitions.json)

**许可是 Impect 方案的当前阻塞点。**Impect 仓库可公开浏览和下载，但 README 明确说使用数据即同意 `LICENSE.pdf` 的完整条款，并要求研究或项目注明 Impect、使用官方标志。该 PDF 的 GitHub 页面本次只能看到文件元数据，无法提取 PDF 条款正文。因此，不能据此认定允许私有留存、公开展示衍生球员数值、将数据送入本地 Ollama/第三方 LLM，或再分发原始数据。公开可下载不等于项目可以自由使用。[Impect README 的许可与归因说明](https://raw.githubusercontent.com/ImpectAPI/open-data/main/README.md) · [Impect LICENSE.pdf](https://github.com/ImpectAPI/open-data/blob/main/LICENSE.pdf)

StatsBomb README 鼓励研究使用，并规定公开分享/发布基于数据的分析时应注明 StatsBomb 并使用其标志；但这不替代随仓库提供的 [Public Data User Agreement](https://github.com/hudl/open-data/blob/master/LICENSE.pdf)。该 PDF 条款正文本次同样无法提取。故“仓库可下载”可以确认；对项目的本地持续存储、公开显示、数据再分发以及 LLM 输入权限仍不能作肯定结论。当前推荐先按历史数据源规划 Impect 的受限方案，但**在许可文字或权利人书面确认前不导入、不公开展示、不把其内容送进模型**。

## 能力与 schema 对比

| 维度 | Impect Open Data | StatsBomb Open Data |
|---|---|---|
| 覆盖 | README 明示 2023/24 男子德甲。迭代 743；比赛清单贯穿第 1–34 轮，ID 区间为 122838–123143（306 个编号）。当前赛季以外的历史静态快照。 | 多个被选中的赛事和赛季，包含 2023/24 德甲样本、2024 男子欧洲杯和美洲杯等；当前 manifest 没有 2026/27 赛季。检查真实比赛文件可确认 2023/24 德甲日期，但没有证据把该文件说成完整 306 场赛季。 |
| 球员池组成 | 逐场 KPI 有球员 ID、比赛、位置、`playDuration`（秒）、`matchShare`、`kpis[{kpiId,value}]`。另有按迭代组织的球员/球队主数据、逐场阵容/换人、比赛清单和 KPI 定义。 | 事件 JSON、比赛阵容 JSON，及部分比赛的 360 JSON。可从出现过的历史比赛中派生统计，但仓库 README 没有把它定义为统一的完整赛季球员 KPI 表。 |
| 能力指标 | 官方 KPI 定义含 `BYPASSED_OPPONENTS`（推进中绕过对手）、多个压迫/对抗/射门和传球维度，以及 `PXT_PASS` 等 pxT 分量。逐场聚合有利于按赛季、位置、分钟进行可复算汇总。 | 事件粒度适合自行构造射门、传球、推进等统计；字段 schema 和比赛事件语义有官方文档。优势是事件可追溯和 360 样本，代价是需要自行聚合，且覆盖是选样。 |
| 球员主数据风险 | 主数据文件存在身份和当前球队字段；构造 2023/24 当季所属队应以当场阵容/比赛记录为准，不应将当前 `currentSquadId` 误解释为 2023/24 球队。 | 阵容是比赛时点信息；同样不能将历史俱乐部/年龄直接当作现役转会状态。 |
| 当前性 | 不是实时数据；比赛是 2023/24，迭代最近更改时间为 2025-10-06。 | 不是实时数据。manifest 中的 `match_updated` 时间可能晚于比赛年份，表示旧记录更新，不表示新赛季比赛；实际比赛文件核对到的德甲样本仍是 2023/24。 |
| 许可 | 技术上可从公开 GitHub 获取，但使用受未能读取的 Impect PDF 约束；README 要求署名和使用 logo。公开展示/衍生数据/模型处理许可未知。 | 技术上可从公开 GitHub 获取；README 对公开分析规定署名和 logo，另受未能读取的 User Agreement 约束。公开展示/再分发/模型处理需先核条款。 |

Impect KPI 的示例文件结构可由官方 `player_kpis_122838.json` 直接复核；官方定义文件将 KPI ID 映射为名称与解释，例如 `PXT_PASS` 解释为传球导致团队 goal threat 的变化，说明它不应被当成一般传球次数。项目必须保留每个 KPI 的来源定义、单位/聚合方式，并确认其能否跨比赛相加或按 90 分钟归一化；不能把所有 `kpis` 数字一律求和或直接当成球员评分。[Impect 首场 player KPI 样例](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/player_kpis/player_kpis_122838.json) · [KPI 定义](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/kpi_definitions.json)

## 下载、本地处理、公开展示与 LLM 的边界

| 动作 | 本次证据能确认什么 | 准入判断 |
|---|---|---|
| 浏览/下载公开文件 | 两个仓库公开，Impect README 给出了 clone 与 JSON 文件路径；StatsBomb README 说明仓库的 JSON 结构。 | **技术上可下载**。这只描述访问能力，不表示获得了具体项目使用许可。 |
| 在本机留存或解析原始数据 | 两个提供方都附有需要遵守的 PDF 条款；Impect 更明确写明使用即接受其条款。PDF 正文本次不可读取。 | **许可未确认**。不要据此假定非商业、个人学习或本地运行自然获准。 |
| 公开 TactiScout 派生数字、排行榜或球探报告 | 两边均有归因要求，但只靠归因要求不足以证明派生球员数据可公开展示。Impect 鼓励分享项目也不等于授予数据再分发/输出许可。 | **许可未确认**。需明确包含逐球员衍生统计、比较和截图/报告是否允许，以及归因/logo具体要求。 |
| 让本地 Ollama/Qwen 或远端 LLM 读取数据 | 官方 README 没有明确允许将数据输入模型；本地推理也仍是对数据的处理。两份许可 PDF 条款正文均未核实。 | **许可未确认**。在确认前不送原始 JSON、逐场 KPI 或基于它们的球员个人数值到模型上下文。 |
| 将原始文件、球员 KPI 或缓存提交到公开 GitHub | 公开仓库下载不等于获准再分发。 | **不要提交**，直到许可证明确准许。即便只提交小样本，也不能跳过许可判断。 |

## 推荐的有界 ingest 切片

许可通过后，先把 Impect 用作一个隔离的历史数据快照，而非默认现役候选源：

1. 固定源快照 ID：`impect-bl1-2023-24-v3`，记录迭代 `743`、数据版本、`lastChangeTimestamp`、下载日期、每个官方文件 URL 和文件校验值。
2. 第一个切片只抓 `iterations.json`、`matches_743.json`、`players_743.json`、`squads_743.json`、306 场 `lineups`、306 场 `player_kpis` 与 `kpi_definitions.json`。先不抓全量 `events/` 或 `events_kpis/`：逐场球员 KPI 已有位置和出场秒数，更直接支撑历史球员赛季池，事件明细只在之后某个指标无法由 KPI 覆盖时再开新范围。
3. 初始字段限定为 provider 球员/球队/比赛 ID、比赛日期、比赛日、阵容中的球队关系、位置、出场时长和经定义审查的 KPI。保留原值和定义；仅对明确可加的 count/value 做赛季合并，按累计分钟设置样本门槛后计算 per-90。比例、率、pxT 分量及带情境的 KPI 不要未经定义审查直接相加或标准化。
4. 生成确定性季节统计与覆盖报告：断言比赛恰为 306 个且 available、KPI 文件与比赛 ID 覆盖一致；记录球员数、不同位置数、分钟分布、关键 KPI 缺失率和各球队/轮次覆盖。用逐场阵容重建赛季队伍归属；不能使用现在的球队关系填回历史。
5. 只用于 `2023/24 历史基准/离线评估`。结果中标注赛季和提供方，不把它混成“当前候选名单”；不从此快照推断合同、可转会性、预算或 2026/27 当前状态。
6. 模型职责要与数据使用权分开：若确认条款只准程序分析或禁止模型输入，就让确定性代码计算并由报告模板展示；若条款明确允许本地模型处理，再考虑传入最小化的派生证据对象，并记录授权、输入字段和归因。不要把整个事件库/RAG 索引塞给 LLM。

StatsBomb 只在目标问题确实需要事件级、动作序列或 360 证据时作为另一历史来源；不要同时把两个历史源导入首个切片。若后续改选 StatsBomb，须单独核其 User Agreement，不得将 Impect 的答复套用于 StatsBomb。

## 唯一下一步许可确认问题

向 Impect 权利人一次性确认：**TactiScout 是非商业、公开 GitHub 作品集项目；我们希望在本地保留并解析 2023/24 Bundesliga Open Data，生成按球员/位置汇总的历史指标与候选比较，公开展示这些衍生结果并注明 Impect/使用官方标志，同时只将最小化的衍生指标提供给本地 Ollama/Qwen 解释。根据仓库所附 LICENSE.pdf，这些本地留存、衍生计算、公开展示和本地 LLM 处理是否都获准？若获准，原始数据/缓存哪些必须删除或不得分发，署名与标志有何具体要求？**

README 列出 `thomas.walentin@impect.com` 与 `florian.schmitt@impect.com` 作为数据疑问联系人；本次未向其发送消息。[Impect README 联系方式](https://raw.githubusercontent.com/ImpectAPI/open-data/main/README.md)

## 官方来源

- Impect：[README / 覆盖、目录结构、许可提示与联系人](https://raw.githubusercontent.com/ImpectAPI/open-data/main/README.md) · [迭代清单](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/iterations.json) · [比赛清单](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/matches/matches_743.json) · [player KPI 样例](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/player_kpis/player_kpis_122838.json) · [球员主数据](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/players/players_743.json) · [KPI 定义](https://raw.githubusercontent.com/ImpectAPI/open-data/main/data/kpi_definitions.json) · [LICENSE.pdf](https://github.com/ImpectAPI/open-data/blob/main/LICENSE.pdf)
- StatsBomb：[README / 授权用途和归因提示](https://raw.githubusercontent.com/hudl/open-data/master/README.md) · [competition/season manifest](https://raw.githubusercontent.com/hudl/open-data/master/data/competitions.json) · [实际 2023/24 德甲比赛清单](https://raw.githubusercontent.com/hudl/open-data/master/data/matches/9/281.json) · [Public Data User Agreement PDF](https://github.com/hudl/open-data/blob/master/LICENSE.pdf)

**核验限制：**本报告核验了仓库文件和官方字段样例，但没有在本机下载或逐条解析 306 场数据，也没有做 provider/API 集成测试。Impect 与 StatsBomb 的许可 PDF 页面可访问，但本次工具无法提取正文，因此没有对许可范围作推定。
