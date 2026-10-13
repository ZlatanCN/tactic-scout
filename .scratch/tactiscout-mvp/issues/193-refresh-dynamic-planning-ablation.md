# Refresh the dynamic-planning ablation after intent guards

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Re-run the existing dynamic-planner versus frozen single-pass workflow comparison against the current LangGraph after candidate-intent and freshness guards changed the shared graph.

## Experimental protocol

- Keep issue 143's frozen, case-independent single-page control, registered inputs/answers, same graph, tool/retrieval budgets, Reviewer, and final synthesis.
- Use only the curated Wyscout 2017/18 snapshot and the already configured loopback Qwen 3.5 9B endpoint; do not use Understat or make source/API requests.
- Run three counterbalanced pairs for `barcelona-under-23-midfielder` and three for `bayern-kane-replacement`, separately, against the same current snapshot hash.
- Keep raw outputs/traces and identities in Git-ignored `.data/evaluations/`; report pair-level Harness outcomes, Planner/model use, tools, scope/clarification behavior, evaluated samples and recommendation/report observations without treating them as quality labels.
- Inspect every failed Harness check. If failures reveal a deterministic shared-graph defect, create a separate issue and only change behavior through the previously agreed full-graph/Harness seams; do not tune the baseline after observing paired outcomes.

## Acceptance criteria

- [x] Snapshot hash and model endpoint locality are recorded without exposing secrets or candidate identities.
- [x] Three counterbalanced pairs complete for each registered scenario, or any interrupted/failed runs are explicitly retained and labeled rather than silently dropped.
- [x] Results distinguish model dispatches from provider-reported usage and identify gaps in usage reporting.
- [x] Any run-to-run failures and shared downstream gates are analyzed; no pass-rate or recommendation-count claim is presented as recommendation quality.
- [x] `docs/evaluation.md`, this issue, and the map reflect the current run and all material limitations.
- [x] Raw identity-bearing artifacts remain local and ignored by Git.

## Context

- [Prior protocol and results](143-dynamic-investigation-planner-ablation.md)
- [Current LangGraph decision](../../../docs/adr/0010-langgraph-stategraph-for-recruitment-cases.md)
- [Candidate-intent freshness mechanisms](182-ablate-current-turn-search-freshness.md)

## Comments

- 2026-10-13: Revalidation is warranted because the original paired run predates the current-turn candidate-intent and freshness guards. Both mechanisms can force graph actions in both arms, so the original comparison does not show how the current shared graph behaves under the frozen baseline.
- 2026-10-13: Three counterbalanced pairs per scenario completed on Qwen 3.5 9B with provider-reported token usage complete on all requests and the original snapshot SHA-256 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`. Barcelona passed 3/3 in both arms (31 checks/run); adaptive averaged 3 Planner requests and 3 recommendations, single-pass 1 request and 1 recommendation, while each evaluated 20 candidates with 6 tool calls. Bayern completed 2 clarifications and 19 candidate evaluations in every run; adaptive produced 3 recommendations with 5 Planner requests, single-pass 1 recommendation with 3. Its turn 1 ATT query, turn 2 confirmed ST zero-match query, and post-consent turn 3 ATT page-zero query form distinct search rounds. The prior evaluator incorrectly merged same-filter observations across turns. The approved evaluator regression was tracked in [issue 194](194-resume-approved-broader-search-cursor.md); the graph search policy stayed unchanged.

## Answer

The evaluator now validates an approved fresh broader-search sequence beginning at `offset: 0`, while retaining the whole-history exact-cursor continuation check. The LangGraph graph and search behavior were not changed. After the regression went red on the confirmed `evaluateLocalAgentScenario` seam, the focused evaluator suite passed 45/45; the full suite passed 442/442 with loopback permission; API and Web builds passed.

On 2026-10-13, three counterbalanced pairs per scenario were retained against the same local Wyscout 2017/18 snapshot and loopback-only Qwen 3.5 9B; no remote football source or model endpoint was used. Both Barcelona arms passed 3/3 (31/31 checks); both Bayern arms passed 3/3 (29/29). Barcelona evaluated 20 candidates and made 6 tool calls per run; adaptive averaged 3 Planner requests and returned 3 recommendations, while single-pass averaged 1 and returned 1. Bayern completed two clarifications and evaluated 19 candidates in each run; both arms made 8 tool calls, while adaptive averaged 5 Planner requests and returned 3 recommendations, and single-pass averaged 3 and returned 1. Provider usage covered every Planner request. Recommendation count and Harness pass rate are not ranking-quality measures; the report still has explicit missing capability evidence. The de-identified aggregates are in [`docs/evaluation.md`](../../../docs/evaluation.md#动态调查规划消融); raw logs and candidate identities remain in ignored `.data/evaluations/`.
