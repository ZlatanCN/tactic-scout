# Team-directed FM player recommendation v1

Status: resolved

## Problem Statement

The agent can recommend players similar to a reference player, but it cannot answer a scout who asks for a player for a particular team and position. The local Football Manager snapshot contains ability profiles and position ratings, not current team membership. The team recommendation workflow therefore needs a current squad source, reliable links from squad players to local FM profiles, and a clear definition of what “fits this team” means.

## Solution

Let the scout specify a team and target position. Use the team’s current roster as an explicit reference set: resolve roster players to local FM profiles, select the players whose rating is at least 15 for the requested position, compute their equal-weight mean position-attribute profile, and rank other eligible FM profiles by the existing position-specific RMSE formula.

Exclude every exactly identified current squad player from the candidate list. If a roster member lacks an identity bridge, ask the scout to choose the matching FM profile. If a roster identity cannot be resolved, stop the recommendation rather than risk returning a current squad member. If no usable team profile exists for the requested position, ask the scout to choose another position or provide a named reference player.

## User Stories

1. As a scout, I want to name a team and target position, so that I can see candidates for a specific squad.
2. As a scout, I want the system to resolve a unique team name automatically, so that I do not need to know the provider’s numeric team ID.
3. As a scout, I want to choose between same-named teams using country or competition details, so that the request targets the correct team.
4. As a scout, I want the agent to retrieve the current roster for the selected team, so that the recommendation uses actual squad membership.
5. As a scout, I want the roster source and retrieval date shown, so that I can judge how current the team context is.
6. As a scout, I want API-Football player IDs to connect to FM profiles through exact Reep bridges when available, so that roster identities are not guessed from names.
7. As a scout, I want the agent to show candidate FM profiles when a roster player has no exact bridge, so that I can confirm the correct local profile.
8. As a scout, I want the agent to identify a roster member with no local FM profile and pause the request, so that the mapping or source data can be corrected before ranking.
9. As a scout, I want the recommendation to stop if a roster member’s identity remains unresolved, so that the system does not recommend a possible current team player.
10. As a scout, I want the target position to be explicit, so that the team request does not silently infer a tactical need.
11. As a scout, I want only team players with an FM rating of at least 15 at the target position to define the team profile, so that the reference set follows the same position-capability gate as individual recommendations.
12. As a scout, I want the team-position profile to be the equal-weight mean of those players’ position-specific raw attributes, so that the reference profile has a transparent meaning.
13. As a scout, I want candidates ranked with the existing position-specific RMSE formula, so that team recommendations use the same scoring method as individual recommendations.
14. As a scout, I want every mapped current squad player excluded from recommendations, so that I do not receive a player the team already has.
15. As a scout, I want explicit age, CA, and PA filters to be applied, so that the candidate set obeys the conditions I gave.
16. As a scout, I want a separate high-potential list only when I ask for youth or potential, so that current-ability similarity and PA remain distinct questions.
17. As a scout, I want the agent to ask for another position or a named reference if no usable team profile exists for my target position, so that it does not silently change the ranking method.
18. As a scout, I want an unresolved team or roster clarification to resume the same request, so that I do not have to repeat the team, position, and confirmed mappings.
19. As a scout, I want a later filter-only request in the same thread to inherit the last successful team and position, so that I can refine a candidate list with less repetition.
20. As a scout, I want a new team request to replace the prior team context, so that candidates from one club are not accidentally used for another.
21. As a scout, I want failures and incomplete requests to preserve the last successful team recommendation, so that a failed refresh does not erase useful results.
22. As a scout, I want FM snapshot date and API roster retrieval date shown separately, so that I can see the time difference between ability data and team membership.
23. As a scout, I want the system to report roster-to-FM mapping coverage, so that I can see how many team members actually contributed to the team profile.
24. As a scout, I want quota or API failures to produce a clear response and preserve the previous result, so that upstream outages do not look like an empty squad.
25. As a scout, I want all team and roster lookups isolated by thread, so that one team’s context cannot leak into another conversation.
26. As a project owner, I want the API credential kept in a local environment variable, so that no secret enters source control.
27. As a project owner, I want the first version used only in local or private demos, so that the project does not redistribute raw API-Football roster data.

## Implementation Decisions

- The workflow uses API-Football’s current squad endpoint. API-Football is listed in Reep Coverage as a bridge provider; local inspection found player bridges to FM but no team-ID bridge. The team identity therefore remains an API-Football team ID rather than a Reep canonical team ID.
- API-Football team search resolves a unique exact-name query automatically. The extractor preserves the user's team mention and may supply an API-Football search name for a Chinese name or alias; if that search name differs from the user's wording, the graph asks the scout to confirm the single result. Multiple matches pause for confirmation with returned country context.
- The roster is cached in process memory for seven days. A process restart clears the cache and triggers a new fetch. The free API plan advertises 100 requests per day; the official documentation describes the squad endpoint as updated several times a week and recommends approximately one call per week. [API-Football pricing](https://www.api-football.com/pricing) · [API-Football squads documentation](https://www.api-football.com/documentation_v3)
- Reep player bridges are used to map API-Football player IDs to local FM IDs. For a roster member without a bridge, the agent searches local FM records and interrupts for an exact user selection. Name similarity alone never merges identities. If no FM profile can be confirmed, the current recommendation pauses until the identity or data is resolved.
- The user supplies one FM target position. Team members contribute to the team reference profile only if their local FM position rating is at least 15 and all required raw features are present. One eligible player is a valid single-profile mean.
- The team reference profile is an equal-weight mean of the selected team members’ raw attributes for the requested position. Candidates use the existing position-specific RMSE formula and FM ID tie-breaker.
- Every mapped player in the current API-Football squad is excluded from the candidate pool, not only players who contribute to the target-position mean.
- Candidate eligibility, explicit age/CA/PA filters, default Top 5 result count, and a separately requested high-potential list reuse the existing FM recommendation rules.
- If no eligible team profile exists at the requested position, the clarification asks the user to choose another position or provide a named reference player. The system does not fall back to CA ranking or a position-wide average.
- The graph adds three task boundaries: resolve the API-Football team identity, resolve roster members to FM profiles, and recommend players for the team. They share the existing clarification and answer nodes; the team workflow does not add a model-planned tool loop.
- Team recommendation state is separate from individual-player recommendation state. In the same thread, filter-only refinements inherit the last successful team and position; a new team replaces that context. Failed, incomplete, or unsupported requests do not overwrite a successful result.
- API roster date and FM snapshot date are both included in the result. The local FM snapshot is dated 2025-11-23; API-Football returns the current squad.
- The API-Football key is read from local environment configuration and never committed. The initial use is local/private. API-Football terms prohibit resale and do not grant a general publication license; third-party competition rights remain the user’s responsibility. [API-Football terms](https://www.api-football.com/terms)

## Testing Decisions

- The primary seam is a complete graph invocation with an isolated MemorySaver, fake model, injected team/roster tools, and injected local identity resolution. Tests assert visible messages, selected team/player identities, interrupts, final candidates, and saved thread context.
- A narrow provider-adapter seam uses a fake HTTP response and a controlled clock to test API response parsing, team ambiguity, seven-day cache reuse, expiry, quota errors, and missing fields.
- Existing recommendation ranking behavior is tested through the public recommendation data contract. Team tests verify the exact FM IDs passed into the existing ranker, the team-position mean inputs, and the exclusion set rather than inspecting private helper functions.
- Coverage includes unique and ambiguous team names; Reep bridge hits; missing bridge with user-selected FM profile; no local FM match; multiple unmatched roster members; one or zero position-capable team members; current-squad exclusion; current-versus-FM snapshot dates; filters and separate PA ranking; thread refinement and isolation; API failures; and preservation of the last successful team result.
- CI uses fake API and model responses only. A separate local smoke test uses the user’s API-Football key; no API key or live quota is required for automated tests.
- Prior art is the existing full-graph createAgent tests with Fake Model, MemorySaver, and Command resume, plus FM reader and deterministic ranking tests.

## Out of Scope

- Automatically deciding which position a team needs to strengthen or inferring a formation.
- Tactical-role suitability, playing-style compatibility, transfer feasibility, contract status, wages, fees, or market availability.
- Returning raw API-Football feeds as a public data product or deploying a public-facing service.
- Replacing the existing individual-player, comparison, or recommendation workflows.
- Adding a persistent application database or LangGraph Store.
- Using a source outside the provider list in Reep Coverage for the v1 roster feed.

## Further Notes

- Reep Coverage lists API-Football as a bridge-only provider; its bridge role supports identity joins but is not independent evidence that two identities are the same. [Reep Coverage](https://www.reep.football/coverage/)
- A local read-only audit found API-Football player bridges intersecting the current FM snapshot, but not full roster coverage. Team roster resolution therefore reports mapping coverage and uses explicit user confirmation for unresolved IDs.
- The data source is time-sensitive. API-Football plan, quota, endpoint freshness, and applicable third-party rights should be rechecked before any public deployment.
