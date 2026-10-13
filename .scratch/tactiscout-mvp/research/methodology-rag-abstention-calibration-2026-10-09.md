# 方法 RAG 的相关性门槛与弃答校准

研究日期：2026-10-09。范围：当前仅含两篇获准方法来源的本地检索语料；目标是阻止无证据来源进入 Agent 报告，不评估球员排序质量。

## 建议

采用**来源级、确定性、保守的证据闸门**，把策略输出分成 `accepted`、`uncertain` 和 `abstained`，但只有 `accepted` 的来源可进入报告。`uncertain` 与 `abstained` 都不附加方法引用；案件可以继续使用球员数据完成分析。保留不同原因码，区分“范围外/没有可支持来源”和“相关性分数落在不确定区间”。暂不让一个 LLM 给自己刚检索的来源打分。

校准流程应是：

1. 冻结新的数据集版本；为每条 query 标注 `answerable`、`ambiguous` 或 `out_of_scope`，并对每个候选来源给出人工来源级相关性标签与理由。问句要覆盖两篇来源各自的直接主题、边界问题和多种不同意图的范围外查询；不要把同一句式的轻微改写分到 calibration 与 holdout 两边。
2. 只在 calibration 部分比较预先声明的确定性信号和门槛。按“可回答问题保留率 / 范围外误接收率”呈现阈值的取舍；若误引来源代价高，可将 calibration 范围外 query 上零误接收作为**暂定操作目标**，但不能称为错误率保证。
3. 锁定阈值后，只在 holdout 上报告混淆计数、answerable coverage、false abstention、out-of-scope false acceptance 和逐 query 结果。若 holdout 规模仍很小，称作版本化回归检查，不声称已估计真实使用分布上的泛化错误率。加入新来源、embedding、切块策略或混合检索配置后，重新校准并升版本。

NIST 的检索评测定义要求 query、语料和相关性判断（qrels）相匹配；pooling 收集到的判断只有在覆盖足够时才能近似视为完整，未判断内容不能自动等于不相关。[NIST TREC relevance judgments](https://trec.nist.gov/data/reljudge_eng.html) 因此标签应针对冻结的当前语料和来源，而不是笼统地标“足球问题/非足球问题”。作者自标的小集合可支持工程回归和错误分析，不足以代表真实用户 query 分布。

## 对当前实现的含义

仓库的 [`LocalKnowledgeBase.search`](../../../src/knowledge/index.ts) 把 BM25 排名与向量排名用 RRF 合并。RRF 的原始论文将其定义为**合并多个排序列表**的方法，而不是相关性概率模型。[Cormack et al., SIGIR 2009](https://doi.org/10.1145/1571941.1572114) 从当前实现可见，RRF 分数由排名位置累加，API 返回结果不暴露这个分数；所以不应直接把 top-1、固定 rank 或 RRF 数值解释为“相关概率”并挑一个常数作通用门槛。此结论是对仓库实现和 RRF 定义的推断。

向量相似度也只表达 embedding 空间的接近程度。Microsoft 的检索设计文档指出，cosine / 关键词分数各有局限，并不判断某个 chunk 是否实际回答了 query；混合搜索的 RRF 分数面向排序，官方说明甚至需要逆变换才能取得 cosine 值用于自定义质量截断。[Azure AI Search: retrieval and reranking](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-information-retrieval) · [Azure AI Search: vector ranking scores](https://learn.microsoft.com/en-us/azure/search/vector-search-ranking) 若本任务要按已有检索器做可复现的本地门控，建议把稳定信号显式作为结果字段暴露，并在**来源去重后**判断：例如每个来源最佳片段的 cosine、非零 lexical match，以及与人工来源级标签对应的确定性组合。选择哪一个组合要由当前 corpus 的标注结果决定；不要把候选片段的数量当成多份独立佐证。

## 研究先例与边界

- CRAG 将 query–document 相关性估计用于三段策略：高于上阈值视为正确，低于下阈值视为错误，中间段按 ambiguous 处理；论文报告明确写明其 T5 evaluator 是用标注/数据集信号微调，阈值按数据集经验设置（PopQA、PubHealth/ARC、Biography 的数值各不相同）。这支持“分段决策 + 语料/任务专属校准”，不支持直接移植论文阈值到 TactiScout 的向量/RRF 分数。[CRAG paper, §§4.2–4.3, Appendix B.3](https://arxiv.org/html/2401.15884) · [authors’ implementation](https://github.com/HuskyInSalt/CRAG)
- 选择性分类研究将拒答视为覆盖率与已接受样本风险之间的取舍，阈值应对应明确风险目标，而不是把任何非空 top-k 当成证据。[Geifman & El-Yaniv, NeurIPS 2017](https://proceedings.neurips.cc/paper/2017/hash/4a8423d5e91fda00bb7e46540e2b0cf1-Abstract.html)
- NIST 2025 对 IR 自动相关性判断的回顾指出，相关性标签是检索评测的 ground truth，构造判断集本身需要谨慎；不应让被评系统输出代替独立判断。[Soboroff, “Don’t Use LLMs to Make Relevance Judgments,” 2025](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=958495)

若将来追求统计风险保证，可研究 selective / conformal risk control；但这需要校准样本与部署 query 满足相应抽样/交换性假设及稳定标签定义。当前作者挑选的少量 query 不满足据此对外作泛化保证的证据要求。[Selective Conformal Risk Control](https://arxiv.org/abs/2512.12844)

## 小样本报告规范

本次 `methodology-rag-v1` 只有 4 条范围外 query，而且 4/4 都命中某篇来源。扩展后即使 holdout 上 `0/4` 误接收，也只能写“本版本 holdout 的 4 条范围外案例中观察到 0 次误接收”；它既不能证明错误率为零，也不能代表未来 query。若这些案例不是从目标用户分布随机抽样，二项区间也不能修复代表性问题。应优先扩充不同**意图家族**和易混淆边界 query，报告分子/分母与逐案结果，而不是只报百分比。

### 适用于 issue 106 的结论

保持 v1 不变；新版本把 calibration 与 held-out query 家族分开。先实现可观测的确定性来源相关信号，再校准一个保守的来源级接收门槛。`accepted` 才能进入 Agent 的方法引用；`uncertain` / `out_of_scope` 返回零方法证据并带不同原因码。基准分别报告 answerable coverage、false abstention 和 OOS false acceptance，严谨地称为小语料回归评测，而非已验证的线上泛化率或球探质量指标。
