# 01: Resolve a team and retrieve its current squad

**What to build:** A scout can ask for a team and target position, and the agent resolves the team and retrieves a dated current squad snapshot from API-Football.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] A unique team-name match resolves to its API-Football team ID; multiple matches pause for the scout to choose using the returned country or competition context.
- [x] The selected team’s current squad is returned with provider player IDs, display names, broad positions, team identity, and retrieval timestamp.
- [x] Identical team-roster requests reuse an in-process cache for seven days; an expired cache refreshes from the provider.
- [x] Missing API credentials, quota exhaustion, malformed responses, and provider failures produce clear outcomes without fabricating a roster.
- [x] The API credential is read from local environment configuration and never committed.
- [x] Automated tests use fake provider responses and a controlled clock; they do not call API-Football or consume quota.
