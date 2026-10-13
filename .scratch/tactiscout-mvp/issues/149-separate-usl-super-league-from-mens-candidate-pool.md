# Keep ASA candidates within the men's product scope

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

TactiScout is a men's football scouting product. Its ASA and mosaic candidate paths must contain only the supported men's competitions. The original adapter included out-of-scope competitions in the default catalog, generic `USL` group, and user-facing scope descriptions.

The supported allowlist and affected paths are recorded in [the ASA supported-scope audit](../research/asa-supported-competition-scope-2026-10-11.md).

## Proposed behavior

- ASA candidate and full-catalog reads support only MLS, USL Championship, and USL League One. Default search, `loadPlayers()`, and `loadMenPlayers()` never request or return other competitions.
- The unqualified `USL` search resolves only to USL Championship and USL League One. Requests for unsupported competitions fail with `unsupported_scope` before any network request.
- Mosaic accepts only its supported Understat leagues and the three ASA competitions above; unsupported ASA records never enter the combined pool.
- Dataset scope, Planner instructions, age-scope validation, reports, and data-source docs expose only the supported competitions; unsupported competitions cannot enter search or final reports.
- Preserve competition-scoped identities, metrics, and peer comparisons.

## Confirmed scope and public test seams

Verify public behavior through `AmericanSoccerAnalysisPlayerRepository.searchCandidates()` and `loadPlayers()` / `loadMenPlayers()`, `MultiSourceCurrentPlayerRepository.loadPlayers()`, and `createRecruitmentConversation()` for a data-to-report regression. Tests cover default and USL retrieval, unsupported-scope rejection without network access, mosaic filtering, and a final report containing only supported competitions.

## Acceptance criteria

- [x] ASA default and full-catalog reads contain only MLS, USL Championship, and USL League One; unsupported competitions are rejected before fetching.
- [x] The `USL` shorthand returns only USL Championship and USL League One.
- [x] Mosaic accepts only its supported Understat leagues and the three ASA competitions above.
- [x] Planner instructions, age filters, reports, source docs, and issues 76/78/99 expose only the supported competitions.
- [x] Public repository seams and the LangGraph data-to-report path verify unsupported records cannot appear in the final report.

## References

- [ASA current North American coverage](76-asa-current-north-america-coverage.md)
- [Issue 76: ASA current North American coverage](76-asa-current-north-america-coverage.md)
- [Issue 78: ASA scope-specific load and cache](78-scope-asa-load-and-cache-by-competition.md)
- [Issue 99: multi-source current performance pool](99-multi-source-current-performance-pool.md)

## Answer

ASA's full catalog and default search now load only the three supported competitions. The `USL` alias resolves to USL Championship and USL League One, while unsupported ASA records are rejected or filtered from mosaic before search and report generation. Planner instructions, dataset scope, report caveats, and source documentation use the same boundary.

Verification: 383 tests passed; `pnpm build` and `pnpm build:web` passed. Targeted regression coverage includes ASA's public search/full-catalog interfaces, mosaic filtering and age-scope behavior, ASA prompt scope, and a full deterministic LangGraph report using supported and out-of-scope source fixtures.
