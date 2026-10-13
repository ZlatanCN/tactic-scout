# Connect American Soccer Analysis current MLS evidence to the LangGraph scout

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Use the public American Soccer Analysis (ASA) API as a current-season MLS candidate-and-performance source, then validate the complete natural-language case from repository retrieval through LangGraph report generation.

## Context

The initial ASA review confirmed that `season_name=2026` alone returned team IDs spanning more clubs than the current MLS directory. The official API supports `split_by_seasons` and `split_by_teams`; with both enabled, the 2026 MLS endpoints returned exactly one season, 30 resolvable teams, unique player-team rows, and no missing player/team IDs. The bounded live metadata audit is in [the current roster and performance review](../research/current-roster-and-performance-route-review-2026-10-06.md).

ASA's official endpoints expose xGoals, xPass and Goals Added (g+) for North American competitions. The source does not provide transfer availability, contract, budget or injury status, and its API response does not expose a last-updated match timestamp. Reports must use the retrieval time and season label without claiming data is real-time or a complete registered squad.

## Scope

- Add a separate `asa` `PlayerRepository` mode, limited to MLS and an explicitly requested season; default to the current calendar-year MLS season.
- Query xGoals, xPass and Goals Added with exact season and team/season split parameters; join only by exact ASA player and team IDs.
- Resolve names, birth dates and club labels from ASA's entity endpoints. Preserve unresolved team labels as unknown instead of guessing.
- Map only fields confirmed in live payloads. Keep source definitions, action types, units, sample minutes and acquisition time with every reportable metric; do not treat g+ as a general scouting score.
- Preserve the provider's coarse position groups; do not infer left/right roles. Missing samples and fields stay unavailable.
- Bound requests, response sizes, timeouts and in-process caching. Do not add bulk/background refresh.
- Connect the repository through the existing LangGraph tool loop and keep the source scope visible in the workbench and final report.
- Verify fixtures, repository query/pagination, evidence coverage and the full multi-turn LangGraph case with the local model. Keep recommendation-ranking accuracy explicitly unevaluated without independent scout labels.

## Acceptance criteria

- [x] Malformed rows, duplicate player-team-season identities, mismatched endpoint seasons and unresolved joins cannot become fabricated player facts.
- [x] ASA xGoals, xPass and g+ fields retain exact source semantics and metric-specific sample minutes; absent values never become zero.
- [x] Search filters, exact totals, pagination, profile-by-ID evaluation and peer comparisons work through `PlayerRepository`.
- [x] The LangGraph case can interpret a free-text MLS need, ask for materially missing role information, resume the same case, call tools, review evidence and produce a source-scoped report.
- [x] A real 2026 MLS API snapshot and local-model run verify the complete path; logs and evaluation output omit raw API payloads.
- [x] Source limitations, ASA attribution, current-season scope, and the distinction between Agent behavior and ranking quality are visible in documentation/UI.

## Research

- [ASA API and current-season response audit](../research/current-roster-and-performance-route-review-2026-10-06.md)
- [Recommendation-quality evaluation protocol](../research/scouting-recommendation-evaluation-protocol-2026-10-06.md)

## Comments

- 2026-10-06: The user selected end-to-end validation from data repository through LangGraph report. ASA live responses were checked without printing player names or performance values. With `season_name=2026`, `split_by_seasons=true`, `split_by_teams=true`, and `minimum_minutes=0`, xGoals returned 889 player-team rows, xPass returned 889, and g+ returned 833; each response reported only season 2026, 30 team IDs, and no missing player/team IDs. A prior unsplit response had 66 team IDs, confirming the split parameters are required for safe joins.
- 2026-10-06: The production ASA repository was refreshed directly and returned 889 exact player/team/season profiles for 2026 across 30 teams. The real `qwen3.5:9b` LangGraph run started with “为洛杉矶FC找一名能够增强进攻的球员”; it searched methodology, read/evaluated an initial broad sample, asked for a playing role, paused, resumed the same case after “找边锋，优先参与创造机会和进球”, paged and evaluated WG candidates, searched the approved player-report corpus, reviewed and produced a report. The harness passed all 14 behavior checks in one run (210.4 seconds): 889 source records, 165 WG matches, 57 candidate records read and 21 evaluated. No raw API payload or player names were emitted in the evaluation summary. This verifies workflow behavior and evidence/report contracts only; recommendation-ranking accuracy remains unevaluated because there are no independent scout labels.
- 2026-10-06: The live run exposed two harness defects and they were fixed: broad natural-language searches can no longer treat an unverified name (including a target-club name) as a player filter; an unspecified role now triggers one evidence-first clarification after initial evaluation. Existing historical-source integration fixtures were aligned with their actual coarse “defender” position data rather than claiming the source proved “full back”. The full deterministic suite passes (216/216); API TypeScript and web production builds pass.

## Answer

Implemented and end-to-end validated. ASA current-season profiles feed the existing LangGraph candidate tools and source-scoped report. The local Qwen harness passed every behavior check for a multi-turn run. The report preserves that the ASA pool is current MLS performance data, not a complete roster or transfer market, and does not make transfer-feasibility or ranking-accuracy claims.
