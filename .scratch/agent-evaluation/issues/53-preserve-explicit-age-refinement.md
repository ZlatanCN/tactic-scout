# 53 · Preserve explicit age refinements

**What to build:** Deterministically preserve a literal numeric age ceiling when request extraction misses it during a player or team recommendation refinement.

**Blocked by:** None.

**Status:** resolved

## Evidence

In v16 baseline `4d1e807b-d119-40bf-953f-68608b6347d3`, `recommend-add-refine-synthetic-v1` trial 2 said “把年龄上限设为 21 岁”. The structured extractor returned no recommendation patch, so the graph called `recommend_player_candidates` with `maxAge=null`, retained the old candidate set, and presented it as a result of the refinement. Deterministic checks caught the filter loss.

## Acceptance

- When a refinement message explicitly states a supported numeric age ceiling, the request state and tool input contain that exact ceiling even if extraction omits or misstates `maxAge`.
- Other extracted recommendation fields remain unchanged.
- Replacement/add requests and ambiguous youth phrases keep their existing behavior.
- Regression coverage verifies the graph updates the active result from the refined tool result instead of reusing the unfiltered candidates.

## Result

`request-building.ts` now recovers explicit Chinese and English numeric age ceilings from the current message during refinement and applies the literal value to player and team recommendation requests. The literal message value wins if model extraction omits or misstates the number, including “from 21 to 18” corrections where the final value must win. Replacement/add requests and ambiguous youth phrases retain their prior behavior. A graph regression covers omission, a conflicting extracted value, and a from/to correction.
