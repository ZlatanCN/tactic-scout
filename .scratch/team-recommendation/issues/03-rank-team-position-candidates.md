# 03: Recommend candidates from a team-position profile

**What to build:** A scout receives players whose FM attributes are similar to the mapped current squad at the explicitly selected position, with current squad members excluded.

**Blocked by:** 02: Resolve squad members to local FM profiles.

**Status:** resolved

- [x] Team-profile references are mapped squad FM profiles at the requested position with a position rating of at least 15 and complete required features.
- [x] The target profile is the equal-weight mean of those players’ position-specific raw attributes. A single eligible player is a valid reference profile.
- [x] Candidate profiles come from the local FM snapshot, meet the same position-rating and feature-completeness gates, and exclude every mapped current squad FM ID.
- [x] Candidates use the existing position-specific RMSE ranking and stable FM-ID tie-breaker; no new formula is introduced.
- [x] Explicit age, CA, and PA filters are applied. A high-potential list appears only when requested and remains separate from the current-ability similarity list. The default is Top 5.
- [x] If no usable team reference profile exists at the target position, the agent asks the scout to choose another position or provide a named reference player; it does not silently switch ranking methods.
- [x] Results show team identity, target position, roster mapping coverage, roster retrieval date, FM snapshot date, filters, and the basis of the ranking.
- [x] A completed empty result is saved for later refinement. Unsupported conditions, unresolved identities, or data failures do not overwrite the last successful team recommendation.
- [x] Graph tests use an isolated MemorySaver, fake model, and injected team/roster tools; ranking assertions exercise the public recommendation contract.
