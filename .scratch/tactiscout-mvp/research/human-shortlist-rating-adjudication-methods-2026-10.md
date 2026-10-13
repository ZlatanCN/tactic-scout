# 人工短名单评审：独立评分、unknown、裁决与指标

研究日期：2026-10-10  
范围：为固定引援需求和冻结候选池建立可复算的人类适配度判断。本文只给标注与分析方法，不提供任何球员标签。

## 结论

TactiScout 的 0–3 分应表示**候选人对某一条固定职责需求的适配证据强弱**，而不是球员的通用能力等级。相关性/适配度是针对具体需求作出的判断；TREC 的评测实践也将 topic、文档集合和判断集绑定，且承认评审具有主观性、不同评审者可能给出不同分数。[TREC relevance judgments](https://trec.nist.gov/data/reljudge_eng.html) · [TREC 2025 overview](https://trec.nist.gov/pubs/trec33/papers/overview_33.pdf)

当前项目选用**双人独立盲评 → 锁定原始评分 → 第三方裁决 → 完整候选池上逐 query 计算 nDCG@5**是合理起点。必须分别报告评分者之间的一致情况和排序指标；前者不是推荐准确率，后者也不能证明评分 rubric 是普遍球探真值。

## 建议协议

### 1. 固定评审问题和可见证据

- 评审单元是“一个冻结 query 下的一张匿名候选证据卡”，不是脱离需求的球员总体评价。冻结职责说明、数据快照/时间、候选池、展示字段和 0–3 分定义；所有待比较系统使用同一候选池。
- 评分者看不到球员/球队身份、系统名、系统排名或模型解释，只依据同一份来源证据卡独立评分。完整保存来源、缺失项和快照标识。TREC 使用 pooled candidates 来制作待评集合；但浅池会漏掉相关项并偏向容易被检出的内容，因此项目应明确指标只对冻结评审池成立，必要时增加池外抽样并报告覆盖率，不声称找到了市场全部好球员。[TREC pooling overview](https://trec.nist.gov/pubs/trec33/papers/overview_33.pdf) · [NIST: Bias and the Limits of Pooling](https://www.nist.gov/publications/bias-and-limits-pooling-large-collections)
- 在正式标注前做小批量 rubric 试评，记录歧义并修改锚点；随后冻结 rubric。评分锚点需要描述证据如何支持目标职责，避免把“统计高”自动等价为“战术适配高”。训练、统一说明与评分者独立工作，是估计可复现一致性的前提。[Hayes & Krippendorff 2007](https://www.asc.upenn.edu/sites/default/files/2021-03/Answering%20the%20Call%20for%20a%20Standard%20Reliability%20Measure%20for%20Coding%20Data.pdf)

### 2. 让 unknown 表示不可判断，而非低分

把 0–3 定义为有足够证据时的有序等级；unknown 表示当前材料不足以判断。建议再记录一个原因码，例如证据缺失、样本太少、来源冲突、职责无法由现有指标观察。unknown 不能映射为 0：TREC 的 qrels 把“评审无法确定”的 gray 项与相关/不相关等级分开编码，说明不可判定不等同于负面判断。[TREC Legal Track gray judgments](https://trec.nist.gov/data/legal/07/glossaryL07.html)

区分三种状态：未提交评分、明确提交 unknown、给出 0–3 分。对 unknown 不计算等级误差或 nDCG 增益；单独报告其数量、比例和原因。两个评审都选 unknown 可记作“弃评动作一致”，但不能当成两人对球员等级达成一致。若未知占比高，先补齐证据或将该 query 标为不可评，不能靠补零做出完整分数。

### 3. 保留原始独立判断，再做裁决

两位评审完成并提交前不得讨论，也不得查看答案键。保存双方原始评分、评审代号、时间和 rubric 版本；之后由具备足球知识的第三位裁决者复核不一致项及 unknown，给出单独的裁决等级和简短理由。裁决不得覆盖原始标签；证据不足或按 rubric 仍无法解决时保留 unknown / 不可评，不强制凑出标签。

不要默认对两人的分数取平均或多数票：主观任务中的分歧可能反映不同视角，研究显示先聚合标签会丢失部分差异信息。[Davani et al., TACL 2022](https://aclanthology.org/2022.tacl-1.6/) 本项目需要一个数值裁决来计算排序指标时，裁决是一个明确的专家决策层，不是“球员真实适配度”的证明。

### 4. 分开报告原始一致、量表一致性和排序表现

- **描述性原始一致**：公布分母和双方逐候选的完全同分数比例，并附 0–3 的混淆矩阵/相差 1 分比例。将“双方均 unknown”和“一方 unknown、一方有分数”另列，不把它们混入数值等级的一致率。百分比一致容易解释，但单独不能建立可靠性；Hayes 与 Krippendorff 指出简单 percent agreement 不利用有序尺度信息，也缺少适用于不同情形的可靠性解释。[Hayes & Krippendorff 2007](https://www.asc.upenn.edu/sites/default/files/2021-03/Answering%20the%20Call%20for%20a%20Standard%20Reliability%20Measure%20for%20Coding%20Data.pdf)
- **评分可复现性**：对 0–3 有序等级，可评估 ordinal Krippendorff’s α；它适用于有序数据、多名评审者和不完整评分。若严格只有两名评审，带权 Cohen’s κ 是另一种显式利用有序分歧距离的选择。报告所用距离/权重、样本量与区间；不要把极小样本的单个系数包装成稳健结论，也不要事后挑选“看起来最好”的统计量。[Hayes & Krippendorff 2007](https://www.asc.upenn.edu/sites/default/files/2021-03/Answering%20the%20Call%20for%20a%20Standard%20Reliability%20Measure%20for%20Coding%20Data.pdf) · [Cohen 1968 weighted κ](https://doi.org/10.1037/h0026256)
- **系统排序质量**：只有候选池完整评审、每位候选有两份独立判断并且有 0–3 数值裁决时，才计算该 query 的 nDCG@5。固定等级到 gain 的映射（仓库当前用 2^grade−1）和位置折损规则，对每个 query/system 单独计算； graded relevance 的累计增益与排名位置折损正是 nDCG 的用途。[Järvelin & Kekäläinen, ACM TOIS 2002](https://doi.org/10.1145/582415.582418) unknown、未评分候选不应当作 0 放进理想排序。覆盖不足时返回 not_evaluable，并说明缺失项，而不是给低分。分级 gain 映射和 cut-off 会影响排序结果，应在看系统成绩之前预先固定。[TREC 2025 overview](https://trec.nist.gov/pubs/trec33/papers/overview_33.pdf)

## 对当前 TactiScout 基准的落点

仓库 issue 119/120 的边界与上述方案一致：标签按 query 固定、unknown 不等于 0、双人原始评审与单独裁决分开、池不完整则不计算 nDCG。下一步不是再造标签，而是由人类评审者对真实冻结包独立打分；在实际评分、裁决和足够样本量出现前，结果应保持 not_evaluable。如果只有项目作者一人评审，最多称作作者试评，不称独立人工基准或可靠性验证。

本次方法证据不能证明 TactiScout 的候选排序有效，也不推断任何候选人的真实适配度。

## 一手来源

- TREC, [English relevance judgments](https://trec.nist.gov/data/reljudge_eng.html)；[TREC 2025 overview](https://trec.nist.gov/pubs/trec33/papers/overview_33.pdf)。
- NIST, Buckley et al., [Bias and the Limits of Pooling for Large Collections](https://www.nist.gov/publications/bias-and-limits-pooling-large-collections)。
- TREC, [Legal Track gray judgments](https://trec.nist.gov/data/legal/07/glossaryL07.html)。
- Hayes & Krippendorff, [Answering the Call for a Standard Reliability Measure for Coding Data](https://doi.org/10.1080/19312450709336664)；[作者机构存档 PDF](https://www.asc.upenn.edu/sites/default/files/2021-03/Answering%20the%20Call%20for%20a%20Standard%20Reliability%20Measure%20for%20Coding%20Data.pdf)。
- Cohen, [Weighted kappa](https://doi.org/10.1037/h0026256)。
- Davani et al., [Dealing with Disagreements: Looking Beyond the Majority Vote in Subjective Annotations](https://aclanthology.org/2022.tacl-1.6/)。
- Järvelin & Kekäläinen, [Cumulated gain-based evaluation of IR techniques](https://doi.org/10.1145/582415.582418)。

