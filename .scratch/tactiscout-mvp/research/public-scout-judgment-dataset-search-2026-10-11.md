# 公开球探判断数据：能否评估 TactiScout 短名单

研究日期：2026-10-11；增量核验：2026-10-12。范围：公开可访问的足球数据/基准是否包含真实球探或教练对球员的独立判断，足以验证按具体招募需求生成的候选排序。未下载数据集、未联系作者或平台、未处理球员记录。

## 判定标准

直接用于 shortlist nDCG/qrels，至少需要：固定的招募需求或选择任务、该任务对应的候选池、候选级人工相关性/成对偏好/完整排名、足够的评审独立性，以及可核验的数据来源和复用许可。通用潜力标签、赛后表现分、算法排序、球队是否签约等代理信号不自动满足这些条件。

## 结论

**NO-GO：当前没有发现可直接导入并公开展示、用于 TactiScout 职业转会 query-specific 排序验收的开放金标准。** 本次补查发现一份值得留意的 Scoutium 人工评估镜像，以及两项真实青年球探排序/评分研究；它们分别缺少具体转会需求、公开逐候选 qrels 或已核实的复用许可。最有价值的下一步仍是使用项目已有盲评工作台，为冻结的真实招募 brief 和候选池收集独立评分；不要将这些相邻任务宣传为“推荐准确率”。

## 来源逐项结果

| 来源 | 人工判断与开放程度 | 是否可验证 TactiScout 的 shortlist | 决定 |
|---|---|---|---|
| 两份内容不同的 Scoutium Kaggle 用户上传：[属性评分包](https://www.kaggle.com/datasets/gzdekzlkaya/scoutium-player-attribute-ratings-dataset)及[带 potential 标签的评分包](https://www.kaggle.com/datasets/mustafaoz158/scoutium-football-scout-ratings)；另有[字段说明镜像](https://github.com/fatihsen20/scoutium-talenter-hunting-classification/blob/main/README.md) | 先前把字段镜像中的 10,730 条属性评分和 322 条 potential_label 概括成同一份可核实数据，证据不足，应撤回这个合并描述。增量核验显示，gzdekzlkaya 上传包为属性评分包并标注 CC BY-SA 4.0；mustafaoz158 上传包包含 potential 标签，但标注 Unknown。两者都是第三方上传，且未证明 Scoutium 授权、原始来源、年龄/赛事范围或字段镜像与各包的对应关系。 | **不能做 query-specific 排序。** 没有球队 brief、目标队战术/岗位、预算或候选适配标注；通用“潜力/突出”不是适配。即使某包可用于预测单个评审流程的 potential 标签，也不等价于 TactiScout 的外部引援适配质量。 | 不进入 TactiScout gold set，不下载、训练或展示原始行。Kaggle 的许可元数据不能替代对上游提供方授权的核验；属性包上标出的 CC BY-SA 4.0 不能自动扩展到另一位用户上传的 Unknown 包。 |
| [Lüdin et al. 2023：83 名球探对 U11 球员排序](https://doi.org/10.1080/02640414.2023.2239614)；[FIFA Training Centre 研究简报](https://www.fifatrainingcentre.com/en/environment/research-brief/high-performance/find/luedin-agreement-between-scouts.php) | 论文确实研究了 83 名受过教育的瑞士球探对两场选拔赛、每场 12 名 U11 男球员按进入人才发展项目优先级做排名；四组评审的 Krippendorff α 仅 .02–.09。此次找到的是论文和方法摘要，未找到公开逐球员/逐评审排名文件。 | **如果原始评审包可公开且许可明确，它是最接近“真实短名单排序”的研究数据**；但任务是青年培养项目选拔，不是成年职业球员的球队需求/职责适配。当前只有聚合结果，不能重算模型 nDCG，也没有真实职业候选 ID 可映射。 | 不可作为现成基准；可把该论文用作分歧/评审协议设计依据。未联系作者（本任务禁止）。 |
| [Peringa et al. 2026, Rubrics on the pitch](https://doi.org/10.1177/17479541261428967)；[论文 OSF 数据链接](https://osf.io/95kgd/) | 16 名荷兰职业青训球探评估 23 名 U13 男球员，对 7 个可观察指标分别打当前表现与两年潜力分；数据/代码由论文声明存于 OSF。单评当前表现 ICC=.61，潜力 ICC=.37（actuarial 分别 .61/.42），显示潜力判断噪音更高。球员以随机号码匿名，研究说明未收集个人身份信息。 | **可辅助制定 rubric、展示评审分歧，不能做转会 shortlist qrels。** 没有球队招募 query、完整转会候选池或目标角色；年龄段/任务域也和职业引援差异很大。 | 可以引用论文并借鉴其维度/可靠性结论。论文许可为 CC BY 不自动覆盖 OSF 单独数据文件；本次未能核验 OSF 文件级许可，故不复制或展示原始评分。 |
| [PlayeRank 原论文](https://doi.org/10.1145/3343172)；[公开 PlayeRanks 数据](https://figshare.com/articles/dataset/PlayeRanks/9361148) | 论文的方法更具体：3 名 Wyscout 职业球探对 202 名球员构成的 211 组 pairwise 选择更好者或平局；pair 从 PlayeRank 自己的角色排序抽样，分歧过大的 8% pair 被排除，发表的是汇总一致率而非逐评审判断。公开 Figshare 数据明确是 PlayeRank 模型的逐场 0–1 算法分、角色簇、分钟、进球，许可 CC BY 4.0。 | **不能复现专家 pairwise 评测，也不是招募适配。** 专家比较的是相对比赛表现；查询需求、目标球队职责和适配标签均不存在。公开算法分数是被验证系统输出，拿它替代专家标签会循环验证。 | 可在权利范围内作为历史表现/算法基线；论文的聚合实验可作方法参考，不能称为 TactiScout 的专家金标准。 |
| [Bergkamp et al. 125 名球探问卷](https://doi.org/10.34894/LKDXFD)与[2025 英格兰职业青训球探调查数据](https://figshare.com/articles/dataset/_b_Scouting_in_English_male_professional_football_academies_survey_data_b_/29100194) | 前者是自述问卷：125 名球探报告其识别潜力的方式和关注属性；其中要求排序的是球探自己列出的球员属性（最能预测到最不相关），不是给球员排名；125 人中只有 8 人（6%）通常观察成年球员。后者公开 71 名英格兰男足职业青训球探对工作实践/态度的匿名问卷，数据页标 CC BY 4.0。 | **无适用的球员候选判断。** Groningen 问卷数据不包含针对候选球员的招募短名单 qrels；样本主要关注青训，也不能代替成年职业转会判断。 | 可引用聚合研究、学习其结构化评分与观察维度讨论；不作为球员标签。 |
| [公开合成 scouting 数据集 A](https://huggingface.co/datasets/talcabalo/big5-football-scouting)和[合成数据集 B](https://huggingface.co/datasets/Ilayr222/proscout-players-1112) | 其中包含“role-fit”描述或自然语言 brief→top-k 场景，但来源自述是合成球员；推荐理由/适配内容并非真实球探独立判断。 | **只能测 schema、检索、UI/harness 的已知答案流程。** 用生成数据评价推荐是否“正确”会把数据生成规则当成金标准，不能验证真实球员表现。 | 仅限标明 synthetic 的功能演示/回归夹具；不要混入真实质量结果。 |

## 复用边界

- **许可/来源：**Kaggle 官方说明 dataset 发布者选择许可；Kaggle 的 license disclaimer 明确许可元数据不保证准确。Scoutium 镜像页未能证明 Scoutium 对上传者或 TactiScout 的授权。项目“非商业”也不能弥补缺失授权。不要把 Kaggle 用户 notebook 的 Apache 代码许可误当成数据许可。来源：[Kaggle 数据集文档](https://www.kaggle.com/docs/datasets)、[Kaggle 许可免责声明](https://www.kaggle.com/page/license-disclaimer)。
- **研究论文 vs 原始数据：**Rubrics 论文的 CC BY 仅能据可见论文/学校库声明引用文章，不推定 OSF 中评分表的许可。PlayeRank 的 CC BY 只支持页面明示的算法输出数据，不会自动开放论文内未发布的专家判断或事件数据中其他权利。
- **模型处理：**即便仅本地运行模型，加载球员级评分/标签仍是数据处理；来源、许可及可否用于模型输入未明前，不将 Scoutium 或 OSF 原始评分送入 LLM、索引/RAG、微调/评估流水线。
- **展示：**不要在网页、简历截图或公开报告展示来源不明的逐球员、评审者 ID、原始评分或可链接小样本。可以展示经许可的论文级汇总、公开方法与准确归因；匿名 ID 本身不等于获得展示许可。
- **匿名与未成年人：**2026 实地研究明确匿名 U13 球员并获得球员/家长告知；Scoutium 官方产品页面说明其涉及学院/足球学校青年球员。不要从镜像字段臆测具体年龄；但在未核实具体数据年龄、可识别性、同意范围前，不将其当成人职业球员样本公开展示。[研究伦理与匿名方法](https://journals.sagepub.com/doi/10.1177/17479541261428967) · [Scoutium 官方产品说明](https://apps.apple.com/us/app/scoutium/id1412090548?platform=watch)。

## 建议落地

1. **不导入外部“金标准”。** 项目当前 nDCG 继续在没有已裁决人工 qrels 时返回 not_evaluable。
2. 对一条具体、冻结的成年人转会 brief 和完整候选池，用现有匿名工作台收集至少两份独立 0–3/unknown 判断，完成匿名裁决后再评估；单个案例只宣称该案例结果。
3. 若未来想使用 Scoutium，只在先查清原始来源/许可、候选身份可映射、同一评审输入-结论泄漏及评估问题定义后，另立“预测单个 scout 的一般潜力标签”实验；清楚命名为 proxy，不与招聘适配排序合并。
4. 将 Lüdin 2023 标记为后续可申请公开原始 qrels 的研究线索，但本次不联系作者；即使取得，也只作 youth-selection 方法学外部验证，不直接宣称职业引援适配有效。

## 本次边界

本次检查过已有研究笔记（2026-10-10/11 公开基准审计、短名单人工判断方法、评测协议、自建数据可行性），重点补查了 Scoutium 镜像、Lüdin 2023 真实球探 shortlist 研究，以及 2025 英格兰青训球探调查。检索结论表示“在所查官方页面、论文和数据仓库中未发现满足条件的可复用 benchmark”，不证明不存在未索引或私有数据库。

## 2026-10-12 增量核验

- 修正 Scoutium 描述：两个 Kaggle 用户上传的内容和许可并不相同。属性评分包显示 CC BY-SA 4.0；另一个带 `potential_label` 的包显示 Unknown。现有 GitHub 字段说明镜像不能证明这些字段同属一个包，更不能证明 Scoutium 授权或样本属于成年男足。参考 [属性评分包](https://www.kaggle.com/datasets/gzdekzlkaya/scoutium-player-attribute-ratings-dataset)、[标签包](https://www.kaggle.com/datasets/mustafaoz158/scoutium-football-scout-ratings)、[Scoutium 官方简介](https://scoutium.com/static/about-us)。
- 修正 Groningen 问卷解读：[论文方法](https://onlinelibrary.wiley.com/doi/full/10.1080/17461391.2021.1916081)显示“rank”指评审者为自己列出的预测属性排序，不是球员排名；样本只有 8/125 球探通常观察成年球员。因此此数据不能被描述为球探短名单标注。
- 细化 PlayeRank 评估边界：[论文 §5](https://arxiv.org/html/1802.04987)显示 211 组 pairwise 来源于算法自身角色排序抽样，8% 无多数判断的配对被排除，论文只发布汇总一致率。这是有用的算法-球探比较研究，但没有开放逐候选 qrels 或团队需求条件，不能复算 TactiScout 的 query-specific nDCG。
- 决策不变：不导入任何外部数据标签；无已裁决人工短名单标签时，项目质量评估继续返回 `not_evaluable`。这些修正进一步收窄了“存在球探判断数据”的含义，没有改变 no-go 结论。

