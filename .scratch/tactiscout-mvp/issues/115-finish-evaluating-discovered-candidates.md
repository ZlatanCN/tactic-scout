# Finish evaluating candidates from an already-read page before concluding

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the LangGraph investigation use every eligible candidate it has already retrieved before the Planner chooses to conclude or fetch another page. Keep candidate evaluation bounded to batches of ten and preserve the existing source cursor, user filters, and tool budgets.

## Observed gap

The 2026-10-09 mosaic → LangGraph → Reviewer → report run read a candidate page containing 20 players, but the graph evaluated 10, retrieved reports for those 10, and then allowed the Planner to finish. The other 10 candidates were already in the retrieved page but never assessed. The report correctly disclosed 10 evaluated players, yet the graph did not use all evidence it had paid to fetch.

## Acceptance criteria

- [x] Through `createRecruitmentConversation`, when a retrieved page yields more than ten eligible unevaluated candidates, evaluate the remaining candidates in subsequent batches before calling the Planner to expand or finish.
- [x] Attempt player-report retrieval for each evaluated batch before evaluating the next batch or returning to the Planner; preserve whether retrieval succeeded, returned zero results, or failed.
- [x] Never evaluate candidates outside the latest user-confirmed constraints. A newly confirmed position is searched before evaluating candidates from an earlier broad page. If the evaluation budget is exhausted, the report states discovered, evaluated, and unevaluated counts.
- [x] Preserve exact pagination, position confirmation, cancellation, and report evidence invariants.
- [x] The real local mosaic Harness reaches Reviewer and a report without a premature finish; the report labels its sample limits and makes no ranking-accuracy claim.

## Interface under verification

The user selected the full warehouse → LangGraph report chain as the acceptance interface. Deterministic graph verification should use the public `createRecruitmentConversation` seam; live-model acceptance should use `pnpm eval:local-agent -- --scenario bayern-kane-replacement`.

## Answer

The graph now drains eligible discovered candidates in batches of up to ten. After each batch, it retrieves reports for those players before starting the next batch or returning to the Planner. When a user confirms a specific position after a broader search, the case searches that position from its recorded first page before evaluating candidates under the new scope. If the per-turn evaluation budget leaves candidates unassessed, the final report includes the discovered, evaluated, and unevaluated counts.

The Harness evaluator now accepts a broader attacking-position search when the user approves it after either an empty confirmed-position result or an observed nonempty sample; recommendations must match the approved broader position.

Validation:

- Five focused LangGraph conversation checks passed, covering complete 20-player page evaluation, per-batch report retrieval, role confirmation, exact-position search ordering, and empty-position handling.
- Two focused Harness evaluator checks passed for empty-position and user-approved nonempty-position expansion.
- `pnpm build` passed.
- The live mosaic → LangGraph → Reviewer → report scenario passed 1/1 with the local Qwen model. It used two user clarifications, 14 tool calls, and 68 progress events. The report disclosed 53 discovered candidates, 50 evaluated, and 3 unevaluated at the per-turn budget boundary; this run does not validate full-pool coverage or recommendation ranking accuracy.

## Comments

- 2026-10-09: The full-chain acceptance initially exposed two related gaps: role clarification could evaluate matches from an older broad page without querying the confirmed position, and the Harness only accepted expansion after a zero-match result. Both flows now preserve the confirmed scope and explicit user consent.
- 2026-10-09: Regression coverage now drains a 21-candidate fixture in `[10, 10, 1]` batches and confirms report-search budget exhaustion does not block evaluating already-discovered candidates. The clean full suite passes 330/330.
