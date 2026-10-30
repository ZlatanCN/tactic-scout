# 02 · Select continuation targets and reuse saved results

Status: resolved
Label: ready-for-agent
Blocked by: 01

## Goal

Derive the previous-turn workflow summary before replacing state, select an explicit or compatible continuation target, preserve current-turn patches across workflow clarification, and route explicit saved-result explanations directly to the answer node.

## Acceptance

- Explicit workflow targets take precedence.
- An unambiguous compatible prior workflow is continued; multiple plausible snapshots trigger a workflow clarification.
- Failed or unrelated work never silently falls back to another workflow's snapshot.
- Workflow clarification preserves the current patch through `Command` resume without re-running request extraction.
- Omitted fields inherit, `null` clears, and explicit values override.
- Saved-result explanations use a validated snapshot and skip entity/data nodes; outcome identifies `source: "saved"`.
- The chosen workflow is normalized into the turn state so the following refinement continues naturally.

## Answer

Request understanding now derives a temporary previous-turn summary, applies explicit workflow selection first, and otherwise uses the last compatible successful workflow or asks when multiple snapshots fit. A failed different-target task blocks fallback. Workflow selection stores the normalized request patch in the existing interrupt state and resumes without another extraction call. Explain requests decode the active snapshot and route directly to the answer node with `source: "saved"`; follow-up refinements inherit omitted values and explicit `null` clears supported recommendation filters.

Comparison condition-only refinements retain the saved participants while merging the current season/competition patch. There is no persisted continuation pointer or new graph node.

Focused graph, continuation, and result-contract tests pass.

Review follow-ups ensure an understanding failure requires confirmation before using an older snapshot, a named-reference team result remains eligible for player-mention continuation, and request construction/clarification helpers live outside `src/nodes/`.

Search-limit and failed-understanding regressions verify that old successful snapshots are preserved and never selected silently.

Saved lookup follow-ups are subject to the same failure-boundary check as other workflow reuses.

Lookup reuse also checks the selected source records and requested Understat season. A failed request for the same player in a different season cannot silently explain the older snapshot.

## Comments

- 2026-10-30: Claimed after result contracts were implemented.
