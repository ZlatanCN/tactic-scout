# TactiScout 第一方单场观察评分：采样与可靠性设计

研究日期：2026-10-07。范围：沿用 [issue 41](../issues/41-structured-first-party-observations.md) 与[第一方观察规程](../../../docs/scouting/first-party-observation-protocol.md)，调查按比赛记录、维度化 1–5 主观评级、场景证据、观察者上下文、双人复核和可靠性评估。只依据原始研究或作者机构/期刊页面；不评估视频版权方案，也不修改产品代码。

## 结论

**把每名球员的每场比赛作为独立观察单元，记录角色与比赛语境、维度化的当前表现判断、可回看的场景证据，并让第二位观察者在不知道首位评分的情况下复评，是有研究依据的产品方向。**但现有研究不证明 TactiScout 当前八个维度、五档锚点或既定小样本数量已经可靠；也不支持将单场评分解释成球员的稳定能力、潜力或球队适配分。

最直接相关的现场研究在一场 U13 11 对 11 比赛中，让同一家荷兰职业俱乐部的 16 名球探按七个维度评价 23 名球员。当前表现的整体分数一致性为中等（临床判断 ICC=.61、指标平均 ICC=.61）；潜力评价较低（ICC=.37、.42）。该研究没有验证 TactiScout 的量表，也没有证明 rubric 自动带来高可靠性。[Peringa 等，2026，期刊原文](https://journals.sagepub.com/doi/10.1177/17479541261428967)

## 建议的采集单元和试点

### 1. 一条记录只描述一个球员的一场比赛

维持 `player × match` 为最小记录单位。一个完整比赛记录说明观察者看了完整比赛；若只看转播片段，则另记片段起止时间/比赛分钟并明确标为片段。不同比赛不要先合并成“赛季印象”，也不要在后台把多场档位平均成玩家级能力分。

本地规程提出的 6 名前锋、每人 2 场、合计 12 条记录，可作为**数据录入和报告呈现的可行性试点**。其中 3 条安排第二人复评可检验双人流程能否实际执行，但对每个维度而言有效双评样本可能更少，不能拿这 3 条计算结果声称量表可靠。文献没有给 TactiScout 此类主观评分的通用最低比赛数或双评比例；应先把它称作试点，而非研究性信度验证。

比赛间表现会因位置、球队/对手水平、比赛结果和主客场等情境而变化。对 2009–2017 年欧冠 12,908 次完整球员比赛观察的研究报告了多种技术表现指标的比赛间变化，且变化与位置及比赛情境有关；这些是技术统计而非主观 scout rating，但支持保存样本语境、不要把一场表现外推为稳定特征。[Yi 等，2020，原始研究](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.01201/full)

建议每条观察记录这些上下文：

- 赛事、赛季、日期、对手、主客场、最终结果；若数据可靠，也记录比赛阶段、赛前/比赛时比分和对手/球队水平。
- 观察者实际看到的球队、位置、职责，以及该角色在本场是否发生变化；不要将这些作为球员当前注册球队的证明。
- 观察者身份及可选的经验/角色说明；是否认识该球员、是否支持其中一队、观看方式（现场/完整录像/片段）、实际观看时长和可用视角。
- 完整比赛/部分片段标记、可观察分钟范围、球员上/下场和是否有足够机会观察该维度。

选择这些语境字段的依据是足球表现本身的情境敏感性，而不是假定所有比赛条件都能通过统计校正消除。Yi 等人的研究观察到位置及比赛情境与技术指标变化之间的关联；Peringa 等人也指出比赛评价难以完全标准化，因为表现动态依赖比赛情境。[Yi 等，2020](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.01201/full) · [Peringa 等，2026](https://journals.sagepub.com/doi/10.1177/17479541261428967)

### 2. 1–5 档应是“本场当前表现”的序数判断

每个维度单独评级，且有该维度自己的可观察描述。5 个档位是 TactiScout 的项目设计选择；研究里可以找到 10 档并分成 4 个文字描述区间的职业俱乐部 rubric，但这并不证明五档优于其他量表或验证了本项目档位。[Peringa 等，2026](https://journals.sagepub.com/doi/10.1177/17479541261428967)

可先沿用当前观察规程的方向，把档位解释为本场证据强度：

| 档位 | 建议解释 |
|---|---|
| 1 | 在有明确机会的多个场景中，反复暴露明显困难 |
| 2 | 有具体依据显示表现偏弱，但样本中也可能有局部合格场景 |
| 3 | 表现一般、混合或不稳定；证据不支持明显强弱判断 |
| 4 | 在多个有代表性的场景中表现出明确优势 |
| 5 | 在多个难度较高或压力较大的场景中持续展现突出表现 |

以上只是供试点使用的初始说明，不能声称经过学术验证。正式录入前应为每个维度写 1–5 的行为锚点和正反例；例如“向前推进”要界定何种带球/传球推进、处于何种压力/区域、成功或失败如何记录。不同档之间的边界应由一名足球知识评审者与标注者用示例共同校准。现场研究中的球探 rubric 也是由 head scout、教练负责人和研究者迭代修订，并让球探在视频上练习和讨论后定稿；但该研究没有对 rubric 培训与无培训条件做有效对照，不能由此断言培训会把一致性提高到某个数值。[Peringa 等，2026](https://journals.sagepub.com/doi/10.1177/17479541261428967)

**机会不足必须是缺失/未观察，而不是 1 分。**“本场没出现可评估的压迫回合”与“在多个压迫回合里表现差”是不同事实。保留 `unknown/not observed`，不插补评分，也不让 LLM 根据球员资料补出比赛判断。这一处理延续 issue 41 的验收边界；它是防止伪造证据的产品约束，不是上述研究验证过的插补策略。

只评本场可观察的当前表现，不评“潜力”“心理素质”“未来会不会适合拜仁”。Peringa 等人的现场样本里，潜力评分的一致性低于当前表现，而且球探自报对潜力评价感到更困难；该结论来自青年球员和单一俱乐部的一场研究，适合作为谨慎边界，不能推广成所有成年职业球员的定量规律。[Peringa 等，2026](https://journals.sagepub.com/doi/10.1177/17479541261428967)

还要避免“有结构就自然可靠”的推断：对 96 名足球教练和球探的视频实验比较了结构化/非结构化收集与机械/整体组合，整体评分可靠性仍差、未来市场价值预测效度小到中等；结构化加机械组合没有提高可靠性和效度。[Bergkamp 等，2022，作者机构记录及论文入口](https://research.rug.nl/en/publications/examining-the-reliability-and-predictive-validity-of-performance-/)

### 3. 每个评分可追溯到一个或多个场景，而不是一句形容词

建议把一条证据写成便于复核的结构：

1. 比赛分钟/片段时间和阶段（有球、无球、转换、定位球）。
2. 可观察的情境：球员当时的位置/职责、对手压力或空间、相关队友/对手关系；只记录观察者实际能看到或能确认的内容。
3. 球员做了什么动作/选择，以及直接可见的结果。
4. 若判断依赖重复性，给出场景分布或代表性正反例，而不是只写“经常”“总是”。

足球比赛观察工具的原始研究把动作与球权开始/发展/结束阶段、空间位置、防守者距离、人数关系和队友支持等情境同时编码；它支持“行为要连同发生条件来记录”的原则，但其目标是对球上动作做分类编码，不是验证 TactiScout 的文字证据格式或主观 1–5 分。[Maneiro 等，2019，Frontiers 原始研究](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.00022/full)

球探 think-aloud 个案研究先由球员位置视频样例和学院教练/招募人员建立属性定义与 codebook，再用同一 codebook 对陈述独立编码；它展示了如何用真实观察语言形成类别定义，不代表口头陈述等同于客观比赛事实。[Owen 等，2019，PLOS ONE 原始研究](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0225033)

评分证据应区分：

- **观察事实**：“第 34 分钟，本队右侧后场出球，边后卫被前压时，球员接应后用身体护球并转向前场，第一脚向前传球被拦截。”
- **解释**：“这次体现了在前压下保持控球/寻找向前线路的意图。”
- **评价**：“压力下控球 4/5。”

示例仅说明表达结构；“意图”和最终分档都可能是观察者解释，需要单独可复核。不要把比分结果、进球/助攻或单次成功动作直接当作某维度高分的充分依据。若场景无法回看，记录观察者原始场景笔记与链接/引用信息，并把它标为人工记录，而不是外部视频已存档证明。

### 4. 双人复评先独立、后讨论，原始分歧必须保留

针对同一 `player × match` 样本，第二位观察者应：

- 在不知道第一位观察者的档位和解释时独立完成各维度评分；在允许且相同的比赛观察材料上工作，不讨论、不共享评分表。
- 先保存双方原始档位、证据描述与观察者上下文；之后才做分歧复盘。共识/裁决结果另存，不能覆盖原始记录，也不能将讨论后的共识当作独立一致性结果。
- 双评样本预先选取或从试点样本中分层抽取，避免只挑“容易一致”或“最有趣”的比赛。把两位观察者是否认识球员、经验背景或视角差异记录下来，便于解释分歧。

Peringa 等人确保同一球员由分配到该球员的多名球探同时观察，并明确要求评估期间不交流；该方式适合估计独立观察者之间的一致性。[Peringa 等，2026](https://journals.sagepub.com/doi/10.1177/17479541261428967) Owen 等人的研究也用两名受训编码者独立编码原始报告，再对不一致的片段逐条讨论重编码；初始一致率是 70.3%，显示应保留讨论前的原始差异，而不是只呈现最终协商版本。[Owen 等，2019](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0225033)

若有许可保留同一段比赛材料，可另做同一观察者的重测：Owen 等人的 study 1 在间隔两周后由观察者重做同一编码；该两周间隔是那项研究的操作选择，不是足球领域的普适标准。[Owen 等，2019](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0225033) 对 TactiScout 当前文字记事，不能把重读自己的旧笔记误称为独立重看比赛。

### 5. 按维度报告分歧，不把一个汇总系数写成“信度已验证”

对 1–5 档，把档位视作有序类别。每个维度分别报告：双评有效条数、档位分布、完全一致率、相差不超过一档的比例、分歧方向/矩阵；有足够样本后，再预先规定线性加权方式，计算双评的加权 Cohen’s κ 并给出不确定区间。加权 κ 的原始方法论文定义了对不同程度分歧给予不同权重的方式；不同权重会表达不同的业务容忍度，因此须事先固定，不能看到结果后挑对自己有利的权重。[Cohen，1968，PubMed 的原始论文记录](https://pubmed.ncbi.nlm.nih.gov/19673146/)

若维度是多个观察事件的分类（如“出现/未出现某种行为”），应另外评价事件编码的一致性；不要把事件识别的一致率与主观档位一致率合在一起。一个足球技术/战术观察工具在经过三次、每次两小时的观察者训练后，对分类核心报告了很高的 Kappa/ICC，但那是限定 U12 样本、事件类别清晰的编码工具，不能据此预测 TactiScout 主观尺度也会有同样数字。[Maneiro 等，2019](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.00022/full)

开始阶段应称作“双人试标/可复核性试点”，而不是“信度测试通过”。例如 issue 40 规程的 3/12 双评可先试验记录界面、锚点和分歧复盘流程；由于每个维度的共同有效记录将少于或等于 3 条，不能据此作统计可靠性结论。扩样时让多名球员、比赛及情境进入独立双评，保留足够档位变异，再按维度评估。足球球探研究本身也显示肉眼判断存在显著分歧：83 名 U11 球探对 24 名球员排序的各组 Krippendorff’s α 仅 .02–.09；这是青年球员筛选排序任务，说明问题存在，不代表 TactiScout 的目标人群一致性会等同于这些数值。[Lüdin 等，2023，期刊原文](https://www.tandfonline.com/doi/10.1080/02640414.2023.2239614)

## 哪些可直接落地，哪些必须实测

| 项目 | 现在可直接落地 | 需要 TactiScout 双人真实标注后才能声称 |
|---|---|---|
| 观察记录 | 每条绑定球员、单场比赛、观察者；保存观察时球队/位置/职责、观看范围和比赛情境；与当前球员效力事实分离。 | 当前元数据是否足以解释 TactiScout 标注中的分歧；尚未有项目数据验证。 |
| 评分语义 | 使用可选、维度独立、样本绑定的 1–5 序数档；每档需要行为锚点；无观察机会留空；只描述本场当前表现。 | 每个维度定义的内容效度；1–5 档是否被两名观察者一致理解；真实一致性数值。 |
| 证据文本 | 记录分钟/片段、阶段、对手压力/空间、动作和结果；将事实、解释、分档分开。 | 证据表单是否令复核更准确/更快；具体字段是否足以还原场景。 |
| 双人流程 | 先独立观察与提交，隐藏互相评分，再讨论；保留原始判断和共识结果。 | 复评流程是否减少偏差；观察者人数、样本范围和双评比例是否足以估计各维度一致性。 |
| 统计报告 | 先展示每维度有效条数、分布、原始一致率、相差一档比例与分歧矩阵；样本太少时明确不计算/不解释信度。 | 足够样本后的加权 κ、置信区间、试标后迭代版本的可重复性；若想谈预测效度，还需要独立未来结果和合适设计。 |

此类结构化观察会让 TactiScout 的单场结论更可追溯、更便于比较分歧；它本身不能证明球员会成功转会、适合某个俱乐部，或未来能力更强。2022 年 96 名教练/球探实验报告了不论结构化与否总体可靠性仍差，2026 年现场研究也仅得到中等当前表现一致性，这两项结果都反对把表单或自动总结直接包装成“专业球探金标准”。[Bergkamp 等，2022](https://research.rug.nl/en/publications/examining-the-reliability-and-predictive-validity-of-performance/) · [Peringa 等，2026](https://journals.sagepub.com/doi/10.1177/17479541261428967)

## 一手来源

- Peringa, I. P., Platvoet, S. W., Meijer, R. R., Niessen, A. S. M., & den Hartigh, R. J. R. (2026). [Rubrics on the pitch: Exploring the reliability of soccer scouts' assessments](https://journals.sagepub.com/doi/10.1177/17479541261428967). *International Journal of Sports Science & Coaching*. DOI: 10.1177/17479541261428967.
- Bergkamp, T. L. G., Meijer, R. R., den Hartigh, R. J. R., Frencken, W. G. P., & Niessen, A. S. M. (2022). [Examining the reliability and predictive validity of performance assessments by soccer coaches and scouts](https://doi.org/10.1016/j.psychsport.2022.102257). *Psychology of Sport and Exercise*, 63, 102257. DOI: 10.1016/j.psychsport.2022.102257. [作者机构记录](https://research.rug.nl/en/publications/examining-the-reliability-and-predictive-validity-of-performance-/).
- Lüdin, D., Donath, L., & Romann, M. (2023). [Disagreement between talent scouts: Implications for improved talent assessment in youth football](https://www.tandfonline.com/doi/10.1080/02640414.2023.2239614). *Journal of Sports Sciences*, 41(8), 758–765. DOI: 10.1080/02640414.2023.2239614.
- Yi, Q., Gómez, M. A., Liu, H., Gao, B., Wunderlich, F., & Memmert, D. (2020). [Situational and Positional Effects on the Technical Variation of Players in the UEFA Champions League](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.01201/full). *Frontiers in Psychology*, 11, 1201. DOI: 10.3389/fpsyg.2020.01201.
- Maneiro, R., Losada, J. L., Casal, C. A., & Ardá, T. (2019). [Design, Validation, and Reliability of an Observation Instrument for Technical and Tactical Actions of the Offense Phase in Soccer](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.00022/full). *Frontiers in Psychology*, 10, 22. DOI: 10.3389/fpsyg.2019.00022.
- Owen, A. L., et al. (2019). [A case study of the use of verbal reports for talent identification purposes in soccer: A Messi affair!](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0225033). *PLOS ONE*, 14(11), e0225033. DOI: 10.1371/journal.pone.0225033.
- Cohen, J. (1968). [Weighted kappa: Nominal scale agreement with provision for scaled disagreement or partial credit](https://pubmed.ncbi.nlm.nih.gov/19673146/). *Psychological Bulletin*, 70(4), 213–220. DOI: 10.1037/h0026256.
