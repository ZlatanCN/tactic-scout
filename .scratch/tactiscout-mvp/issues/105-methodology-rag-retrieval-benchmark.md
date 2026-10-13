# Measure methodology RAG retrieval against a small labeled set

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Turn the existing methodology corpus into a repeatable, low-cost retrieval quality check that is separate from the real-model Agent Harness and does not claim candidate-scouting accuracy.

## Acceptance criteria

- Store a small, versioned set of natural-language retrieval queries with source-level relevance judgments and a short rationale for each judgment. Include queries answerable by each currently admitted methodology source and out-of-scope questions that the corpus cannot support.
- Run each query through the existing `KnowledgeRepository.search` interface against only the permission-gated `methodology` corpus; do not call an LLM, ingest data, alter the index, or send query text to a configured remote embedding service.
- Deduplicate retrieved chunks by source before ranking metrics so repeated chunks from one article do not occupy multiple positions.
- Report source-level MRR, Recall@3 and Precision@3 for answerable queries, plus a separate top-1 false-positive rate for out-of-scope queries. Keep per-query results and corpus/source counts visible; do not collapse them into one score.
- Record that judgments are author-labeled and the corpus contains only two sources, so this is a smoke benchmark for regressions, not a validated estimate of general RAG quality.
- Document a runnable command and ensure the output is reproducible for a pinned dataset version and embedding model.

## Context

- [Domain context](../../../CONTEXT.md)
- [Permission-gated RAG ADR](../../../docs/adr/0002-permission-gated-scouting-corpora.md)
- [Existing evaluation protocol](../research/scouting-recommendation-evaluation-protocol-2026-10-06.md)
- [RAG source admission review](102-open-football-methodology-rag-sources.md)
- [Agent behavior Harness](14-agent-harness-evaluation-suite.md)

## Comments

- 2026-10-09：开始实现。已有行为 Harness 只验证是否调用方法检索，未核对返回的来源是否与查询意图相关；现有研究协议建议按分级检索相关性与候选质量分开评估。

## Answer

新增版本固定的 `methodology-rag-v1` 作者标注集（6 条可回答问题、4 条范围外问题、2 个当前获准来源），并提供 `pnpm eval:methodology-rag`。命令只读本地 `methodology` 索引，经现有知识库检索接口运行；不会调用 LLM、抓取/写入索引，检测到远程 embedding 或 embedding 标识不匹配就拒绝继续。结果按来源去重后报告逐条结果、语料计数、来源级 MRR、Recall@3、Precision@3 和单独的范围外 top-1 假阳性率。

本机结果：158 个方法片段、0 个球员报告片段、3 个登记来源，其中 2 个来源有判断标签；6 条可回答查询的 MRR 0.75、Recall@3 1.0、Precision@3 0.5；4 条范围外查询的 top-1 假阳性为 4/4（100%）。这揭示当前检索会为无关问题照常返回相似论文，尚无相关性拒绝门槛；该指标不是答案幻觉率，也不能作为通用 RAG 或候选推荐质量结论。下一步见 [issue 106](106-methodology-rag-abstention-threshold.md)。

数据集固定 embedding 为 `transformers.js:q8:onnx-community/multilingual-e5-base-ONNX`。API 与 Web 生产构建、`git diff --check` 通过；按用户选择，另外从本机 FPL 2026/27 球员仓库运行 Qwen 3.5 9B 完整拜仁接班人对话，经历 3 轮同案交互、2 次追问，评估 10 人并完成 Reviewer/报告，28/28 Harness 检查通过（121.562 秒），详见 [issue 14](14-agent-harness-evaluation-suite.md)。这只验证本次工作流与证据契约，不证明排序准确性、一般 RAG 质量或长期稳定性。
