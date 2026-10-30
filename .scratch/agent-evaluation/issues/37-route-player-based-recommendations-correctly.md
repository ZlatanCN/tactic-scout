# 37 · Keep player-based recommendations out of the team workflow

**What to build:** If a recommendation names a player reference, a supported position code, and no team, the request must not be routed to `team_recommendation` just because the model chose that kind.

**Blocked by:** None.

**Status:** resolved

## Evidence

V10 baseline `d5ae61a1-4dc7-466b-bdab-11b045b96f9e` had four deterministic failures across `recommend-add-haaland-kane-real-v1`, `recommend-ca-empty-real-v1`, and `recommend-smoke-synthetic-v1`. The user asked “根据 Erling Haaland 推荐 stc 球员,” but extraction returned `team_recommendation` with `teams: []`; the graph asked for a team instead of resolving the player reference.

## Answer

Request normalization now recognizes explicit player-based wording with a named player and supported position, correcting a `team_recommendation` extraction to `player_recommendation` only when no team was extracted. The exact Real Madrid team syntax still wins and keeps its team workflow. A regression verifies the normalized kind, position, empty teams list, and replace action.
