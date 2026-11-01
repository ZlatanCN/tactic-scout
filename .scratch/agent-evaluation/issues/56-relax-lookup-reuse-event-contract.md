# 56 · Allow valid lookup continuation paths

**What to build:** Change the lookup continuation case to assert saved-result availability and no redundant player-record search without requiring one exact identity-event label.

**Blocked by:** None.

**Status:** resolved

## Evidence

In v16 baseline `lookup-identity-clarification-v1` trial 3, identity resolution reported the existing player as `resolved` where the case required `saved_result_reuse`. The previous lookup remained available and no new `search_player_records` action ran, so the case currently rejects a behaviorally valid internal path.

## Acceptance

- The case accepts either saved-result reuse or deterministic identity resolution, while requiring the same selected candidate ID across the initial lookup and follow-up.
- It still requires the prior lookup result to remain available and forbids a redundant player-data search for an explain-only follow-up.
- A focused local check proves the case rejects a wrong identity or a new search call.

## Result

Removed the brittle single-label turn-2 requirement and added an accepted status alternative while requiring the original selected candidate ID. The turn-level contract still requires exactly the expected observations, and `turn-tool-actions` rejects a second player-data search on the follow-up. A regression confirms valid saved-result reuse/re-resolution passes while a different candidate ID fails.
