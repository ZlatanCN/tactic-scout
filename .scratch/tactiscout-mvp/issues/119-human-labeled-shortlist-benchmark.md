# Build a human-labeled shortlist quality benchmark

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Prepare a reproducible way to evaluate candidate ordering against human football-fit judgments without treating model output, public statistics, or unjudged candidates as ground truth.

## Scope

- Accept a frozen query, candidate pool, data snapshot identity, system rankings, independent reviewer judgments, and adjudicated labels.
- Use the project's 0–3 fit rubric plus `unknown`; `unknown` and unjudged candidates must never become grade zero.
- Compute per-query nDCG@5 only when every candidate in the evaluation pool has two independent judgments and a resolved adjudicated grade.
- Report raw reviewer agreement separately from ranking metrics; do not call it reliability or accuracy proof.
- Return `not_evaluable` with explicit reasons when metadata or human labels are incomplete.
- Do not create candidate judgments or claim ranking quality in this implementation. Human labels remain future input.

## Acceptance criteria

- [x] The dataset schema pins source, snapshot ID, as-of time and content hash; query/candidate/ranking IDs are stable and unique.
- [x] Ratings are constrained to 0–3 or `unknown`; adjudicated grades are separate from individual judgments.
- [x] Cross-reference validation rejects duplicate judgments, unknown query/candidate references, and malformed ranking runs.
- [x] nDCG@5 uses graded gain and discounts, is computed per query and system, and is suppressed for incomplete/unknown pools.
- [x] The output reports independent-judgment coverage and raw pairwise agreement separately.
- [x] A local CLI validates an evaluation JSON file and prints a `not_evaluable` result for an empty template rather than a zero score.
- [x] Deterministic tests cover metric math, disagreement, unjudged candidates, and the no-label case.
- [x] The evaluation guide and domain glossary explain that this benchmark is scenario-specific, not a universal scout truth.

## Design

Expose one pure module interface, `evaluateShortlistQuality(input)`, that validates and evaluates a complete snapshot. Keep candidate judgment collection independent from LangGraph traces: reviewers must not see system identity, rank, or model rationale. No source provider is called by the evaluator.

The evaluator is deliberately a separate acceptance layer from the warehouse-to-report LangGraph Harness. Current public reports contain only the final recommendation shortlist, while privacy-safe tool traces retain candidate IDs and evaluation IDs but omit the evidence-card values. They are not sufficient by themselves to create a blinded review packet for the complete candidate pool. Before collecting labels, a separate export step must pin the actual warehouse snapshot and emit source-grounded candidate evidence cards plus a hidden key that maps cards back to candidate IDs and system rankings. Never reconstruct missing candidates or metrics from report prose.

## Research

- [Recommendation evaluation protocol](../research/scouting-recommendation-evaluation-protocol-2026-10-06.md): frozen snapshots, pooled candidates, blind double ratings, `unknown`, adjudication, and per-query nDCG@5.
- [Public scout-judgment dataset audit](../research/public-scout-judgment-dataset-search-2026-10-11.md): screened open scout ratings and youth-player ranking studies; none provides reusable query-specific professional transfer shortlist judgments with verified rights.
- [Domain glossary](../../../CONTEXT.md): human fit judgments are scenario-bound and distinct from statistical performance.

## Answer

已实现纯函数 `evaluateShortlistQuality(input)`、本地 JSON CLI、空评审模板、确定性测试以及评测说明和术语表。评测器分别报告双人评分覆盖、裁决覆盖、原始成对一致率和每个 query/system 的 nDCG@5；任何候选未双评、裁决未解决、快照元数据缺失或全池裁决为 0 时都不计算 nDCG。模板当前没有人工标签，CLI 如实返回 `not_evaluable`，项目没有虚构推荐质量分数。

快照 SHA-256 当前校验字段格式和登记值是否存在；不会读取或重算数据仓库文件。真实快照固定、证据卡匿名导出和文件哈希核对属于后续 [issue 120](120-export-blinded-shortlist-review-packets.md)，避免用报告文字反推遗漏的候选或指标。

验证：`node --import tsx --test tests/shortlist-quality-evaluation.test.ts` 9/9 通过；`pnpm eval:shortlist-quality` 对空模板返回 `not_evaluable`；完整测试 330/330 通过，`pnpm build`、`pnpm build:web` 和 `git diff --check` 通过。

## Comments

- 2026-10-10: Follow-up research found that unknown/unknown pairs should not be allowed to inflate numeric-grade agreement. [Issue 124](124-close-the-human-shortlist-evaluation-loop.md) adds separate numeric-grade and unknown-pair reporting while preserving the original categorical agreement for historical comparability.
- 2026-10-09：当前 Agent Harness 能证明工具编排、同案追问、数据边界和报告契约；项目没有可信球探适配标签，因此不报告排序准确率。本 issue 只补可复算接口，不制造“金标准”。
- 2026-10-09：实现已完成并通过离线验证。完整仓库→多轮 LangGraph→Reviewer→报告另由 [issue 14](14-agent-harness-evaluation-suite.md) 验收；单次链路通过不构成候选排序质量证据。
- 2026-10-09：冻结快照的实际文件哈希与匿名评审包导出已由 [issue 120](120-export-blinded-shortlist-review-packets.md) 完成；基准仍无人工标签，故当前保持 `not_evaluable`。
- 2026-10-11：公开标签审计补查了 Scoutium 人工属性评分、83 名瑞士青训球探排序研究和 2026 年职业青训 rubric 研究。它们可帮助设计观察维度或分歧说明，但没有可复算的成年职业转会 query-specific qrels；未核实的数据许可不进入系统。继续保持 `not_evaluable`，质量评测下一步需要冻结真实需求/候选池并收集双人盲评与裁决。[完整审计](../research/public-scout-judgment-dataset-search-2026-10-11.md)
- 2026-10-12：补查历史跨赛季表现预测作为公开人工 qrels 的替代线索。StatsBomb 2020/21 La Liga 比赛清单是稀疏选赛样本，连续赛季目录不能证明完整覆盖；多年下载会加入样本选择偏差。该路线不用于短名单质量验收，保持 `not_evaluable`，仍需冻结候选池并收集双人盲评与裁决。[补充审计](../research/historical-next-season-performance-proxy-benchmark-2026-10-12.md)
- 2026-10-12：对公开球探标签审计作来源级修正：Scoutium 的两个 Kaggle 上传包字段与许可不同，不能再把镜像字段拼成同一套数据；Groningen 调查中的 rank 是球探排列自报属性，PlayeRank 专家配对来自算法自身排序且只公开聚合一致率。均不满足 TactiScout 转会需求短名单 qrels。决策不变：不引入外部标签，空标签集保持 `not_evaluable`。[增量审计](../research/public-scout-judgment-dataset-search-2026-10-11.md#2026-10-12-增量核验)
