# 新增球员表现数据源准入复核

核查日期：2026-10-08。先对照本目录截至 2026-10-08 的来源 sweep、准入矩阵、近期开放数据、自建数据可行性和 API-Football 复核，再检查新增候选的发布页、数据卡及官方厂商资料。未注册或提交联系信息，未调用 API、下载/爬取球员记录或使用凭据。本记录用于工程选型，不构成法律意见。

## 决策

本轮只发现一个值得继续看、且过去笔记未覆盖的球员级战术表现数据候选：**SkillCorner 2025/26 英超课程数据包**。它有很高的战术证据潜力，但数据由课程参与者托管在 Hugging Face，访问前须同意披露联系信息；数据卡标示 CC BY-NC 4.0，同时说明原始数据版权归 SkillCorner。实际球员身份表、比赛覆盖和个人赛季汇总范围未能从公开卡片确认。**它不是当前 2026/27 候选池，也未达到 TactiScout 持久化、模型处理和公开演示的准入条件。**

本轮没有找到可直接接入的全新、免费、广覆盖且处理边界清楚的当前球员主库。此前已调查的 GOAL API、Afriskaut Dynasty Scouting League、SoccerTrack v2、Reep、ASA、StatsBomb、FPL 等不重复列为“新发现”；分别参见[既有当前来源 sweep](current-player-source-sweep-2026-10-08.md)、[开放样本可行性](self-built-scouting-dataset-feasibility-2026-10.md)及[球员数据源选项](additional-player-data-options-2026-10.md)。

本轮还核对了 **FPDS**：它是处于 draft v0.1 的开放球员档案格式，可借鉴“每条事实带来源和上下文”的 provenance 设计；其官网明确说明它不是 registry，也不判断事实真伪，所以不能提供球员或表现数据。[FPDS 官网](https://fpds.football/)

## 新候选：SkillCorner EPL 2025/26

| 评估项 | 一手来源显示 / 未证实项 |
|---|---|
| 数据形状 | Hugging Face 数据卡称其为 SkillCorner 产出的英超 2025/26 广播追踪和事件数据，列出逐场摘要、dynamic events、10Hz tracking 与 physical KPI。官方 SkillCorner 产品说明确认 tracking 与事件可结合，用于球员跑动和位置分析；这说明方法价值，不构成该课程副本的再利用授权。[数据卡](https://huggingface.co/datasets/peggy44/PremierLeague25-26) · [官方 XY tracking 说明](https://www.skillcorner.com/products/football/xy-tracking-data) · [官方 Game Intelligence 说明](https://www.skillcorner.com/products/football/game-intelligence) |
| 球员字段与覆盖 | README 的目录表含 `physical/physical.json`，并称 `metadata/matches.json` 列全赛程、`available_dynamic_event_match_ids.csv` 列有动态事件可用比赛。另一张“数据类型”表提及 `players.parquet`，但仓库目录清单没有列出该文件，且 README 说明只随包发布目录清单中的内容。因此无法从无需访问受限文件的文档确认实名球员主表、可用比赛数、每项 KPI 定义/缺失率或球员赛季汇总覆盖。不得把“英超赛季数据包”写成完整球员库。|
| 时效与自动访问 | 固定 2025/26 赛季包，没有滚动更新承诺；不是 2026/27 实时名单。公开卡片显示文件需登录并同意分享联系信息；不是匿名公开 API。页面标示总量约 38.4 GB，过大，不宜整包装入 Agent 上下文。[数据卡与访问门槛](https://huggingface.co/datasets/peggy44/PremierLeague25-26) |
| 本地保存 | 页面允许访问后按目录取数，但并未单独写出本项目所需的缓存期限、删除规则或持久本地数据库条款。数据卡将其标为 CC BY-NC 4.0，并称研究/教育用途、原始数据 © SkillCorner、商业用途须另获 SkillCorner 许可；课程整理者能授予的范围与 SkillCorner 上游权利需要厘清。暂不复制到本地仓库、用户计划或长期数据库。|
| 本地 LLM / RAG | 卡片未说明将 tracking、事件、球员标识或派生指标交给 Ollama、构建 embedding/向量索引的具体边界。即使后续许可允许本地分析，也不应把 10Hz 原始帧向量化；更合理的路径是代码确定性计算可解释的 per-90 / physical / off-ball 摘要，再将小型结构化事实交给模型解释。RAG 保持用于方法文档或球探报告，不能替代结构化指标计算。 |
| 作品集展示 | 卡片许可为 CC BY-NC 4.0，并要求按该许可范围处理；它没有在该副本页面明确回答公开网页逐球员展示、公开截图或再发布派生球员表是否获 SkillCorner 上游允许。先取得对方针对“非商业个人作品集、具名球员派生统计、本地模型输入、缓存和署名方式”的书面许可，再展示真实球员结果。 |

## 排序与落地建议

1. **条件候选：SkillCorner EPL 2025/26。** 当前最有希望补强战术证据的新增来源；只适合作为隔离的上一赛季评估基准，不进入当季候选发现和排序。必须先解开访问门槛及上游授权，再核实发布包里球员身份映射与比赛/指标覆盖。
2. **当前候选池：本轮没有新增替代品。** 继续依赖项目已有来源分层，不把有限赛事样本拼成“全球全量”。新数据源的实际适用范围仍以 [准入矩阵](player-evidence-source-admission-matrix-2026-10-08.md) 为准。
3. **已知历史样本不因本轮变更。** Wyscout、IDSSE、SkillCorner 2024/25 A-League 等继续承担各自有边界的历史方法验证；不得用它们证明现役俱乐部归属或转会候选完整度。

建议在 issue 39 下新增一个“SkillCorner 2025/26 EPL 数据访问与许可门控评估”子任务，状态设为需要人工输入。通过条件为：获得数据卡/上游数据方对非商业作品集、具名派生统计、本地持久保存、本地 LLM/RAG/embedding 的书面范围；随后才用受控小样本核验 players 文件是否实际提供、比赛及 KPI 覆盖、分钟分母、成人筛选与来源追溯。未通过时不开发 provider adapter；继续推进其他不依赖该数据集的产品工作。

## 主要一手来源

- [SkillCorner EPL 2025/26 Hugging Face 数据卡、文件布局、许可与访问门槛](https://huggingface.co/datasets/peggy44/PremierLeague25-26)
- [SkillCorner 官方 XY tracking 产品说明](https://www.skillcorner.com/products/football/xy-tracking-data)
- [SkillCorner 官方 Game Intelligence 产品说明](https://www.skillcorner.com/products/football/game-intelligence)
- [SkillCorner 官方公开数据系列说明：2024/25 A-League 样本](https://landing.skillcorner.com/us/articles/skillcorner-open-data-5-visualising-football-tracking-data)
