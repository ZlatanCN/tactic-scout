# 38 · Bound empty Understat lookup claims to the query

**What to build:** When a lookup returns no Understat rows, the assistant must not claim that a requested competition has no data or that a particular metric is unavailable if the search did not filter by competition and returned no record details.

**Blocked by:** None.

**Status:** resolved

## Evidence

The v10 baseline found two semantic failures for `lookup-mbappe-confirmation-real-v1`. The tool searches the selected source ID and optional season, not the user-requested competition. It returned `not_found` with an empty record list, while the answer attributed the absence to La Liga and xG.

## Answer

The lookup system prompt now states that the search does not filter by competition. Empty results must be described as no rows returned for the selected identity/source and season; competition-specific absence or metric availability must remain unclaimed. The request-extraction regression also retains the explicit Understat season scope.
