# 中文查询检索英文足球方法论文：RAG 方案与评测

研究日期：2026-10-13。目标：解释并验证中文招募对话检索英文足球方法论文时，怎样提升相关证据覆盖，同时保留当前保守的来源弃答保护。范围限于方法语料；不评价候选球员排序，也不推荐直接改变生产门槛。

## 结论

v4 暴露的是**语义候选已找到、语言相关性闸门却无法对齐**的问题：新论文有留出相关证据的 embedding cosine 高于 0.812，但中文 query 到英文片段的词项覆盖最高只有 1/3，低于 0.5，所以来源被拒绝。仓库将 `query` 与 `passage` 前缀正确用于 multilingual E5；来源准入则还要求**同一个片段**同时达到固定 cosine 和精确词项覆盖率。[v4 记录](../../../docs/evaluation.md#新增方法来源检索准入-v4) · [当前检索器与策略](../../../src/knowledge/index.ts)

这不足以证明 E5 的中文到英文语义检索有问题，也不能据此关掉词项门槛。更合适的解释是：当前词项覆盖是单语言、字面形式指标，被用作跨语言 query–document 相关性保护时会误拒；直接只看 cosine 则可能让语义相近但不回答问题的来源进入 Agent。后一风险是对系统行为的推论，应由含模糊和范围外问题的新评测验证。

**建议顺序：**先用一组人工核对、严格保义的英文 query 译文做离线诊断；若在全新留出家族提升相关来源覆盖且没有新增误接收，再考虑本地自动翻译为单个查询译本。把中文来源摘要留作回退方案；只有当前 E5 第一阶段召回已达标后才测二阶段 reranker。每一步先独立消融，门槛与 v4 保持只读。

## 对当前实现的事实核对

- 当前固定方法检索版本使用 `transformers.js:q8:onnx-community/multilingual-e5-base-ONNX`，并且 `acceptsMethodologySourceSignal` 对其他 embedding 模型直接拒答。[实现](../../../src/knowledge/index.ts)
- E5 官方模型卡要求检索任务的输入分别加 `query:` 与 `passage:` 前缀；即使文本不是英文也要保留。项目的本地适配器已经照此实现。模型卡还说明 E5 cosine 通常落在 0.7–1.0，绝对值不如相对排序重要，并指出长文本最多截断到 512 tokens；因此不要把模型卡 benchmark 或 cosine 数值当作跨模型、跨语言阈值。[multilingual-e5-base 模型卡](https://huggingface.co/intfloat/multilingual-e5-base)
- E5 模型卡称模型支持 100 种语言，但低资源语言可能退化；训练中包含多语种预训练，并使用了中文 DuReader Retrieval 及多语言 Mr. TyDi、MIRACL 的监督微调数据。这支持把它作为合理的中文/多语种起点，不证明它在本项目的**中文 query→英文足球论文**上达到所需召回或安全性。[模型卡训练与限制](https://huggingface.co/intfloat/multilingual-e5-base#training-details)
- 当前 tokenizer 对 query 与片段生成词项后做精确集合匹配，不做翻译、同义词映射或跨语言词对齐。[词项与来源门槛实现](../../../src/knowledge/index.ts)

## 可测路径

| 方案 | 如何适配现有 E5 + gate | 建议测量 | 弃答风险与限制 |
|---|---|---|---|
| **A. Multilingual E5 单独检索（仅诊断）** | 保留英文论文原文和中文 query，用现有 E5 取候选；在离线分析里暂时观察 cosine-only 会返回哪些来源，但线上 gate 不改变。 | 相关片段 `Recall@20`、当前 cosine 阈值下的来源覆盖、相关/不相关候选的 cosine 分布。 | `cosine-only` 不能回答“同义但不相关”或“只支持问题一部分”的风险，且 v4 的现有文字闸门本来会拒绝样本。只作召回上界诊断，不作准入提案。模型卡强调看排序而非绝对 cosine，因此任何门槛都需要本语料标注校准。[E5 模型卡](https://huggingface.co/intfloat/multilingual-e5-base) |
| **B. 中文 query 的英文翻译** | 不改论文、不扩展概念；为每个中文 query 产生一个保义英文版本，使用同一 E5 的 `query:` 路径查英文原文，再以该英文版本和原始英文片段计算 cosine 与词项覆盖。中文原 query 保留作审计，不与英文 query 取最大分后直接放行。 | 对同一意图配对记录中文/英文检索的片段 `Recall@20`、来源覆盖、precision/recall、模糊/OOS 误接受、人工译文与自动译文差异、端到端延迟。 | 英文 query 的分数分布可能与中文 query 不同，旧 0.812 阈值不能默认适用于它；先在新 calibration 上校准、冻结后看新 held-out。多个译本/扩展词取最大值会增加至少一个版本偶然过门槛的机会，这是多重候选机会增多的工程风险推论。翻译不能作为报告证据，也不能改写原问题中的否定、范围或战术含义。 |
| **C. 有署名的中文派生方法摘要** | 为授权论文撰写查询无关的短中文摘要，将其作为带 `derived-from` / DOI / 许可 / “项目作者摘要、非论文原文”归属的检索片段；原论文仍是唯一可引用证据。项目已有这种作者撰写中文方法摘要的模式。[现有摘要约定](../../../src/knowledge/seed.ts) | 原文片段 vs 摘要片段配对比较来源级 coverage、摘要对应原文可支持性、模糊/OOS 误接受与摘要命中后的原文回查成功率。摘要先写定再冻结 query，禁止根据测试问题嵌入关键词。 | 摘要会漏掉条件、限制或研究设计细节；若把摘要当原文证据就会把编辑改写误称成论文结论。应把摘要仅作为召回索引/定位器，答案引用回原文段落。人工摘要也会对单篇论文增加维护工作，不能自动解决所有新来源。 |
| **D. 多语种 cross-encoder reranker** | 在 E5 当前 top-k 之后，对 `(中文 query, 英文 passage)` 重新排序；保留原始 E5 结果和当前闸门。BAAI `bge-reranker-v2-m3` 官方模型卡支持多语种，接收 query/passage 对并输出相关性分数；官方示例走 FlagEmbedding 或 Sentence-Transformers。[BAAI 官方模型卡](https://huggingface.co/BAAI/bge-reranker-v2-m3) | 固定候选集上测 chunk `nDCG@5`、`MRR@10`、相关段落是否仍在 `Recall@20`、每类分数分布、模糊/OOS 误接受与端到端本机延迟。 | reranker 只能重排给它的候选，无法找回第一阶段未召回的论文段落；其分数是排序信号，不是已校准的来源接受概率。不要用 sigmoid 变换后的 0–1 值就当可信度。官方卡给出的 Python API 不证明它能直接在当前 TS + Transformers.js ONNX 路径运行；先做本地兼容性和资源占用 smoke，若要引入服务/第二运行时，收益须覆盖新增耦合。 |

### 研究证据怎样解读

Saleh 与 Pecina 在 CLEF eHealth 的跨语言检索实验中比较 query translation 与 document translation；他们报告 query translation 通常有更好的检索结果，但这是**医疗领域及特定语料**，不能直接保证足球论文效果。它支持优先测试“一条 query 译本”而不是先复制/翻译所有文章，不支持照搬任何收益百分比。[ACL 原始论文](https://aclanthology.org/2020.acl-main.613/)

MIRACL 与 Mr. TyDi 的任务主要是同一语言 query 检索同一语言语料，因此不能单独回答本项目的中英跨语场景；XOR-Retrieve 明确要求用目标语言问题找英文 Wikipedia 段落，更接近跨语检索形式，但其主题、语言和语料都不等于中文足球方法 RAG。外部 benchmark 可检验一般检索器的 sanity，不替代本项目来源级、模糊/OOS 标注集。[MIRACL 原始论文](https://aclanthology.org/2023.tacl-1.63/) · [Mr. TyDi 原始论文](https://arxiv.org/abs/2108.08787) · [XOR QA 原始论文与任务定义](https://aclanthology.org/2021.naacl-main.46/)

模型替换（例如 BGE-M3）属于单独的 embedding migration，而非沿用当前 gate 的小调整。BGE-M3 原论文提出 dense、sparse、multi-vector 多种检索能力；切换后索引向量及门槛都要新建版本，当前实现也会对非固定模型弃答。先解决语言特征与证据门槛的对齐，避免把索引、模型、闸门三个变量同时换掉。[BGE-M3 原论文](https://arxiv.org/abs/2402.03216) · [当前模型固定检查](../../../src/knowledge/index.ts)

## 新评测：`methodology-rag-v5-crosslingual`

不要重复 v4 的 query-family 或复用其 held-out 问句作调参集。新版本在测试运行前冻结 source inventory、逐段 qrels、query family 和主指标；答案标签由不知道检索臂输出的人标注。v4 及历史 v1–v3 保持不可变。

### 最小规模与切分

- 12 个全新意图家族，按家族而非语言变体分为 6 个 calibration、6 个 held-out；每个意图有一条自然中文 query 和一条经双语检查、保持含义不变的英文译本。两种语言版本共用意图标签，不能分到不同 split。
- 每个 split 至少含 2 个候选 PLOS 论文可回答意图（分别覆盖画像方法/指标解释与研究边界）、1 个现有方法来源的可回答控制、1 个模糊边界问题、2 个范围外问题（例如具名转会结论、球员当前状态或估值）。每个问题对相关的**段落/片段**做 qrels，并另标相关来源集合，以同时评价 reranking 与来源 gate。
- 每个 query family 先标 `answerable`、`ambiguous` 或 `out_of_scope`；相关性评审要区分“源文章主题相关”和“这段确实支持这个问题”。小样本只报告计数和逐案错误，不宣称线上风险率或一般化球探质量。

### 消融顺序与指标

1. **基线**：当前中文 query + multilingual E5 + 固定现行 gate。
2. **语言诊断**：只对 cosine 做离线召回诊断，不让它产出正式接受决策。
3. **query translation**：单个英文译本查同一英文来源；在 calibration 评估固定 gate 的表现，再如需新阈值，只在该 calibration split 上预先选定并冻结。held-out 只报告结果。
4. **中文派生摘要**：沿用当前 embedding 与 gate，独立比较原文片段、摘要片段和摘要到原文的回查。先测这一臂再加 translation + summary 的组合，避免一次改多个因素。
5. **reranker**：只在基线或前序获胜臂的固定 top-20 候选内消融；候选集不变，先报 `Recall@20` 再报排序指标。不要把 reranker 单独作为第一阶段检索器。

所有臂记录：answerable source coverage、chunk `Recall@20`、source-level precision/recall、ambiguous unsupported-source acceptance、OOS false acceptance、false abstention、每个意图的原始信号及本机延迟。以“留出相关片段覆盖提高，同时模糊/OOS 接受数没有增加”作为暂定入围条件；任何 score 阈值须独立版本化，不能在看到 held-out 后调整。v5 的作者标注集仍只是工程回归，不是通用 benchmark。

## 推荐的下一个动作

先不改代码或生产索引。新增并冻结上述 v5 问题家族后，手工核对 query 的保义英文译本，跑**只有 current baseline 与 query-translation 两臂**的对照。之所以将 query 翻译排第一，是它最直接检查中英词项错配，而且不需要复制/改写全部来源；这只是优先级判断，不是已验证的结果。若它只改善相关 coverage 却增加一个 OOS/ambiguous 接收，保留拒答并研究 source-derived 中文摘要；reranker 留到第一阶段召回充足时再做。

## 主要来源

- [Wang et al., “Multilingual E5 Text Embeddings: A Technical Report” (2024)](https://arxiv.org/abs/2402.05672)；[作者维护的 multilingual-e5-base 模型卡](https://huggingface.co/intfloat/multilingual-e5-base)。
- [Saleh & Pecina, “Document Translation vs. Query Translation for Cross-Lingual Information Retrieval in the Medical Domain” (ACL 2020)](https://aclanthology.org/2020.acl-main.613/)。
- [Zhang et al., “MIRACL: A Multilingual Retrieval Dataset Covering 18 Diverse Languages” (TACL 2023)](https://aclanthology.org/2023.tacl-1.63/)；[Zhang et al., “Mr. TyDi: A Multi-lingual Benchmark for Dense Retrieval” (2021)](https://arxiv.org/abs/2108.08787)。
- [Asai et al., “XOR QA: Cross-lingual Open-Retrieval Question Answering” (NAACL 2021)](https://aclanthology.org/2021.naacl-main.46/)。
- [Chen et al., “M3-Embedding: Multi-Linguality, Multi-Functionality, Multi-Granularity Text Embeddings Through Self-Knowledge Distillation”](https://arxiv.org/abs/2402.03216)；[BAAI bge-reranker-v2-m3 official model card](https://huggingface.co/BAAI/bge-reranker-v2-m3)。

## V5 对照实测更新（2026-10-13）

依照上述优先顺序，建立了全新的 `methodology-rag-v5-crosslingual`：12 个 query families，calibration/held-out 各 6 个；中英版本共享 intent、相关来源标签和切分，且与 v4 的 families 不重合。比较固定原中文问与项目作者英文译问，使用同一 PLOS 候选文、同一索引、同一 multilingual E5 和同一生产 `0.812 / 0.5` gate。

- held-out 可回答证据覆盖从 1/3 升到 3/3；候选论文覆盖从 0/2 升到 2/2。
- source-pair recall 从 1/3 升到 3/3；precision 保持 1.0。
- 模糊问题的 unsupported source acceptance 为 0；两条 out-of-scope 问题 false acceptance 为 0/2。
- CLI 按 DOI 临时获取并在当前索引加入 56 个候选片段，评测后从当前 LanceDB 表版本删去 56 个；没有修改 `sources.json`，没有改阈值或生产查询路径。

这支持“同一模型下，英文 query 可能修复中英词项覆盖错位”这一**本项目固定查询集上的观察**。译文由项目作者撰写，没有独立双语审校；样本仍小且是作者标注。此次只报告 source-level 的生产准入结果，没有建 chunk-level qrels，也没有测 `Recall@20` 或 reranker 排序。因此它既不验证自动翻译的保义能力，也不证明通常场景的跨语言召回。项目不启用 production translation；下一步应先让独立双语评审核对 query 对，再为任何运行时翻译行为另建冻结评测，并保留否定、歧义和范围外弃答检查。来源、逐 query 信号和限制见 [issue 190](../issues/190-evaluate-cross-lingual-methodology-retrieval.md) 与[评测文档](../../../docs/evaluation.md#中文-query-与英文论文的-v5-跨语言诊断)。
