# TactiScout 球员推荐质量评测：可验证什么，缺少什么

研究日期：2026-10-06。范围：自然语言引援需求的解析、追问、候选检索与筛选、排序、证据支持和 LangGraph 执行行为。按当前仓库方向，分别考虑 Wyscout 2017/18 派生快照与 FPL 2026/27 英超游戏目录；不将二者跨赛季、跨来源按姓名拼接。

## 结论

**公开比赛数据足以验证数据处理、硬约束筛选、可观察指标计算和报告是否忠于来源；不足以单独给“这个球员适不适合拜仁/巴萨”提供客观 ground truth。** 足球表现没有一个被广泛接受、覆盖所有能力面的单一尺度；PlayeRank 论文也明确指出这一点，并用专业球探评估来验证其算法，但公开论文没有一并发布那套专家评估表。[PlayeRank 论文](https://arxiv.org/abs/1802.04987)

能补上的最小方案是：用固定查询和数据快照建立分层评测集；程序化标签只回答可由源字段判定的问题；推荐适配度另由足球知识评审者按公开 rubric 盲评。把这些称为“带人工标注的内部基准”，不要称作职业球探标准答案。没有独立评审者时，只能称作者自评试验。

此外，公开 `PlayeRanks` 数据含 PlayeRank 自己算出的单场球员分数、角色簇、出场分钟与进球，且条目标注 CC BY 4.0；它很适合作为**历史算法比较基线**，但不是独立金标准，不能用“Agent 与另一个模型排名相同”证明推荐正确。[Figshare：PlayeRanks](https://figshare.com/articles/dataset/PlayeRanks/9361148) · [PlayeRank 方法论文](https://doi.org/10.1145/3343172)

## 现有数据能标什么

| 来源 | 可复现的标签 / 事实 | 不能据此标成的 ground truth |
|---|---|---|
| **Wyscout 2017/18** | 固定历史快照的球员、比赛、阵容与带球员 ID 的事件；事件有时间、位置、结果和类型。可独立重算某个事件计数、分钟口径、指定比赛/赛事/赛季、现有宽/细位置字段；适用于核对适配器、派生统计、筛选边界和证据引用。原始开放集是 2017/18 五大联赛，另含 2018 世界杯和 2016 欧洲杯，发布页称 CC BY 4.0，并要求引用来源。[数据论文](https://www.nature.com/articles/s41597-019-0247-7) · [Figshare 发布集](https://doi.org/10.6084/m9.figshare.c.4415000.v5) | 事件计数或历史出场位置不等于“高位压迫能力”“可替代凯恩”或球员未来表现；历史俱乐部不等于当前效力/可签约状态。事件数据能成为可观察表现证据，不能直接成为转会适配标签。 |
| **FPL 2026/27** | 该游戏目录里实际返回的球员、球队、年龄、GK/DEF/MID/FWD 游戏宽组、分钟及赛季总量；已有 adapter 只把实际出现的 xG/xA/xGI、tackles、recoveries、合并的 clearances/blocks/interceptions 作为有来源定义的表现线索。可测源映射、空值处理、单位、候选边界和报告是否保留限制。 | 它不是完整俱乐部注册名单，也不提供窄战术职责、市场身价、转会可用性、伤病/合同或通用球探评分。游戏总分/ICT/价格以及上述比赛统计都不是“能力真值”。更重要的是，当前 [FPL 2026/27 条款](https://fantasy.premierleague.com/help/terms)明文禁止用自动系统访问游戏并提取信息；公开可读不能替代许可，不能把它作为可持续自动评测数据源。 |
| **公开 PlayeRanks** | 记录包含该算法计算的 `playerankScore`（单场 0–1）、`roleCluster`、`minutesPlayed`、`goalScored` 等；可在能验证球员/赛事身份映射后，与自身候选排序做历史算法基线比较。[数据字段与许可](https://figshare.com/articles/dataset/PlayeRanks/9361148) | 它是 PlayeRank 的输出，和 TactiScout 的模型判断不是独立专家标签；不同评分目标、角色定义和数据域也会造成合理分歧。不得把它用作“适合某支球队”的真值。 |

StatsBomb Open Data 也可作为另一个有事件、阵容与赛事目录的**受限历史技术验证集**，数据发布方说明免费开放的比赛范围用于研究/足球分析，并要求发布分析时署名和使用标志；它同样不发布引援适配标签，也不是当前完整球员池。[Hudl/StatsBomb Open Data](https://github.com/hudl/open-data) · [数据使用协议](https://github.com/hudl/open-data/blob/master/LICENSE.pdf)

## 最小可执行评测协议

第一版目标是找出回归并比较明确基线，不宣称统计显著或专业决策有效。建议先建立 **24 个冻结场景**：12 个有足够数据可跑候选检索/比较，6 个应先追问，6 个应明确承认数据范围或证据不足。场景需分别写明来源、快照/赛季、as-of 时间、输入自然语言、明确约束、允许补问的缺项、禁止推断项和预期结束状态。Wyscout 历史案例与 FPL 当前案例分开统计，不能把来自不同年代和数据定义的分数混成总分。

每个案例至少保存：`caseId`、`snapshotId`、`asOf`、原始 query、人工确定的需求槽位、必需澄清槽位、满足显式硬约束的候选 ID 集合、每个能力要求对应的可用/缺失指标、报告 claim 到 source field / record ID 的映射、匿名化的评审标注。将候选池与运行配置（模型名/版本、提示词版本、工具预算、采样参数）一同固定。

| 评测层 | 金标准如何取得 | 主指标与错误记录 |
|---|---|---|
| **需求解析** | 对预写场景手工标注原文中明确提出的球队、替代对象、年龄、宽位置、能力和偏好；隐含/未说内容标为缺失，而非让模型猜。 | 显式槽位 exact match / micro-F1；遗漏和臆造分开计。 |
| **追问与同案续跑** | 每个缺失信息场景预先声明：缺项是否会实质改变检索/排序、预期问句主题、用户答复和继续/终止路径。不是每项偏好都必须追问。 | 必需追问召回、无必要追问率、静默假设率；回答后是否在同一案沿用已确认条件；无匹配时是否征得同意再放宽。 |
| **候选检索/硬筛选** | 对固定快照，把明确且源中存在的约束（赛季、source team、出生日期年龄、数据所支持的位置粒度）通过确定性程序得到 eligible 集合。不可观测条件不生成标签。 | `eligible Recall@20`、`Precision@20`、硬约束违规候选率、候选池覆盖率。筛选准确不等于球探适配准确。 |
| **排序/适配度** | 至少两名评审者独立、盲于系统名和排序，对每条 query 的候选池（各系统结果并集加抽样候选）按 0–3 评：0=明确不符/违反硬条件，1=弱或只部分吻合，2=有合理证据支持的候选，3=对点名能力/职责高度吻合；另设 `unknown`，数据缺失不当作 0。先校准 rubric，报告一致度与分歧并由第三方或共识裁决。 | 有足够双评标签的查询报告 `nDCG@5`；另报 pairwise agreement。NDCG适用于分级相关度并同时考虑相关度和名次。[Järvelin & Kekäläinen, 2002](https://doi.org/10.1145/582415.582418) 小样本逐 query 展示结果，不只报平均数。 |
| **证据与报告** | 将每个可核对的事实 claim 拆成 claim→指标/原始 source field→球员/赛季/样本上下文；可机械核对 ID、值、单位、赛季与出处，再由盲评确认自然语言解释是否超出字段含义。 | 事实 claim 支持率、引用/来源/赛季/样本完整率、所要求能力的 evidence coverage、数据缺口披露率；单列错误类：字段定义偷换、跨来源身份错连、以缺值冒充零、历史数据当现役。RAG研究同样把 context relevance、faithfulness、answer relevance 分开评估，且用少量人工标注校验自动评分。[ARES, NAACL 2024](https://aclanthology.org/2024.naacl-long.20/) |
| **Harness 行为** | 以可复现的 query+快照运行，检查工具轨迹和 LangGraph 状态转移；给每场景写独立行为断言。Agent benchmark 的核心也是在环境里完成多步任务，而非只比较最后文本。[AgentBench](https://arxiv.org/abs/2308.03688) | 工具选择/参数、分页游标、重复调用、超预算、错误停止、追问→答复→同案续跑、终态报告、取消释放队列、运行时长分别记分。此表只证明流程行为，不代替上述候选和证据质量指标。 |

最少比较三个运行：**透明规则基线**（确定性筛选 + 固定权重的来源指标排序）、**不含 Planner/追问的单轮基线**、**完整 LangGraph harness**。它们使用相同数据快照、候选池约束、证据与调用预算；报告每层指标和差值，不把不同性质的指标加权成一个“准确率”。固定模型/提示词后至少重复 3 次，报告运行间候选和次序变动；3 次只是抖动检查，不是稳定性证明。LLM-as-judge 可先用于标出人工复核样本，不能独自生成 gold label。

## 公开数据够不够：明确判断

- **够：**验证解析字段、是否在该数据集中找到具备显式条件的候选、统计计算、分页/来源工具行为、已返回证据的可追溯性和报告是否忠于数据。Wyscout 公开论文说明逐场事件有球员/时间/位置/结果，采集包含多名标注员与质量控制；它因此适合重算事实与历史表现证据，但不是当前转会可用市场。[Wyscout data paper](https://www.nature.com/articles/s41597-019-0247-7)
- **有限够：**PlayeRanks可成为比较另一个开源性能模型的历史参照；FPL字段只可做目录/字段边界及其实际返回统计的流程验证。前者非独立 ground truth，后者还存在自动提取条款问题。没有许可的 FPL 快照不应被承诺为公开自动评测集。
- **不够：**“更适合球队战术”“凯恩的真正替代者”“未来在该队成功”“最佳引援”没有可从这两套结构化数据直接导出的标签。实际转会与后续出场/表现也只能是弱结果代理：能否上场受转会机会、俱乐部选择、教练、伤病、队友与战术改变影响；没有观察到“签了另一名候选人”的反事实。市场身价或媒体评价也不是纯能力标签。
- **没有可用公开专家金标准的证据：**PlayeRank研究表明用专家球探评价验证算法是可行的，但本文查到的公开数据发布的是算法产出的 `playerankScore`，不是该论文所用专家评价集。若想把项目提升到“推荐质量经验证”，应自己组织盲评，并清楚披露评审人数、足球经验、rubric、一致率和有限适用范围；能取得独立球探评审是下一档，不是可由再抓几个统计 API 替代的。

## 时间/样本泄漏与结果解释

1. **冻结 point-in-time。**记录原始文件/API 快照的 hash、抓取时间、赛季、source id namespace 和派生代码版本。某个 `asOf` 任务只允许读取当时可用的数据。未来表现不能回填成当时的推荐理由。
2. **按时间切，不随机混球员行。**如果以后扩展到多赛季训练或权重调参，按整季/时间边界训练、调参与测试；不要让同一球员同赛季的记录跨集合，也不要在训练统计中看见测试截止日之后的比赛。推荐系统研究已展示忽略全局时间线会泄露未来信息并改变算法相对排名。[Ji et al., 2021](https://arxiv.org/abs/2010.11060)
3. **按 query 留出。**开发中看过的自然语言模板、用户答复和实体组合不是盲测。留出未参与提示词调试的 query，且至少涵盖不同俱乐部、宽位置、能力组合、空结果和澄清路径。
4. **消除评审泄漏。**评审者不得看到系统名称、模型排名或模型解释后再打分；先独立判断结构化证据，再审 claim 支持。评审结果不能同时参与权重调优并作为同版本最终测试标签。
5. **把小样本说清楚。**24个对话场景适合作第一版回归集，不足以支持“推荐更准”的强统计结论。若要发表版本间比较，逐 query 配对展示、报告标签一致性和不确定性；持续扩充不同请求类别的双评样本。TREC 的评测实践也强调 query 与被评文档集和判断集必须匹配，且相关性判断通常先汇集系统候选再标注；TactiScout 可借用这个 pooling 思路，不把未判候选当作负例。[NIST TREC relevance judgments](https://trec.nist.gov/data/reljudge_eng.html)

## 推荐的数据集版本

建立互不混淆的两个分区，而不是一个“所有球员 gold list”：

- `historical-wyscout-2017-18`: 历史比赛证据与历史需求案例；用于统计/角色证据复算和方法基线。报告标题和 query 明示历史日期。
- `current-fpl-2026-27`: 若数据使用许可得到解决，限定为英超游戏目录字段级 smoke/追问边界；不用于窄位置战术拟合或通用球探排序。FPL 条款现有限制意味着应在公开或持续自动评测前取得书面许可或换为允许自动处理的当前数据来源。
- `human-fit-judgments-v1`: 单独版本化人工 rubric 标签，附评审者角色、盲评方式、标注时间和一致性；未知值独立编码，原始来源数据许可不自动涵盖这些新标注的发布权。

该方案可以先形成可信的**小型可复现评测**，并逐步积累质量标签；它不能用公开统计数据制造出本来不存在的专业转会 ground truth。

## 一手来源

- 足球性能评价论文：[PlayeRank, arXiv / ACM DOI](https://arxiv.org/abs/1802.04987)；[公开 PlayeRanks 数据及 CC BY 4.0](https://figshare.com/articles/dataset/PlayeRanks/9361148)。
- Wyscout 数据：[Scientific Data 发布论文](https://www.nature.com/articles/s41597-019-0247-7)；[Figshare 版本化数据集](https://doi.org/10.6084/m9.figshare.c.4415000.v5)。
- FPL：[2026/27 官方使用条款](https://fantasy.premierleague.com/help/terms)。
- StatsBomb：[官方 Open Data 文档/仓库](https://github.com/hudl/open-data)；[仓库使用协议 PDF](https://github.com/hudl/open-data/blob/master/LICENSE.pdf)。
- 排名评测：[Järvelin & Kekäläinen, ACM TOIS 2002](https://doi.org/10.1145/582415.582418)。
- RAG/Agent 评测：[ARES, NAACL 2024](https://aclanthology.org/2024.naacl-long.20/)；[AgentBench, ICLR 2024](https://arxiv.org/abs/2308.03688)。
- 时间泄漏与检索判断：[Ji et al., offline recommender leakage study](https://arxiv.org/abs/2010.11060)；[NIST TREC relevance judgments](https://trec.nist.gov/data/reljudge_eng.html)。

## 2026-10-09 一手来源复核补充

将**方法 RAG 检索**和**候选短名单排序**做成两份质量结果，并与 Harness 行为检查分开。RAG 的首要标签应是 query–passage 相关性：为冻结的信息需求，在已获准语料中给片段做 0–3 分级 qrels（不相关、边缘相关、有用、直接支撑），让至少两名标注者盲于检索器独立判断并保留分歧。把 BM25/关键词、向量和当前混合检索各自的 top-k 结果合并成待标注池，另抽少量池外片段；未判片段记作未判，不当作负例。用 **nDCG@5** 看分级相关片段是否排前；仅在相关集合足够完整时解释 `Recall@k`，另报命中来源数及重复片段数。NIST 的 test-collection 定义要求 query、语料和 qrels 对应；pooling 只是近似覆盖，并不证明未入池结果都不相关。[NIST TREC relevance judgments](https://trec.nist.gov/data/reljudge_eng.html) · [Järvelin & Kekäläinen, 2002](https://doi.org/10.1145/582415.582418)

把检索与生成拆开记分：检索上下文是否相关、答案主张是否受已检索片段支持、答案是否回应问题是三个不同问题；方法片段被检索到也不能当作球员能力证据。[ARES, NAACL 2024](https://aclanthology.org/2024.naacl-long.20/) 可用 LLM judge 先分流待复核样例，但不能直接充当金标准：ARES 用人工验证样本校准自动判断，NIST 的 2025 RAG Track 报告中，最佳自动 relevance-judgment runs 与人工判断的一致比例仍约为 0.30–0.34。[ARES](https://aclanthology.org/2024.naacl-long.20/) · [TREC 2025 RAG Track overview](https://trec.nist.gov/pubs/trec34/papers/Overview_rag.pdf) 若另行使用 RAGAS 指标，应标明其当前 `Context Recall` 是“参考答案主张中有多少受检索上下文支持”，并非按相关片段全集计算的传统 `Recall@k`。[RAGAS Context Recall documentation](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/context_recall/)

短名单评测继续区分两种标签：显式且来源可观测的年龄/位置/赛事等硬条件由程序生成 eligible 集合；“有证据支持的角色适配”由两名以上具备足球知识的评审者对同一份去系统名、去排序、去模型解释的来源证据卡独立分级，缺字段标 `unknown`，不算 0 分。评审完成并锁定标签后，用逐 query `nDCG@5` 衡量候选顺序；另报 eligible Recall@20、硬条件违规率、用户所需能力的证据覆盖率和 unknown 比例。评分者一致性和分歧与模型分数同列，不把一次裁决称作客观金标准。足球表现没有广泛认可的单一量尺；一项 2026 年 U13 现场研究的 16 名球探整体当前表现一致性为 ICC .61，潜力判断为 .37–.42，说明标签自身也有误差，且研究范围不能直接外推至成年职业转会。[PlayeRank](https://doi.org/10.1145/3343172) · [Peringa et al., 2026](https://doi.org/10.1177/17479541261428967)

泄漏控制补充为：按 query 家族留出从未用于提示词、排序权重或 rubric 调整的测试集；记录每个案例的 `asOf`、原始快照 ID/hash 与模型/提示词版本；所有候选特征只能来自该截止点已可得数据。人工评审者只看固定来源证据卡，不看系统名称、名次和系统生成的适配理由。当前 Harness 继续只回答工具选择/参数、分页、追问恢复、状态和报告契约是否成立；这些通过结果不能替代上述 qrels 或盲评。方法 RAG 的现有命中仍需按本协议建标；球员报告语料没有命中/标签时，报告“不可评”，不要把空索引计为低质量。

### 本次新增的一手来源

- RAG 组件分项及人工验证集：[ARES, NAACL 2024](https://aclanthology.org/2024.naacl-long.20/)。
- qrels、pooling 与 collection 对应要求：[NIST TREC English relevance judgments](https://trec.nist.gov/data/reljudge_eng.html)；[TREC 2025 RAG Track overview](https://trec.nist.gov/pubs/trec34/papers/Overview_rag.pdf)。
- 分级相关度和排名折损：[Järvelin & Kekäläinen, ACM TOIS 2002](https://doi.org/10.1145/582415.582418)。
- 足球适配评价的量尺局限：[PlayeRank, ACM TIST 2019](https://doi.org/10.1145/3343172)；[Peringa et al., 2026](https://doi.org/10.1177/17479541261428967)。

### 对 issue 105 指标选择的支持

[issue 105](../issues/105-methodology-rag-retrieval-benchmark.md) 当前只测两个获准方法来源，因此按 canonical source 去重后计算 source-level **MRR、Recall@3、Precision@3**，比把同一文章的多个相似片段重复计成多个命中更贴近“找到对的来源”这一任务。对语料无法回答的问题单独报告 top-1 false-positive rate，不能并入可回答 query 的相关性均值。由于只有两个来源且首批 qrels 是作者标注，这些数值是固定语料/嵌入版本下的回归 smoke test；其低分辨率不足以外推为通用 RAG 质量。若来源数和人工评审增长，再扩到多来源盲标及分级 `nDCG@k`。此 ticket 因而实现了上文的分层评测与 Harness 隔离，但限定为小样本作者标注基准。
