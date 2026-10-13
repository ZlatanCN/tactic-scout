# Find a new current player source for wider scouting coverage

Type: research
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Question

Which genuinely unassessed public or open football data route can expand TactiScout's current-season candidate pool or tactical performance evidence beyond the integrated FPL, Pulselive, Understat and ASA sources, while supporting a reproducible local Agent and a public portfolio demo?

## Acceptance criteria

- Audit the existing source matrix and linked research first; do not repackage a prior no-go as a new discovery.
- Compare at least three genuinely unassessed routes using primary sources: source-owned catalogs/API documentation, repository licenses, data terms and freshness/update statements.
- Prefer sources that add geographical or competition coverage not already present, with player identity, team, season, position, minutes and useful ability metrics. Separate a roster from an appearance/statistics pool.
- Assess current-season availability, source identifiers, pagination/coverage, freshness evidence, request/authentication limits, price, caching/retention, derived analysis, local LLM/RAG and public portfolio display separately. Mark unsupported claims and unknown rights as unknown.
- Do not scrape around access controls, call gated APIs, collect/retain player-level data, or add a provider during this research. A technically readable endpoint alone is not a source admission.
- Recommend one concrete next action: an implementable route with verified usage boundaries, a bounded no-model smoke after obtaining required access, an owner-led permission request, or a reasoned no-go.
- Write one cited report under `.scratch/tactiscout-mvp/research/` and link it here.

## Context

- [Domain model](../../../CONTEXT.md)
- [Layered player evidence and source matrix](39-layered-player-evidence.md)
- [Current multi-source player pool](99-multi-source-current-performance-pool.md)
- [Current source expansion research](../research/current-player-source-expansion-2026-10-09.md)
- [Current-source route selection](../research/current-player-source-next-route-2026-10-09.md)
- [Source admission matrix](../research/player-evidence-source-admission-matrix-2026-10-08.md)
- [Latest current-source sweep](../research/current-player-source-sweep-2026-10-08.md)

## Comments

- 2026-10-09：代码检查确认外部 seam 是 `PlayerRepository`，LangGraph 可按需搜索、检查球队、按来源 ID 读取评估档案和获取同来源/赛事/赛季/位置比较组；`mosaic` 模式已处理多源分页轮转与来源失败。新增来源需能真实满足这些查询并保留原生 `sourceIdentity`，不能只因统计字段更多就进入 Agent。

## Answer

本轮未找到可以准入的新来源。xG Stat 有 2026/27 五大联赛指标，但其条款禁止自动提取和站外发布；Eredivisie 的公开统计页未证明当季完整球员池/API，且条款禁止自动采集；阿根廷 LPF Data 当季报告是球队汇总，没有球员行。TheStatsAPI 和 StatPal 虽有付费 API 主张，但目标赛季覆盖、schema/完整池及本机留存、Ollama/RAG、派生报告和公开展示权利仍未核清。建议暂不接入；若要扩池，先向来源方索取目标赛事数据契约和书面用途许可，再决定是否做有界 smoke。详见[来源对比与准入建议](../research/current-player-source-routes-2026-10-09.md)。

以用户选定的“数据仓库 → LangGraph → 报告”作为项目验收接口；最近一次当前 FPL 完整链路运行已在 [issue 14](14-agent-harness-evaluation-suite.md) 记录为 29/29 Harness 检查通过。该运行证明工作流契约，不证明新增来源可用、推荐排序准确性或长期可靠性。

### Resolution comment — 2026-10-09

Reviewed the cited official pages and terms. No candidate passed the repository shape, current-season evidence, and usage-rights gates together. No API was called, no player rows were collected, and no provider was added. Keep the current FPL/Understat/ASA paths and continue improving the full LangGraph conversation and report chain. Revisit a new source only after a concrete feed/schema and the intended storage, local-model/RAG, derived-report, and public-display rights are established.
