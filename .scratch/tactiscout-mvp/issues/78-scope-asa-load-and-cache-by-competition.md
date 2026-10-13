# Load and cache ASA data by the requested competition scope

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Avoid loading unrelated ASA competitions for a candidate query and preserve successfully loaded league data when another league request fails.

## Context

The ASA provider currently loads all five admitted competitions sequentially for every operation. The default men's search therefore fetches NWSL before applying the men's-only filter, and one transient timeout discards the entire aggregate load promise. A live Qwen run spent 100 seconds in candidate search before reporting a source timeout.

## Scope

- Cache independently by `(competition, current season)` with the existing TTL and bounded failure cooldowns.
- Candidate search loads only the explicitly requested league/group; the canonical unqualified product scope is MLS, USL Championship, and USL League One. Unsupported competitions fail before fetching; [issue 149](149-separate-usl-super-league-from-mens-candidate-pool.md) records this regression boundary.
- Profile-by-ID and peer comparisons reuse only the required competition caches; peer populations remain exact competition/season/position.
- Full-catalog loads and explicit team inspection retain their complete supported scope.
- A partial failure remains a source failure for that query. Previously completed competition caches remain usable for a later retry; no partial pool is presented as complete.

## Acceptance criteria

- [x] Existing full-catalog coverage and explicit refresh behavior remain intact.
- [x] Default search loads only supported competitions; the `USL` group loads only USL Championship and USL League One.
- [x] Candidate-by-ID and peer-comparison reads do not refetch unrelated competitions.
- [x] A failed league does not evict prior successful league caches; retry after cooldown reloads only the failed and not-yet-loaded leagues.
- [x] Existing ASA identity, metric availability, alias and scope boundaries remain unchanged.
- [x] Full tests and API/Web production builds pass.

## Comments

- 2026-10-06: Reproduced the long-path outcome with a real ASA query: request exceeded the configured transport timeout, and LangGraph correctly returned a source-failure report. The previous full-catalog Qwen run passed the multi-turn Harness once; this issue addresses query cost and retry reuse, not recommendation-ranking accuracy.
- 2026-10-06: Implemented per-competition/current-season promise caches, scope-specific loading, and exact-competition profile/peer reads. A synthetic one-time USL1 HTTP failure test confirms MLS/USLC responses remain cached and the post-cooldown retry loads only the failed and subsequent required leagues. Cross-midnight query test preserves one season/retrieval timestamp. Full suite: 225/225; API and web production builds pass.
- 2026-10-11: Scope audit found the prior default-scope assertions only checked for NWSL requests. USL Super League is also a women's competition and remained in the men's default group; issue 149 adds that missing boundary and regression coverage.

## Answer

ASA candidate operations now load only the requested supported competitions and keep successful league results independently cached. Candidate evaluation and percentile peers reuse only the candidate's exact competition cache; full-catalog reads expose only the three product competitions. Cooldown retries reuse completed leagues without representing an incomplete aggregate as a successful full result.
