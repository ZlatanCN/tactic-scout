# 01 · Validate and commit completed workflow results

Status: resolved
Label: ready-for-agent

## Goal

Define full Zod result contracts in the owning player-data/team-data modules, centralize JSON decoders, tighten `TurnOutcome`, and ensure lookup, comparison, player recommendation, and team recommendation each commit only a fully validated completed result. Add the comparison result to its independent successful snapshot. Preserve completed data when answer generation fails.

## Acceptance

- Result decoders reject missing fields, invalid statuses, workflow/status mismatches, and malformed JSON.
- Valid empty results remain completed results.
- A failed/clarification result does not replace the prior success snapshot.
- Snapshot and successful outcome are returned together before explanation.
- Explanation failures preserve the committed result.

## Answer

Added complete source-owned schemas for lookup, comparison, player recommendation, and team recommendation results. Nodes now normalize and validate result JSON before committing it; `activeComparison` stores its completed result, and `TurnOutcome` constrains workflow statuses and marks completed data as `executed` or `saved`. Valid empty comparison and recommendation results remain successful. Explanation retries leave completed outcomes intact.

## Comments

- 2026-10-30: Resolved. Focused graph tests and result-contract tests pass.
- 2026-10-30: Review follow-ups: a search-limit outcome no longer replaces the previous lookup snapshot or focus; completed comparisons reject source-unavailable empty results and inconsistent coverage counts; recommendation status must agree with candidate presence; team roster coverage totals and lookup source/status pairs are checked.
