# Keep candidate-search control facts in structured LangGraph state

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make structured case state authoritative for candidate-search routing, paging, and sample coverage. Planner history remains a model-facing projection and must not be reparsed to reconstruct control facts.

## Accepted verification seam

- `createRecruitmentConversation` end-to-end, from an injected player repository through LangGraph investigation and the final report.
- Cover exact next-page cursor/filter preservation, a position clarification that depends on a prior matching count, and report coverage across the pages actually read.

## Acceptance criteria

- [x] Each successful candidate search records the structured request and actual page outcome in the case state, including applied filters, actual offset, next offset, matching-count known/unknown state, and discovered source-record IDs.
- [x] Expansion routing and exact-page constraints read the structured search record rather than parsing tool history JSON.
- [x] Position-change clarification and report sample coverage use the same structured observations; unknown match counts remain unknown.
- [x] Failed candidate searches remain distinct from successful zero-match searches and do not enter successful-page coverage.
- [x] Planner-facing history still contains the context needed to decide and explain the next investigation action.
- [x] Existing LangGraph behavior, user-visible report scope, and ADR 0005 adaptive expansion semantics remain intact.
- [x] Focused end-to-end regressions, API typecheck, and `git diff --check` pass.

## Design constraint

Avoid duplicating authority among a new ledger, `searchScopes`, `candidateSearchCursors`, and `discoveredPlayers`. Remove or derive the overlapping state once the structured record is authoritative. Keep the public full-conversation seam as the test surface.

## Answer

Successful candidate searches now append structured observations to LangGraph state. Pagination, role-clarification reuse, report scope, and sample coverage read those observations; Planner history remains a cloned model-facing projection. Confirmed-position completion and matching count resolve through an observation index instead of duplicated state. Coverage uses explicit source-record wording, and a remaining page is disclosed even when the provider's matching total is unknown. An approved position expansion can continue from its exact earlier observation after a user turn boundary.

Verification: the full suite passed 424/424, `pnpm build`, `pnpm build:web`, and `git diff --check` passed.

## Comments

- 2026-10-13: Architecture scan found that `latestCandidatePageNextOffset`, `latestCandidatePageAction`, `matchingRecordsForCandidateSearchIntent`, and `candidateSearchSampleCoverage` reconstruct search facts from serialized Planner history even though the LangGraph state already stores related candidate and cursor data. This issue targets the correctness seam, not file size or a mechanical split.
- 2026-10-13: Review findings addressed: derive confirmed-position status/count from a ledger reference, name coverage as source-record count, disclose an unread cursor when matching totals are unknown, and retain an approved expansion cursor across a resumed turn.
- 2026-10-13: Resolved after the full test suite (424/424), API/Web builds, and diff check passed.
