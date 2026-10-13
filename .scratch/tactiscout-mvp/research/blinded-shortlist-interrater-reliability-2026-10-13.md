# 盲评短名单的双人评分一致性与可靠性

研究日期：2026-10-13  
范围：两位评审者对同一冻结候选池中的匿名球员卡独立给出 0–3 有序适配等级或 `unknown`；裁决者之后单独裁决，再按裁决等级计算 query 级 nDCG@5。本文不读取或计算任何实际评分结果。

## 结论

原始完全一致率有用，但只能作为**本批评分的描述**，不足以单独声称量表或评审具有可靠性。它不校正偶然一致，也不反映 0–3 有序等级中相差 1 档和相差 3 档的区别。等级可靠性统计应保留 0–3 的顺序；`unknown` 是弃评/缺失，不是第五个等级，不能编码成 0 或参与数值等级距离计算。

对 TactiScout 当前流程的建议：

1. 每个冻结 query/候选池报告候选卡总数、每位评审的 0–3 与 `unknown` 计数、两人均为数值等级的卡数、数值同分数、相差 1 档/至少 2 档的数量，以及 0–3 的 4×4 交叉表和边际分布。另列双方均 `unknown` 与一方 `unknown`/另一方有数值的卡数。这样读者可以看到分母、类别稀疏和分歧发生在哪里。
2. 当前一包 20 张卡的历史评审包应先报告这些描述统计；不要把一个小型、单 query 的系数包装成已验证的通用“球探量表可靠性”。更广泛地声称可复现性，需跨多个独立 query/候选池收集数据，并说明估计目标和样本范围。可靠性方法要求独立评审；对目标总体的推断还依赖评审单位是否代表该总体。[Hayes 与 Krippendorff](https://doi.org/10.1080/19312450709336664)明确提出独立评审与合适单位样本的条件。
3. 当有足够且类别有变化的双人评分后，可将**有序 Krippendorff α**作为一个预先指定的补充可靠性系数：把 `unknown` 编码为缺失，仅让双方都有数值评分的候选对数值等级一致性提供信息，并同时报告有效候选数。α 支持有序尺度和缺失评分；若改用加权 Cohen κ，也适用于两名评审者，但必须事前固定权重并报告权重定义。[Hayes 与 Krippendorff](https://doi.org/10.1080/19312450709336664)；[Cohen 的加权 κ 原文](https://doi.org/10.1037/h0026256)。目前没有真实双人评分，因此这里没有可计算或应报告的可靠性系数。[项目评估说明](../../../docs/evaluation.md#盲态裁决与质量评测)

## 方法证据

### 原始完全一致率：必要的描述，不是充分的可靠性分析

完全一致率直接回答“这批卡中两人给出完全相同数值等级的比例”，适合透明呈现原始判断。它本身没有机会校正：相同标签在边际分布下本来就容易出现多少次；也没有利用等级顺序的信息。Hayes 与 Krippendorff 将 percent agreement 评价为简单易算，但认为它不适合作为单独可靠性尺度；他们建议根据数据的测量层级采用相应分歧函数。[原文第 2–4 页](https://www.asc.upenn.edu/sites/default/files/2021-03/Answering%20the%20Call%20for%20a%20Standard%20Reliability%20Measure%20for%20Coding%20Data.pdf)

所以应保留**完全一致率**，并补充相差 1 档、相差至少 2 档及混淆表。相差等级分布表达实际误差方向与大小，不能被一个系数取代。

### 可用的有序一致性系数

| 方法 | 适合之处 | 主要解释边界 |
|---|---|---|
| 加权 Cohen κ | 直接针对两位评审者；按有序类别间距离对分歧赋不同权重。[Cohen 1968](https://doi.org/10.1037/h0026256) | 线性、二次等权重方案会改变系数；需在看结果前选定并披露，不能挑高的那个。[Graham 与 Jackson 1993](https://doi.org/10.1016/0895-4356(93)90173-X) |
| 有序 Krippendorff α | 适用于不同测量层级和缺失评分；也可扩展到不同评审人数。ordinal α 使用适配有序等级的分歧度量。[Hayes 与 Krippendorff 2007](https://doi.org/10.1080/19312450709336664)；[Hughes 2021 的方法与软件论文](https://doi.org/10.32614/RJ-2021-046) | 它仍是依赖分歧函数与数据分布的系数，不会让缺失机制消失，也不保证小样本估计稳定。 |

加权 κ 的距离权重不是无关紧要的实现细节。Graham 与 Jackson 的实证分析指出，weighted κ 会对权重选择敏感，且一个汇总系数可能掩盖实际同分比例。[原文](https://doi.org/10.1016/0895-4356(93)90173-X) 如果 TactiScout 选 κ，应把预先指定的权重矩阵与 4×4 交叉表一起报告；不能只写“weighted κ”。0–3 的项目锚点是定性有序描述，尚未校准为等距量表，因此二次权重所体现的距离假设尤其不应被默认为事实。选择何种距离是项目方法决策，不是球探数据已经验证的属性。

加权 Cohen κ 的 chance-correction 还受评审者边际使用类别的影响。不同类别流行率和评审者边际差异会改变 κ；仅报告一个 κ 值会丢失解释它所需的信息。[Byrt、Bishop 与 Carlin 1993](https://doi.org/10.1016/0895-4356(93)90018-V)；[Sim 与 Wright 2005](https://pubmed.ncbi.nlm.nih.gov/15733050/) 因此必须同时报告各等级频数和交叉表，不套用脱离本任务的通用“差/中/高”阈值。

### `unknown` 的处理

项目量表将 `unknown` 定义为证据不足、样本不足或指标不对应时无法判断，而不是低适配度。[量表锚点与项目约定](../../../docs/evaluation.md#匿名候选证据卡) 统计分析中应把它作为缺失/弃评状态处理：

- `unknown` 不等于 0，也不构成第五个有序等级；把它塞进等级距离或 nDCG gain 会改变统计问题，并把缺证据伪造成负面判断。
- 双方数值评分才进入 0–3 的数值一致率及 ordinal α / 加权 κ；一方 unknown 的卡没有数值等级配对信息，须报告为混合弃评，不能算数值同分或相差等级。
- 双方均 unknown 可单列为“共同弃评”；这说明弃评动作相同，不表示双方对球员等级一致。可以额外报告含五种响应状态的描述性 response agreement，但不得把它叫作 0–3 等级可靠性。
- α 的缺失处理只解决计算中有缺格的形式问题。若评审者更倾向于在困难或证据冲突的卡上弃评，数值系数描述的只是可由两人评分的部分；unknown 的比例及原因必须一起报告。该点是基于项目弃评语义与缺失评分统计量的边界所作的方法建议。

Hughes 的 α 实作论文明确规定：一个评审单位至少有两份有效评分才进入 α 计算，否则该单位行会被忽略；行内缺失评分则略过。[Hughes 2021，第 5 节](https://journal.r-project.org/articles/RJ-2021-046/index.html) 在本项目的双人设计里，这意味着混合 `unknown`/数值的卡不会贡献一对数值判断；双方均 `unknown` 也没有数值等级可比较。

### 小样本和稀疏类别

评审包即使收齐双人判断，真正进入数值系数的分母也可能因 `unknown` 而显著变小。样本小、某些等级没人使用、或评审者几乎都给同一个等级时：

- κ 的结果受边际分布和类别稀疏影响；若机会一致项使公式分母为零，系数可能无法估计。这种情形应报告为“不可估计/退化边际”，保留原始表格，不改写成 0 或 1。κ 对 prevalence、bias、样本量和区间的依赖见 [Sim 与 Wright 2005](https://pubmed.ncbi.nlm.nih.gov/15733050/) 与 [Byrt 等 1993](https://doi.org/10.1016/0895-4356(93)90018-V)。
- 不应从单个点估计使用固定阈值宣称“可接受可靠”。应公布有效 `n`、类别边际和不确定性；而小样本区间可能很宽。Hughes 的 12 个单位示例中，α 的 bootstrap 95% 区间为 0.46–1.00，删除一个有影响的单位后，点估计从约 0.74 变为约 0.86。[Hughes 2021，第 5 节](https://journal.r-project.org/articles/RJ-2021-046/index.html)
- 更新的方法研究进一步指出，Krippendorff α 的惯用点估计和常见区间估计在“小但现实”的样本下有明显缺陷；不能因为方法支持 bootstrap 就认为小样本区间自动可信。[Hughes 2024](https://doi.org/10.1016/j.jspi.2024.106170)
- 不存在一个脱离目标精度、边际类别概率和权重方案的通用最小候选数。κ 的样本需求随这些假设改变；应把当前数据称为单包探索性描述，直到有设计依据支持更广泛的推断。[Sim 与 Wright 2005](https://pubmed.ncbi.nlm.nih.gov/15733050/)

同一个 query 内的候选卡共享职责、候选池和数据快照。因此，即使后续计算系数或置信区间，单包结果也只支持这个冻结 query/证据范围内的判断；它不会证明评审者在其他球队、位置或数据来源上同样可复现。这是项目抽样设计的推论，不是本次已有数据的实测结论。

## 对 TactiScout 报告的建议

- **现在：**继续报告本批原始数值完全一致率、共同/混合弃评、数值等级差距和完整 4×4 交叉表；显示各计数分母。页面的“类别一致”若包括 `unknown`，应称作响应状态一致，并与数值等级一致分开。
- **系数：**目前暂不新增“可靠性已达标”结论或等级解释。等实际双评数据积累后，可预注册有序 α 为主系数，外加线性加权 κ 的敏感性检查；或只选其一并明确目标。不要同时试多个指标/权重后挑最好看的结果。
- **解释：**评级一致性、裁决标签和 nDCG@5 是三件事。裁决产生排序评测所需的 qrels；它不会反向提高评审者的一致性系数，也不能证明评分锚点等于球员真实能力。nDCG 仍须披露既定 `2^grade−1` gain 假设并限于完整冻结候选池。[项目 ADR 0008](../../../docs/adr/0008-human-shortlist-judgments.md)
- **不伪造结果：**项目文档当前记载没有真实人工标签，nDCG 和推荐质量仍为 `not_evaluable`。[项目评估说明](../../../docs/evaluation.md#评估边界) 因此本研究只给统计方案，没有计算系数、置信区间、nDCG 或实验结果。

## 一手/权威来源

- Hayes, A. F., & Krippendorff, K. (2007). [Answering the Call for a Standard Reliability Measure for Coding Data](https://doi.org/10.1080/19312450709336664). *Communication Methods and Measures*, 1(1), 77–89. [机构存档全文](https://www.asc.upenn.edu/sites/default/files/2021-03/Answering%20the%20Call%20for%20a%20Standard%20Reliability%20Measure%20for%20Coding%20Data.pdf)
- Cohen, J. (1968). [Weighted kappa: Nominal scale agreement with provision for scaled disagreement or partial credit](https://doi.org/10.1037/h0026256). *Psychological Bulletin*, 70(4), 213–220.
- Graham, P., & Jackson, R. (1993). [The analysis of ordinal agreement data: Beyond weighted kappa](https://doi.org/10.1016/0895-4356(93)90173-X). *Journal of Clinical Epidemiology*, 46(9), 1055–1062.
- Byrt, T., Bishop, J., & Carlin, J. B. (1993). [Bias, prevalence and kappa](https://doi.org/10.1016/0895-4356(93)90018-V). *Journal of Clinical Epidemiology*, 46(5), 423–429.
- Sim, J., & Wright, C. C. (2005). [The kappa statistic in reliability studies: Use, interpretation, and sample size requirements](https://pubmed.ncbi.nlm.nih.gov/15733050/). *Physical Therapy*, 85(3), 257–268.
- Hughes, J. (2021). [krippendorffsalpha: An R Package for Measuring Agreement Using Krippendorff’s Alpha Coefficient](https://doi.org/10.32614/RJ-2021-046). *The R Journal*, 13(1), 413–425.
- Hughes, J. (2024). [Toward improved inference for Krippendorff’s Alpha agreement coefficient](https://doi.org/10.1016/j.jspi.2024.106170). *Journal of Statistical Planning and Inference*, 233, 106170.
