# 29 · Preserve an explicitly repeated team during refinement

**What to build:** When the user repeats the selected team's name while refining its filters, request understanding preserves that explicit team mention so the graph does not lose the target if no successful team snapshot is available to inherit.

**Blocked by:** None.

**Status:** resolved

## Answer

Clarified the request-extraction prompt: a team name written in the current turn must remain in `teams`, even when it is the same team and the user is refining filters. `teams` may be empty only when the current turn omits a team name and can inherit a successful team recommendation. Supported FM position codes written in the user's message are now deterministically copied into `recommendation.position` for team recommendations, so an extractor omission does not trigger an unnecessary position question. The request builder treats an explicitly repeated saved team with `continuationAction: refine` as a refinement, preserving its filters and roster. Added prompt-contract and graph-level regressions.

## Evidence

Development run `38e8d637-8ebc-47ad-878f-f9500cf7bef1` recorded a second-turn request that explicitly named Real Madrid, but the model returned `teams: []` and `teamSearchName: null`; the graph therefore returned `team_required`. It also recorded a Synthetic Town request with explicit `stc` but no extracted position, so the graph asked for `team_position` before team selection. Targeted follow-up smoke `3fb4072f-7858-44f9-9310-9282838b4295` retained Real Madrid, resolved team ID 541, preserved CA 150, and passed deterministic checks using 2/25 requests. Smoke `6add9d7c-f27b-40d1-aa3d-d57335e5dd22` preserved `stc`, selected team ID 902 after the scripted team choice, and passed all deterministic checks using 3/20 requests. Both were single trials without semantic judging and do not replace the full development baseline.

## Comments

- 2026-10-30: The failed extraction output was replayed through the graph seam. With the explicit team present in the structured request, the graph executed team search; with it absent, it correctly returned `team_required`. This isolates the correction to request-extraction guidance rather than adding heuristic team-name parsing to the graph.
- 2026-10-30: A second regression covers a successful saved team recommendation followed by an explicit same-team refinement; it preserves the selected team, roster, and omitted filters while applying the new CA threshold.
- 2026-10-30: The ambiguous-team case's `team_position` interrupt was traced to the extractor omitting the literal `stc` code from the user's message. The request extractor now normalizes one explicit supported position code for team requests; the fixed-case smoke passed with `team_position=stc` and selected team ID 902.
