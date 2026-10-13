# Add a provenance-aware TheSportsDB roster enrichment

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Use TheSportsDB as an optional, clearly incomplete club-roster context source alongside the existing player-performance repositories. Keep it separate from candidate discovery, capability evidence, ranking, and model input.

## Why now

The map already approved one provenance-bearing roster-enrichment spike. Current FPL, Understat, and ASA sources provide useful performance pools but cannot verify a target club's complete squad. TheSportsDB offers official team-search and team-player endpoints; its free developer API limits player lists to 10 results, so a free response must never be described as a full squad. Its published terms permit copying and modifying official API endpoint responses for development projects and require a paid subscription for app-store publication; they do not settle model processing. See [the prior source review](../research/additional-player-data-options-2026-10.md).

## Scope

- Use only official TheSportsDB API endpoints: exact team search followed by the matching team's player-list endpoint. Do not scrape the website, request images, or query statistics/contracts/market values.
- Keep API credentials server-side. Local development may use the documented developer key; a public app must require the appropriate paid credential. No subscription or external account purchase is part of this ticket.
- Preserve provider team/player IDs, source URLs, retrieval time, returned count, and the known free-tier result cap. Mark the roster sample partial; no membership row proves current registration or availability.
- Run enrichment after the LangGraph report/review as an independent sidecar. Do not add its rows to Planner history, candidate search, scoring, recommendation order, checkpoint state, or saved localStorage report snapshots.
- Render names and source attribution without portraits, badges, or unlicensed artwork. Explicitly label unavailable, ambiguous, empty, and partial results separately.
- Keep the request opt-in and bounded. Network, timeout, parse, and rate-limit failures must not look like an empty team.

## Acceptance criteria

- [x] A deep server-side client exposes one team-name lookup operation and hides endpoint sequencing, response parsing, timeout, and provider error classification.
- [x] Only one exact team match is accepted; zero/multiple exact matches and source failures remain distinguishable.
- [x] The returned roster context keeps source identity and retrieval metadata, omits artwork and performance claims, and reports the free-tier 10-row cap as partial coverage.
- [x] The API progress timeline records a distinct post-review lookup stage; the lookup remains outside LangGraph state and never sends roster rows to the Planner or alters candidate evaluation/recommendations.
- [x] The browser displays the sidecar separately with TheSportsDB attribution; saving a plan does not persist these source rows.
- [x] A bounded live developer-key smoke verifies the current endpoint response shape; it does not write player rows to disk.
- [x] API/Web production builds and the user-selected warehouse-to-LangGraph-report Harness pass.
- [x] `CONTEXT.md`, the map, and an ADR record the new source category and its non-authoritative/use limitations.

## Research basis

- [TheSportsDB official API docs](https://www.thesportsdb.com/documentation)
- [TheSportsDB current terms](https://www.thesportsdb.com/docs_terms_of_use.php)
- [TheSportsDB current pricing](https://www.thesportsdb.com/docs_pricing)
- [Prior source comparison and field boundary](../research/additional-player-data-options-2026-10.md)
- [Layered player evidence](39-layered-player-evidence.md)

## Answer

Implemented the server-side lookup, exact-name matching, bounded parsing, timeout/error classification, ephemeral response contract, and separate browser panel. The source is disabled by default; local API credentials are configured only on the server. The lookup runs after a completed report and does not enter LangGraph state, the saved report, or the Planner.

The user selected the complete warehouse-to-LangGraph-report acceptance interface. On 2026-10-09, the curated local Wyscout 2017/18 warehouse → Qwen/LangGraph three-turn conversation (two follow-up answers) → candidate evaluation → Reviewer → report Harness passed 28/28 checks in 122.864 seconds. API and Web production builds and `git diff --check` also pass. The authorized cancellation contract was separately verified across HTTP, LangGraph runtime and same-case queue release (3/3 targeted checks).

The bounded live smoke passed on 2026-10-09 using TheSportsDB's documented free developer key. The official team search returned one exact Bayern Munich record (provider team ID `133664`); the official team-player endpoint returned ten player rows. The adapter reported `partial`, `returnedCount=10`, `resultLimit=10`, and `possiblyTruncated=true`. The flow made only the two expected GET requests, printed summary metadata only, and wrote no player rows to disk. This verifies the current v1 response shape, not current squad registration, roster completeness, freshness, or permission to process/store/display individual rows in a public app.

The current official documentation describes key `123` as the free developer key, limits free team search to one result and free team-player lookup to ten rows. Terms updated 2026-09-17 permit use of official API responses for development projects and say app-store publication requires a paid subscription; this does not establish model-processing or third-party data rights. The app remains disabled by default and its roster sidecar stays outside Planner, scoring, and saved reports.

API and web builds and the user-selected warehouse-to-LangGraph-report Harness had already passed before the live smoke; the smoke adds no application code. The issue is resolved with the response-shape acceptance complete and the product limitations retained.

## Comments

- 2026-10-13: Follow-up scope audit found that TheSportsDB includes `strSport` and `strGender` on official team/player response examples. The sidecar now displays only records explicitly marked Soccer + Male; teams without both values are rejected before the roster request. See [issue 185](185-enforce-mens-soccer-roster-scope.md).
- 2026-10-09：使用官方文档公布的免费开发 key 完成两请求 live smoke：Bayern Munich 精确匹配到 provider ID 133664，球队球员端点返回 10/10 且被标记为 partial/possibly truncated。只输出覆盖摘要、未落盘球员行。官方条款区分开发用途与公开 app 订阅要求；本次不验证球员数据的模型处理、持久保存或公开展示许可。
