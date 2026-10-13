# Calibrate methodology RAG relevance and abstain out of scope

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: 105

## Goal

Prevent the methodology retriever from presenting football analysis papers as relevant evidence for questions that the approved corpus cannot answer.

## Acceptance criteria

- Expand the author-labeled methodology query set with varied answerable, ambiguous, and out-of-scope examples for each currently admitted source; keep the current benchmark split/version immutable.
- Expose a stable retrieval relevance signal or another deterministic acceptance rule from the existing hybrid search, without using an LLM to self-grade its own retrieval.
- Choose and document a relevance/abstention policy using separate calibration and held-out examples; do not tune and report on the same tiny four-query negative set as if it were an independent estimate.
- Below the accepted evidence threshold, return no methodology evidence so the Agent can continue without unsupported citations or report references.
- Add the new dataset version and report answerable retrieval metrics and out-of-scope false-positive rate separately, including query/source counts and limitations.
- Verify the local RAG CLI and the complete data warehouse → LangGraph → report Harness; do not make claims about candidate ranking accuracy.

## Context

- [Domain context](../../../CONTEXT.md)
- [Permission-gated RAG ADR](../../../docs/adr/0002-permission-gated-scouting-corpora.md)
- [Source-level retrieval benchmark](105-methodology-rag-retrieval-benchmark.md)
- [Existing retrieval and scouting evaluation protocol](../research/scouting-recommendation-evaluation-protocol-2026-10-06.md)

## Comments

- 2026-10-09：issue 105 的四条范围外查询全部取得 top-1 方法来源（4/4）。这说明当前 `KnowledgeRepository.search` 没有弃答门槛；它不是答案幻觉率。先扩展并切分作者标注集，再校准确定性来源接受策略。

## Answer

新增 `methodology-rag-v2`，保留 v1 文件不变。v2 有 34 条中文查询、2 个经登记的方法来源：校准集 16 条（8 可回答、2 模糊、6 范围外），留出集 18 条（6 可回答、6 模糊、6 范围外）；校准与留出查询家族不重叠。两篇来源都补有清楚标记为项目作者撰写的中文方法摘要，便于中文查询与英文论文片段进行词面核对。中文 BM25 改用 `Intl.Segmenter("zh-CN")` 分词。

方法来源使用确定性、来源级 gate：只对固定的 `transformers.js:q8:onnx-community/multilingual-e5-base-ONNX` 开放；来源至少一个片段的 cosine 必须 ≥ `0.812`，并且同一个满足相似度下限的片段必须覆盖至少 `0.5` 的去停用词查询项。校准集中相关来源的最低词项覆盖率为 `0.571`，不相关来源最高 `0.2`，模糊查询最高 `0.111`；范围外 cosine 最高 `0.8111`。未知或更换的 embedding 模型对方法语料 fail closed。未把 RRF 名次分数解释为概率，`player_report` 的候选姓名实体过滤保持原样。

`pnpm eval:methodology-rag` 输出版本、数据/语料计数、逐条信号及分 split 指标，不调用 LLM 或远程 embedding。当前固定数据回归结果：

- 校准集可回答证据覆盖 8/8，来源对 precision/recall 均为 1.0，无非相关来源对；范围外误接收 0/6；模糊查询 0/2 接收。
- 留出集可回答证据覆盖 6/6，来源对 precision/recall 均为 1.0，无 false abstention；范围外误接收 0/6；模糊查询 0/6 接收。两条仅支持部分论点的模糊查询也选择弃答。
- 当前本机索引 159 个方法片段、0 个球员报告片段、3 个登记来源，其中 2 个方法来源已人工标注。样本由项目作者挑选，不能解释为线上错误率或泛化保证。

用户选择的完整“数据仓库 → LangGraph → 报告”验收使用本机 FPL 2026/27 数据与 Qwen 3.5 9B：三轮同案对话、两次追问、10 名候选评估、6 次工具调用和 35 条进度事件；Reviewer 完成并生成报告，28/28 Harness 检查通过（105.777 秒，无 Planner fallback）。Agent 的方法查询按 gate 返回 0 个片段，报告继续生成且没有方法来源引用；空结果没有阻断球员数据流程，也没有产生未支持的论文引证。该单次运行验证链路契约，不验证球员排序准确性、答案忠实度或线上长期可靠性。

验证：`pnpm eval:methodology-rag` 通过；`pnpm test` 311/311；`pnpm build` 与 `pnpm build:web` 通过；真实 Qwen Harness 28/28 通过；最终 `git diff --check` 通过。
