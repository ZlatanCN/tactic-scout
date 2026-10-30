# 48 · Keep empty Understat answers within returned evidence

**What to build:** For an empty Understat result, the agent must report the queried source/year and absent returned value without claiming the record or metric does not exist more broadly.

**Blocked by:** None.

**Status:** resolved

## Evidence

V14 `lookup-mbappe-confirmation-real-v1` returned `not_found` for source ID 3423 and season start year 2024. One answer described that as no record “in the 2024/25 season” and said no xG value was available, which the judge considered broader than the returned result.

## Answer

The lookup prompt now tells the model to say no Understat row was returned for the selected source and query season, and not to infer global xG availability. The judge prompt normalizes start year 2024 to 2024/25 and limits the supported conclusion to no returned row/value.
