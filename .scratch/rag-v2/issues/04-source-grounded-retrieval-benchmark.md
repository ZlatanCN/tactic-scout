# 04: 自动生成带原文区间的检索基准

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: 02: 通用结构化资料进入现有检索链路。

## What to build

维护者可从获准语料自动生成、核验并冻结检索问题；运行检索对照后，能看见哪些必要证据进入结果、排在什么位置。

## Acceptance criteria

- [x] 每题绑定来源版本、一个或多个精确支持区间、必要事实组、可替代的充分支持路径、处置标签及题目生成/核验角色的模型与提示版本。
- [x] 按同事实、近重复问题及重叠支持区间分组，以事实组划分开发集和冻结验证集；冻结题/答案不进入检索索引或开发提示样例。
- [x] 生成至少 80 道合格题、40 个独立事实组和六个独立文章来源；负例有范围依据，来源正文不足以支持结论时隔离该题。
- [x] 检索指标区分已知相关块的 Recall@k/Hit@k/MRR、原文区间覆盖、必要事实找齐率；拒答题没有正向证据时，Recall/MRR 记 N/A 并报告分母。
- [x] 同一固定题包可比较全文、向量、RRF/混合检索；各方案输出候选原文区间、引用、索引签名和耗时。
- [x] 程序校验引用、区间、版本、分组和题包完整性；评测标签标明 AI 生成/核验，不称为真人标注。

## Answer

v5 题包通过完整性与来源区间校验：102 题、48 个事实组、6 篇独立全文文章，57 道开发题和 45 道冻结验证题；包含 methodology、player_report 和跨来源题，项目自制摘要没有计作论文来源。另用相同 57 道开发题比较了 full_text、dense_vector 与 hybrid，完整结果位于 `data/knowledge/evaluation/runs/rag-v2-retrieval-strategy-comparison-dev.v5.json`：coverage@6 分别是 0.935、0.806、0.968；MRR 分别是 0.886、0.783、0.857。该对照实际用了 0 次网关调用。独立的 12 题 ranker comparison 记录 hybrid、gateway reranked 和 local cross-encoder，位于 `rag-v2-ranking-comparison-dev.v5.json`。这些均是开发集结果；Agent 验收在后续 ticket。
