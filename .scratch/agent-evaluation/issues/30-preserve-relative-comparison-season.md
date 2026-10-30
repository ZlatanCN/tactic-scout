# 30 · Preserve relative season scopes for comparison clarification

**What to build:** When a comparison request says “last season” or “上赛季” without a concrete season range, preserve that scope and ask the user for an exact season instead of silently using the latest snapshot.

**Blocked by:** None.

**Status:** resolved

## Answer

Request normalization now preserves relative season phrases for player comparisons when the user has not provided an explicit season range. The comparison node rejects the unresolved value and uses the existing `season` interrupt to request a concrete year range.

## Evidence

In development run `38e8d637-8ebc-47ad-878f-f9500cf7bef1`, the user asked to compare players “from last season,” but structured extraction omitted the season constraint. The graph completed turn 1 without the scripted clarification, so the evaluation never reached the Winger addition; the apparent identity mismatch was a downstream golden-check artifact.

Regression coverage verifies normalization when the model omits the relative scope and graph-level clarification before any comparison data read. Smoke `49b5aa6f-33ca-4821-ae9c-115cc40b9cba` completed all four turns, added Synthetic Winger, and returned the expected final `data_unavailable` outcome using 7/50 requests. Semantic judging was disabled; the original 32-case baseline has not been rerun.
