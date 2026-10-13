# Premier League and TheSportsDB scope recheck

Checked: 2026-10-13

## Premier League Pulselive

The [Premier League Terms of Use](https://www.premierleague.com/en/terms-and-conditions) reserve website/app rights and allow private personal use; forwarding material is limited to other people's private personal use with attribution. The terms say other reuse, redistribution, and creating a database from material obtained from the website or app require prior written approval (§ Intellectual Property Rights). The [statistics clarification](https://www.premierleague.com/en/stats/clarification) says official performance data is collected and analyzed by Opta/Stats Perform. The current TactiScout adapter reads site-backed Pulselive JSON routes and creates a current-season player/statistics repository. No source approval covering automated access, database creation, AI/RAG processing, or public display is recorded.

Decision: block the provider from all Agent turns before data reads and model calls. A local model does not resolve the separate automated-access/database permission gap. Retain adapter code only for deterministic tests pending written permission; do not run another live request.

## TheSportsDB roster context

The official [team-search response](https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=Arsenal) includes `strSport` and `strGender` on the team. The official [team-player response](https://www.thesportsdb.com/api/v1/json/123/lookup_all_players.php?id=133604) includes both fields per player. The official [API documentation](https://api.thesportsdb.com/documentation) says the search endpoint covers sports generally, while the list-teams endpoint supports a `strSport` filter; a text name match alone does not guarantee soccer or men's scope. At the start of this review, the adapter omitted both fields from its schemas and could not enforce the product's male-football display boundary; [issue 185](../issues/185-enforce-mens-soccer-roster-scope.md) records the resulting fix and regression checks.

Decision: require explicit `Soccer` and `Male` on both the selected team and each displayed player. Missing or different values are not evidence that a record is in scope. The optional sidecar remains outside LangGraph and scoring.

## Limits

This is a source-policy and response-shape review, not legal advice. No Premier League request was made for this recheck. The TheSportsDB responses are official example endpoints, not a fresh team-roster completeness or current-registration audit.
