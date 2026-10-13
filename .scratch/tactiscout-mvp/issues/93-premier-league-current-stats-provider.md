# Add the current Premier League performance repository

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Expose the Premier League's observed 2026/27 performance pool through the existing `PlayerRepository` seam, then verify it through the complete LangGraph recruitment conversation and reviewed report.

## Scope

- Read the Premier League season leaderboard and enrich age only by exact same-source player ID from same-season club squads.
- Keep the pool restricted to measured Premier League appearance records; do not claim a complete transfer market or registered squad.
- Map only fields observed in the live response and retain source field, season, sample minutes, retrieval time, and broad source position.
- Use bounded pagination, response sizes, timeouts, same-origin cursor validation, cache, and sanitized failures. Stop on access denial or rate limiting.
- Preserve missing metrics as unavailable. Do not rename forward passes to progressive passes or invent xG, assists, contract, injury, budget, or availability data.
- Wire the mode through the existing LangGraph conversation, source scope, reports, UI status, and environment documentation. Keep the default source unchanged.

## Acceptance criteria

- [x] Fixture tests verify measured field mapping, exact-ID age joins, missing values, bounded pagination and cursor rejection, caching, rate-limit behavior, repository filtering, and source scope.
- [x] `PlayerRepository` search/pagination and same-source age enrichment work without a full-catalog fallback in application code.
- [x] The natural-language LangGraph conversation completes through reviewed report against live current-season data, including clarification and same-case resume.
- [x] The report and UI name the source and accurately state the one-league performance-pool boundary.
- [x] API and web builds, targeted tests, full test suite, and `git diff --check` pass.

## Comments

- 2026-10-13: Runtime review found that the provider's automated access, database creation, and model-processing permissions are not established. The Agent route is now blocked pending written source approval; see [issue 184](184-block-premier-league-unauthorized-automation.md). This ticket records the historical adapter implementation and does not authorize new live requests.

## Answer

Added a `premier_league` repository backed by live Premier League Pulselive endpoints. The adapter reads the current-season player directory and nine verified statistical leaderboards, joins birth dates only by exact player/team identity from same-source club squads, and carries source, season, retrieval and sample provenance into evidence. It bounds pagination, response sizes and request duration, rejects redirects and unsafe cursors, caches concurrent reads, and leaves absent or zero-minute metrics unavailable. The default dataset mode remains unchanged.

Validation on 2026-10-08:

- Live 2026/27 source read: 1,018 player directory records across 20 Premier League teams; this is one league's current performance pool, not a complete transfer market or registration list. Only 585 records had an exact same-source birth-date match. No xG field was observed in the verified leaderboard responses.
- Real `qwen3.5:9b` LangGraph run for `bayern-kane-replacement`: two clarifications, same-case resume, six tool calls, 37 progress events, 10 evaluated candidates and a Reviewer-backed report. All 27 Harness checks passed in 327.646 seconds. The report recommended two candidates with goal and key-pass evidence, while retaining the missing finishing/link-up data and source-scope limitations.
- `tests/premier-league-provider.test.ts`: 7/7; full `pnpm test`: 265/265; `pnpm build`, `pnpm build:web`, and `git diff --check`: passed.

This run validates the LangGraph conversation and evidence contract against one live source snapshot. It does not validate ranking accuracy, market-wide coverage, data freshness guarantees, or long-run model reliability.

## Comments

- 2026-10-08：Pulselive 实时接口完成适配并用于完整 LangGraph 对话验收；全链路 Harness 27/27 通过。数据范围与单次运行局限已写入 Answer。
