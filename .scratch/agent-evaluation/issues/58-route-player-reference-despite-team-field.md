# 58 · Keep player-reference recommendations out of team search

**What to build:** When the user asks for a positional recommendation based on a named player, keep it in the player-recommendation workflow even if extraction echoes that player's name in `teams` and `teamSearchName`.

**Blocked by:** None.

**Status:** resolved

## Evidence

V18 baseline `7e6fafe0-6da7-4e80-b7a5-ff5f517a2975` failed `recommend-smoke-synthetic-v1` trial 3. The user asked “根据 Synthetic Reference 推荐 stc 球员，不要 Synthetic Far Candidate。” Extraction returned `team_recommendation`, copied `Synthetic Reference` into both `teams` and `teamSearchName`, and also listed it as the reference player. The graph then attempted `api_football.search_teams` and returned a configuration error instead of running player recommendation.

## Acceptance

- A player-based positional recommendation is normalized to `player_recommendation` when the echoed team entry matches a non-excluded player mention and the request contains no explicit team/club/squad wording.
- The normalized request clears the erroneous team name and search term, retaining the reference and exclusion players.
- Explicit team phrasing such as “为 Real Madrid 推荐 stc 球员” remains `team_recommendation`.
- A regression reproduces the exact extracted shape and confirms no team search path is selected.

## Result

Request normalization now treats an echoed `teams` entry as a player reference when it exactly matches a non-excluded player mention in a player-based positional request, with no explicit club/team/squad wording. It clears the erroneous team name/search term. Explicit team recommendation syntax still wins. The regression reproduces the `recommend-smoke-synthetic-v1` extracted shape; v19 smoke `66c7f76e-e76e-45bc-b828-9cfd9cc845a4` passed the case without a team-search call.
