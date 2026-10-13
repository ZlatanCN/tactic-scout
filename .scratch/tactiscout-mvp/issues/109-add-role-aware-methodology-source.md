# Add one role-aware methodology source and verify retrieval through the full Agent report

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Add the verified Forcher et al. (2022) open-access methodology source to TactiScout's permission-gated RAG, then prove the retrieved evidence can survive the real data warehouse → LangGraph → Reviewer → report workflow without weakening abstention.

## Acceptance criteria

- Register only DOI `10.3389/fpsyg.2022.813206` / PMCID `PMC9197445`; verify DOI and CC BY 4.0 metadata before any text retrieval, use the official PMC OAI-PMH full-text format only after that check, and respect the documented rate limit.
- Keep this source-specific and bounded: no bulk download, no unbounded Frontiers crawl, no source auto-discovery, and no raw player/match data ingestion.
- Exclude figures, tables, supplements, references, and independently credited third-party material from the indexed text; retain article/source attribution and a clear note that the original match data are not included.
- Provide a concise Chinese methodology summary clearly labeled as TactiScout-authored; it should distinguish positional role from individual style and state the source sample limits without turning the paper into a player score or ranking formula.
- Add a new immutable, author-labeled methodology benchmark version with separate calibration and held-out query families covering supported role/technical-performance questions, ambiguous queries, and out-of-scope recruitment decisions. Preserve v1/v2 and report per-class counts and source-level metrics.
- Keep the current relevance gate fail-closed; change its thresholds only with separate calibration and held-out evidence. Unknown embedding models continue to abstain.
- A real local-model scenario searches the authorized warehouse, calls LangGraph methodology retrieval, resumes the same case after material questions, evaluates candidates, passes Reviewer, and produces a report that cites only sources actually returned by the gate. If this paper is out of scope for the case query, zero-hit abstention remains valid.
- The full data warehouse → LangGraph → report Harness, methodology RAG CLI, relevant automated tests, API/Web build, and `git diff --check` pass; do not claim candidate-ranking accuracy.

## Context

- [Domain context](../../../CONTEXT.md)
- [Issue 107: source rights assessment](107-authorized-methodology-rag-expansion.md)
- [Issue 108: official metadata/access route](108-frontiers-official-article-access-route.md)
- [Permission-gated RAG ADR](../../../docs/adr/0002-permission-gated-scouting-corpora.md)
- [Methodology retrieval benchmark](105-methodology-rag-retrieval-benchmark.md)
- [Methodology abstention policy](106-methodology-rag-abstention-threshold.md)
- [Agent Harness](14-agent-harness-evaluation-suite.md)

## Answer

来源已登记为 `frontiers-positional-role-2022`，仅对应 DOI `10.3389/fpsyg.2022.813206` / PMCID `PMC9197445`。实现先核验 `pmc_fm` 的 `pmcid`、DOI 与 `ali:license_ref` CC BY 4.0，再请求该记录的 PMC `pmc` JATS。对真实响应的首次适配暴露了 PMC 使用 `pmcid`/`ali:license_ref` 而非初始 fixture 中简化字段；解析器和 fixture 已按官方数据格式修正。请求串行、间隔至少 400 ms，限制单文档响应大小，拒绝内部实体声明并移除外部 DOCTYPE 后再做不解析实体的提取。

正文入库只保留 `<body>`，另剔除 `<fig>`、`<table-wrap>`、`<supplementary-material>`、`<ref-list>`、脚注组与媒体/图形结构；归属字段保留文章作者、DOI、Frontiers 链接、CC BY 4.0 与说明。首次完整正文检查还扫描了主体内的 `third-party`、转载/授权、版权标记词，以及 `attrib`、`permissions`、`copyright-statement`、`license_ref` 标签：结构过滤前后均未发现相关标记。原 DFL/Deltatre 比赛数据不随论文入库。末尾追加清楚标记为 TactiScout 撰写的中文摘要，说明位置角色、个体风格、一季德甲与 13 名位置切换者样本的范围限制；不产生能力分或排名规则。

通过 `pnpm knowledge:crawl -- 10.3389/fpsyg.2022.813206` 从官方 PMC OAI-PMH 单篇路由获取并向本机忽略目录索引 54 个片段。包含三篇方法来源的本机索引现有 213 个方法片段；数据正文不进入 Git。

新增不可变 `methodology-rag-v3`（10 个项目作者标注查询、校准/留出各 5 条，分属独立 query families，覆盖三篇来源以及可回答、模糊、范围外问题）；v1/v2 数据文件未改。真实本机 multilingual E5 检索中，6/6 可回答问题都命中相关来源，留出来源对 precision 为 0.75（额外接受一个相关上下文来源）；范围外决策误接收 0/2；校准模糊题弃答，留出模糊题返回了被标为相关的角色上下文。方法 gate 未调整，仍要求 cosine ≥ 0.812 且同片段词项覆盖 ≥ 0.5，未知模型继续全部弃答。v2 也在现有 213 片段库重跑通过。

完整本地 Qwen 3.5 9B Harness 使用 TactiScout 自建 Wyscout 2017/18 快照：三轮对话、两次实质追问并恢复同一案件，6 次工具调用，评估 10 名候选，Reviewer 完成并生成报告，35 条进度事件；29/29 Harness 检查通过，用时 74.369 秒。拜仁案例的 Planner 方法查询按 gate 返回 0 个片段，报告没有方法引用；新增 Harness 检查确认报告方法引用只能来自本案实际返回的 gate 结果。此前 FPL 网络请求失败，因此该失败未计为成功，本次用已有历史快照完成整链验收。报告清楚标明历史赛季，结果不证明现役市场覆盖、排序准确性或长期可靠性。

验证：PMC provider 与 v3 基准定向检查 4/4；全套自动化测试 315/315；API 和 Web 生产构建通过；`eval:methodology-rag` 与 `eval:methodology-rag:v3` 通过；真实本机 Qwen Harness 29/29；`git diff --check` 通过。

