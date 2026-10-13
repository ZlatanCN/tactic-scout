# TactiScout 人工短名单评测：小样本、分歧与不完整判断复核

研究日期：2026-10-10。来源访问日期：2026-10-10。

## 结论

现有评测器的核心边界是诚实的：只对固定 query、冻结候选池和数据快照计算逐 query nDCG@5；池内每名候选都须有至少两份独立提交和一份数值裁决；`unknown`、未评和未裁决均不折算成 0；没有标签时返回 `not_evaluable`。仓库当前的人工评估模板仍为空，因此目前没有任何候选排序质量结果。

nDCG@5 能回答的窄问题是：“在这一个冻结候选池里，这个系统排在前五的候选，与本次人工裁决的 0–3 分级顺序有多一致？”它不能证明球员真实能力、职业球探共识、目标球队的实际适配、市场覆盖、未来表现，也不能用一个 query 推断其他招募需求。当前实现采用 `gain = 2^grade − 1`，这让 0、1、2、3 级分别获得 0、1、3、7 的增益；这是把评分等级转换成效用的选择，不是由评审量表自动证明的事实。

**建议：现在不改评测代码，不添加置信区间、p 值或 pooling 修正。** 先收集冻结且有代表性的真实多 query 双评数据，再逐 query 展示分数、可评估覆盖、原始分歧及两系统的配对差值。只有在目标 query 分布和可接受差异明确后，才规划功效/样本量或置信区间。当前实现已经把“不知道”保留下来；用统计包装一个空或极小标签集只会制造精确感。

## 检查的项目状态

本复核阅读了 [issue 119](../issues/119-human-labeled-shortlist-benchmark.md)、[issue 123](../issues/123-local-blinded-review-workbench.md)、[issue 124](../issues/124-close-the-human-shortlist-evaluation-loop.md)、[评测指南](../../../docs/evaluation.md)、[领域术语](../../../CONTEXT.md)、[ADR 0008](../../../docs/adr/0008-human-shortlist-judgments.md) 和[推荐评估协议](scouting-recommendation-evaluation-protocol-2026-10-06.md)，以及 `src/evals/shortlist-quality-evaluation.ts`、`src/evals/blinded-review-packet.ts`、`/review` 和 `/adjudicate` 工作台。

- 模板 `data/evaluations/human-shortlist-quality-v1.template.json` 的 `snapshots` 与 `queries` 均为空。评测指南也明确当前没有人工适配标签，故整体状态是 `not_evaluable`。
- 评测器按每个 query 独立算分，不合并成全局平均。IDCG 从完整候选池裁决分中排序取前五，DCG 从系统实际提交的排序取前五；缺双评、缺数值裁决、快照信息不全或全池裁决皆为 0 时不算 nDCG。
- 双人/多人一致度只报原始完全匹配比例，并额外报告数值分数完全一致比例及 `unknown/unknown`、`unknown/数值` 对数。它没有宣称这些是信度或可靠性。
- 项目推荐评估协议已经给出 0–3/`unknown` 的情境适配 rubric；`/review` 曾以硬编码折叠说明展示，`/adjudicate` 只显示简短标签，盲评包本身没有携带锚点。缺口是传播同一份约定，不是另创或校准一套量表。
- 工作台在匿名裁决时展示了独立评审的原始分数。因而裁决应理解为“参考两份评分后的裁决标签”，不能称为第三份独立判断。这个标签仍可用于项目定义的人工裁决基准，但报告时应保留这个流程定义。

## nDCG@5 能说明什么

Järvelin 与 Kekäläinen 的 DCG 系列指标为分级相关性和前排优先的排序任务提供了形式化方法；该论文用四级判断和 TREC 查询示范相对理想排序的折损累计增益。[原始论文，ACM DOI](https://doi.org/10.1145/582415.582418) 在本项目中，`@5` 明确把评测目标限定为前五名；分数是相对当前池内“理想前五”的结果，不是绝对质量刻度。

实现细节也影响解释：当前代码的增益是 `2^grade − 1`，位置折损为 `log2(rank + 1)`，再除以同一裁决等级构成的理想前五 DCG。由于 0–3 量表是有序等级，指数增益比线性增益更强调 3 级候选；具体 0–3 级是否代表这种递增效用，需由 rubric 设计者说明。指标论文建立了 graded gain 的排序评价方法，并没有替 TactiScout 量表验证效用曲线。[原始论文](https://doi.org/10.1145/582415.582418) **推论：**如果将来比较结果接近，至少应披露增益映射；如果排名结论对线性/指数增益敏感，应把它当作量表假设敏感，而非单一“准确率”。目前没有标签，暂时无须为此增加第二套指标实现。

nDCG 的归一化不会把不同 query 变成同一类需求，也不会消除标注分歧。它还不评价候选发现是否完整：如果真正合适的球员根本不在冻结池，池内 nDCG 看不到这个漏检。小 cut-off 符合“只关心前五”的产品目标，但已有 IR 研究指出，小截断值在大规模检索实验中可能降低区分能力；该结论来自不同的检索集合，不能据此断定本项目的前五评测无效，只提醒不要把单个小池分数当作强质量证明。[Sakai 与 Kando 对不完整评测及截断指标的实验](https://link.springer.com/article/10.1007/s10791-008-9059-7)

因此最适合简历展示的说法是“构建了一个冻结 query/候选池上的人工裁决排序评测器，并在真实标签收集后报告逐案例 nDCG@5”，而不是“系统推荐准确率为 X%”。在首批只有一条或少量 query 时，展示案例卡、数据来源/快照、评审覆盖和每个系统原始 nDCG，明确标为探索性案例结果。

## Query 数量、汇总与置信区间

对跨需求结论，独立分析单位应是 query（或预先定义的 query 场景），而不是球员卡或同一候选上的评审配对。不同 query 的任务难度和候选池不同，需逐 query 配对比较两个系统；若汇总，使用 query 等权的宏平均，并同时展示各 query 的分数和样本数。不要把所有候选、评审配对或运行内事件当成相互独立样本来放大 `n`。

IR 实验的统计功效取决于 query 间系统差值的变异和目标效应大小；Webber、Moffat 与 Zobel 专门讨论了“要多少 topic 才能检测某种系统优势”，并指出依据以往经验或试运行估计这种变异会有较大误差。[原始论文，作者公开版 / ACM DOI](https://doi.org/10.1145/1458082.1458158) 所以不存在脱离目标差异、query 分布与 query 间方差的通用“够用 query 数”。三条案例可做机制/回归演示；它们不足以支撑泛化声明、显著性结论或总体稳定性结论。

置信区间不是一概禁用：IR 研究确实使用 bootstrap 对 query 级效果差值做统计推断。[Sakai，IR 指标 bootstrap 检验](https://doi.org/10.2197/ipsjdc.3.625) 但它需要可解释的抽样单位与足够覆盖目标总体的 query 样本。对一个固定 query，单一 nDCG 是该案例的描述性结果，不能从它估计“其他需求上的 query 间变异”。把候选或评审配对重采样，不能替代 query 抽样；若 query 本身是人为挑选且非目标用户需求的概率样本，区间也不会修复代表性偏差。**项目推论：**当前 benchmark 空模板及单 packet adjudication 流程都不支持面向一般用户需求的 nDCG 置信区间；暂时不要显示区间或 p 值。若未来形成多场景集并比较两个排序器，先预注册 query 类别和最小实际差异，再以 query 为簇做配对 bootstrap，并如实显示 query 数和区间宽度。

## 多评审与分歧

现有处理方式值得保留：至少两位不同 `reviewerId` 对完整匿名池独立评分；不平均、不让系统身份/名次或报告理由进入盲评；之后单独记录裁决；`unknown` 作为明确判断类别而不是未填写或 0。原始一致率和裁决标签分开报告，可避免把裁决后的单一标签误说成评审共识。TREC 对 relevance 的官方说明同样强调相关判断是任务和 query 定义的一部分；其数据集文档要求 query、语料与判断集相匹配。[NIST TREC 判断说明](https://trec.nist.gov/data/reljudge_eng.html)

但“精确类别一致率”只回答分数是否完全相同，不说明分差是一档还是三档；也不扣除偶然一致，不能称为信度。当前 UI 报出分子、分母、数值一致率和 unknown 配对数，适合作为小样本描述。**推论：**在真实数据少时，最有用的补充往往是原始分数分布、逐候选分差、unknown 比例和 adjudication 规则；不要急着展示多一个系数。若未来明确要估计评审一致性且有足够候选项目与评审覆盖，应选择尊重 0–3 序数距离、评审人数和缺项结构的正式系数（例如 ordinal Krippendorff α），同时报告其适用样本与不确定性；Krippendorff 原文提醒，可靠性系数有前提且容易被误读。[Krippendorff 原始论文](https://doi.org/10.1111/j.1468-2958.2004.tb00738.x)

对目前工作台的具体措辞建议是：把数值解释成“数值等级完全相同的评分对占比”，不要称“评审者一致性高/可靠”。如果裁决者看过原始分数，称“匿名裁决”；不要把 adjudication 伪装成额外一位盲评评审。是否在未来追加“裁决前独立评分”是产品取舍，而不是当前指标必须满足的条件。

## 不完整判断、unknown 与 pooling

项目所说的“不完整”有两种不同情况：

1. **`unknown` 是显式回答**：评审者看了证据后认为资料不足。它不是负面标签，也不是空单元。当前将它保留为类别并阻止数值 nDCG，符合项目量表语义。
2. **未判候选是缺失数据**：评审尚未评分，或候选没进入证据包。它也不是 0；若候选仍在该 query 的冻结评价池中，当前评测器会报告覆盖不足并暂停 nDCG。

这种全池双评/数值裁决门槛比一些大规模 IR 测试集更保守，但它为普通 nDCG 的理想排序分母提供完整标签，且不假定未判候选不相关。NIST 描述的 TREC pooling 则把多个系统返回的 top 文档汇成评审池，将池外未判文档按非相关处理；NIST 同时明确说明这种做法依赖“池已发现大多数相关文档”的近似完整假设，池相对总体太浅时会引入偏差。[NIST TREC 2021 overview](https://trec.nist.gov/pubs/trec30/papers/Overview-2021.pdf) · [NIST pooling limits study](https://doi.org/10.1007/s10791-007-9032-x)

确有针对不完整 qrels 的 nDCG 变体。Sakai 与 Kando 在 TREC 2003/2004 和 NTCIR-6 集合上，通过从完整判断随机删减数据比较指标；其 nDCG′ 将未判结果从排序列表压缩移除，在那些实验条件下比把未判结果按 0 的原 nDCG 更稳健。其效果依赖具体集合、缩减方式与 pooling 条件，并非可以对任意小型私有球探池直接套用的“校正因子”。[实验原文](https://link.springer.com/article/10.1007/s10791-008-9059-7)

本项目现在不需要 pooling correction：候选池是有限、固定快照上的项目内评估池，且待解决的是双评和裁决标签尚未收集，不是成千上万候选的抽样判断偏差。若未来池大到无法完整双评，应先重新定义“评测对象”：例如在任何评分前固定各系统 top-k 并集、加入透明规则基线和预先抽取的池外样本，再研究适合此采样设计的估计器；结果必须叫“该评估池上的排序表现”，不能暗示全球球员市场质量。TREC 自己也把 query、语料、qrels 的匹配及近似完整覆盖当作测试集协议的一部分。[TREC qrels 说明](https://trec.nist.gov/data/reljudge_eng.html) **这属于未来设计；不建议现在把未评候选折叠后冒充现有 `human-shortlist-quality-v1` 的普通 nDCG。**

## 最小行动建议

**当前无需改评测器数学或生成标签。** 已有结构把空标签、覆盖、双评、未知、分歧与逐 query nDCG 分开，空数据状态不是产品缺陷，不应以模型标签、单人标签或 `unknown=0` 来“填满”。后续界面工作只应改善对既有 rubric 的一致呈现，不得声称量表已经校准。

下一步应投入在真实评审方案，而不是统计功能：

- 在收集前固定少量但不同类别的自然语言需求（有明确职责、缺关键职责应追问、候选证据不足/无匹配），避免全是同一模板；保留需求简述、候选池来源范围、快照/hash、模型/提示词版本。
- 每个案例用同一冻结候选池对所有系统评分；至少两位足球知识评审者逐卡独立提交；复用项目已有 rubric，锁定原始提交，并单独保存裁决过程。
- 先把每个 query 的 nDCG@5、候选池大小、双评覆盖、unknown 数、数值评分对分母和各候选评分差一起展示。若不同增益映射可能改变结论，明确该假设并做离线敏感性检查；不要生成跨所有需求的单个“准确率”。
- 将首批结果称为“探索性人工评估案例”或“评测流程演示”。当数据增长后，根据可接受的排序差异、query 类别覆盖和实际 query 间方差进行样本量/功效规划；没有 universal cutoff 可先验保证结论。

**面向作品集的一句话：**“评测 harness 已支持盲评、独立双评、匿名裁决和 query-scoped nDCG@5；当前没有真实标签，因此推荐质量仍不可评估。”这比在空基准上给出看似精确的分数更有说服力。

## 一手/权威来源

- Järvelin, K. & Kekäläinen, J. (2002), *Cumulated Gain-Based Evaluation of IR Techniques*, ACM TOIS. [DOI](https://doi.org/10.1145/582415.582418)；[作者论文全文镜像](https://faculty.cc.gatech.edu/~zha/CS8803WST/dcg.pdf)。
- Webber, W., Moffat, A. & Zobel, J. (2008), *Statistical Power in Retrieval Experimentation*, CIKM. [DOI](https://doi.org/10.1145/1458082.1458158)；[作者公开全文](https://people.eng.unimelb.edu.au/jzobel/fulltext/cikm08.pdf)。
- Sakai, T. (2007), *Evaluating Information Retrieval Metrics Based on Bootstrap Hypothesis Tests*, IPSJ Digital Courier. [DOI](https://doi.org/10.2197/ipsjdc.3.625)；[期刊摘要与正文页](https://www.jstage.jst.go.jp/article/ipsjdc/3/0/3_0_625/_article/-char/en)。
- Sakai, T. & Kando, N. (2008), *On Information Retrieval Metrics Designed for Evaluation with Incomplete Relevance Assessments*, Information Retrieval. [DOI](https://doi.org/10.1007/s10791-008-9059-7)。
- NIST, *TREC 2021 Overview*（relevance, pooling 与不完整判断的说明）。[PDF](https://trec.nist.gov/pubs/trec30/papers/Overview-2021.pdf)。
- Buckley, C. et al. (2007), *Bias and the Limits of Pooling for Large Collections*, Information Retrieval. [DOI](https://doi.org/10.1007/s10791-007-9032-x)；[NIST 摘要页](https://www.nist.gov/publications/bias-and-limits-pooling-large-collections)。
- NIST, *English Relevance Judgements*（query、collection、qrels 匹配与其“complete”工作定义）。[官方说明](https://trec.nist.gov/data/reljudge_eng.html)。
- Krippendorff, K. (2004), *Reliability in Content Analysis: Some Common Misconceptions and Recommendations*. [DOI](https://doi.org/10.1111/j.1468-2958.2004.tb00738.x)。

## 2026-10-10 工作区复核补充

进一步检查原始评估协议、ADR 0008 和三处评审入口后，修正“要先定义 rubric”的表述：量表早已在协议中定义，但没有作为共享内容贯穿评审流程。现在由 [issue 140](../issues/140-surface-shortlist-fit-rating-anchors.md) 将既有锚点集中并传入评审包、独立评分页与裁决页；对应领域术语和 ADR 也已补充“尚未校准、不得从单一统计值换算”的边界。

本次复核了原始 nDCG 论文、检索实验功效论文及 NIST/TREC 官方 pooling 资料，支持保留逐 query 解释、以 query/topic 为跨需求推断单位，并不把 TREC 大规模部分评审池的修正方法套到当前冻结小池。统计结论保持不变：没有真人标签，推荐质量仍为 `not_evaluable`；此补充没有生成分数或运行模型。
