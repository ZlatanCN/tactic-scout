# Expand ASA's current-season evidence pool across supported North American leagues

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Expand the current ASA repository beyond MLS while keeping each competition, provider identity, season, and metric definition traceable. Validate the complete data-retrieval-to-LangGraph-report path.

## Scope

- Research official ASA competition support and verify live current-season xGoals, xPass, and Goals Added response coverage before admitting each league.
- Include only leagues with all required 2026 aggregate endpoints below the repository's 1,000-row completeness ceiling.
- Join records using competition-scoped player/team/season identities so equal upstream IDs from two competitions cannot merge.
- Allow search filters by supported league names and codes; reject unsupported league/season requests as source errors rather than empty results.
- Limit the product candidate pool to MLS, USL Championship, and USL League One; other ASA competitions stay outside the supported scope. [Issue 149](149-separate-usl-super-league-from-mens-candidate-pool.md) records the repository and report regression.
- Keep peer-percentile comparisons within the same competition, season, and position group. Disclose that raw values across competitions are not directly comparable.
- Update dataset scope, Agent source policies, user-facing provenance, the glossary, and README attribution.
- Run repository checks and a real LangGraph case through report generation with the broadened pool.

## Acceptance criteria

- [x] Official upstream documentation lists the relevant competitions and asks API-data users to credit/link to ASA.
- [x] Live 2026 xGoals, xPass, and Goals Added endpoints are verified for every admitted competition; any incomplete/over-limit competition is explicitly excluded.
- [x] Each statistical record is joined only inside its competition namespace, with missing metric families retained as missing.
- [x] League aliases filter only their matching records; an umbrella `USL` filter includes only the supported USL competitions.
- [x] Default ASA search and the full catalog expose only the three supported competitions; unsupported scopes fail before fetching.
- [x] Agent, report, and workbench preserve the exact observed competition scope and warn against raw cross-competition comparisons.
- [x] A real current ASA dataset traverses repository search, LangGraph clarification/resume, evaluation, review, and final report.
- [x] Recommendation-ranking accuracy remains explicitly unclaimed without independent scout labels.

## Research

- [ASA 2026 current North American competition coverage](../research/asa-current-north-america-coverage-2026-10-06.md)

## Comments

- 2026-10-06: Live 2026 xGoals responses returned 889 MLS, 410 NWSL, 666 USLC, 458 USL1, and 156 USLS player-team rows. The corresponding xPass counts were 889, 410, 666, 457, and 156; Goals Added counts were 833, 378, 610, 418, and 146. MLS Next Pro xGoals returned 1,097 rows, beyond the existing completeness ceiling, so it is excluded. These are endpoint row counts, not registered-roster counts or cross-league rankings.
- 2026-10-06: Repository fixtures verify competition-scoped player/team/season identities, unsupported scope failures, league and USL aliases, NWSL exclusion/inclusion behavior, same-competition comparison peers, and unavailable metric families remaining absent rather than zero. The live warehouse read returned 2,579 profiles: MLS 889, NWSL 410, USL1 458, USLC 666, and USLS 156; all 96 team IDs resolved, and every resulting player identity retained its competition namespace.
- 2026-10-06: A real Qwen 3.5 9B + LangGraph run traversed the current ASA warehouse, methodology/candidate tools, role clarification, same-case continuation, candidate evaluation, Reviewer, and final report. It passed all Harness checks in 234.9 seconds (44 progress events, 7 tool calls). The evidence Reviewer correctly returned no recommendations because the then-current “chance creation” mapping omitted ASA xA; this run demonstrates workflow completion, not that the mapping was adequate or that ranking quality was evaluated.
- 2026-10-06: A subsequent post-fix real-model retry stopped after ASA timed out while loading the candidate pool (100.3 seconds); the graph generated a source-failure report and did not misreport the timeout as an empty result. That retry did not pass the clarification/resume scenario. The separate deterministic suite passes 220/220; API and web production builds pass. Recommendation ranking remains unevaluated because no independent scout labels exist.
- 2026-10-11: Official-source review confirmed USL Super League is professional women's football. Earlier “four men's competitions” wording was incorrect; issue 149 adds the missing separation. The historical row counts and 2026-10-06 NWSL-only checks above remain records of that earlier run, not evidence that USL Super League was excluded.

## Answer

ASA now supplies a competition-scoped 2026 evidence pool for MLS, USL Championship, and USL League One. Default and full-catalog reads expose only these supported competitions; unsupported scopes fail before fetching. Reports preserve observed source coverage and within-competition comparison limits. An earlier live ASA dataset completed a real multi-turn LangGraph run and produced a report. One later attempt hit a bounded upstream timeout and correctly reported source failure. These runs validate the data-to-report behavior when the source responds; they do not establish recommendation accuracy or repeated-run reliability.
