# Repair the report loop and name-filter behavior found by live Harness

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: 81

## Goal

Make the real multi-turn Bayern replacement case converge through legal LangGraph actions after source-aware broadening, without repeating exhausted report retrieval or using an unsupported candidate-name filter.

## Why now

The 2026-10-07 full Qwen/FPL run completed safely, but the new Harness correctly failed it. In the third turn, the report-search budget was exhausted while the planner still had an unrestricted investigate decision; it chose `search_player_reports` twice, and the graph stopped the repeat with its guard. Candidate discovery also recorded `playerNameFilterUsed: true` even though the report search returned zero results. The current gate compares `playerName` against `searchedReportPlayerNames`, which records names sent to a search, not names evidenced by returned report documents.

The latest run also exposed a false empty-result acceptance caused by asking a user-confirmed position to restart at offset 0 after the same source scope already had a verified first page. The next turn must reuse that scope at its real next cursor, while preserving the position boundary.

## Scope

- Keep the repeated-policy-action Harness invariant from issue 81 enabled.
- Restrict `search_candidates.playerName` to a name supported by an actually returned, authorized player-report result; a name merely submitted for report search is not evidence.
- Route the graph into a constrained reorientation/conclusion decision when the per-turn report-search budget is exhausted, including when some report names remain unsearched.
- Preserve source-aware reuse of a valid broader-position page after the user authorizes widening; do not refetch offset 0 when the recorded cursor proves the next page.
- Validate through the public LangGraph conversation/runtime seam and the selected repository → conversation → report Harness scenario.

## Acceptance criteria

- [x] When player-report retrieval returns no results, a subsequent candidate search cannot use a name filter based only on the names previously searched.
- [x] A name filter is accepted only when an authorized returned report result carries that entity name, and the user's reference player is never used as a replacement candidate filter.
- [x] When the per-turn report-search budget is exhausted, the planner receives only currently valid reorientation/conclusion choices; the live scenario does not invoke the repeated-policy-action guard.
- [x] After an empty confirmed-position search and user consent to broaden, a previously observed broader search may resume at its valid next cursor in the new turn.
- [x] Deterministic graph and Harness regressions pass, and the live Qwen scenario reaches an honest report with every registered behavior check passing.
- [x] Report ranking quality remains explicitly unevaluated without trusted scout labels.

## Answer

The graph now accepts a candidate name filter only when a returned, permitted player-report result explicitly contains that entity; names merely submitted to report search, already-discovered names, and the reference player are rejected. Source-aware cursor reuse now resumes an authorized broader search from its recorded offset. When the per-turn report budget is exhausted, the Planner receives a constrained reorientation/conclusion mode, and the report states when evaluated candidates remain without report coverage.

Verification: `node --import tsx --test tests/local-agent-evaluation.test.ts tests/recruitment-conversation.test.ts` passed 68/68; the full `pnpm test` suite passed 232/232; `pnpm build`, `pnpm build:web`, and `git diff --check` passed. A live `qwen3.5:9b` + FPL run completed the full three-turn same-case flow in 236.261 seconds: two user clarifications, 12 tool calls, 30 evaluated players, Reviewer, and one final evidence-backed lead. All 21 registered Harness checks passed. The planner made one additional candidate-search proposal after the current page/scope was exhausted; LangGraph rejected it once, the planner then finished, and no repeated-policy-action fallback was used. The report retrieved 2 methodology chunks and 0 player-report chunks; the source returned 79 ATT matches, so the run evaluated a bounded 30-player sample. This validates the recorded workflow and evidence contracts, not the lead's ranking quality, full roster coverage, or long-term reliability.

## Comments

- 2026-10-07: The first post-regression run exposed an empty-position pagination false negative; after fixing cursor reuse and name-filter evidence gating, the second end-to-end run passed all Harness checks. It also exposed one non-repeated, policy-rejected candidate search after the sampled scope ended; the current Harness permits a single blocked action and rejects repeated blocked actions. Ranking evaluation still requires trusted scout labels.
