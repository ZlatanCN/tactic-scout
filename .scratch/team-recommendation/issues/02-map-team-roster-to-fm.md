# 02: Resolve squad members to local FM profiles

**What to build:** After a team squad is loaded, the agent can determine which roster players have exact local FM profiles and ask the scout to resolve unmatched identities safely.

**Blocked by:** 01: Resolve a team and retrieve its current squad.

**Status:** resolved

- [x] API-Football player IDs first resolve through exact Reep player bridges to local FM IDs.
- [x] A roster player without a Reep bridge is searched against local FM records; matching names are presented as candidates and never merged automatically.
- [x] When several FM profiles could match, the clarification shows enough identity context for the scout to choose one exact FM profile.
- [x] If no FM profile can be found or identity remains unresolved, the team recommendation pauses and reports the affected roster member; it does not rank from a partial roster.
- [x] Each confirmation resumes the same request and preserves prior roster mappings. The roster is not fetched again while the seven-day process cache is valid.
- [x] The resolved roster reports total members, exact Reep-to-FM mappings, user-confirmed mappings, and members with no local FM profile.
- [x] Tests cover exact bridges, ambiguous FM candidates, user confirmation, no-profile outcomes, and interrupt/resume without external API calls.
