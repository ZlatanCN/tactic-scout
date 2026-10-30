# 46 · Keep FM technique and dribbling attributes distinct

**What to build:** Comparison answers must not translate the Football Manager `technique` attribute as dribbling.

**Blocked by:** None.

**Status:** resolved

## Evidence

V14 comparison trial `compare-add-third-synthetic-v1` described the `techniqueRaw` value 15 as “盘带技术 15,” although the record separately contains a `dribblingRaw` value.

## Answer

The comparison prompt and judge rules now distinguish `techniqueRaw` (“技术”) from `dribblingRaw` (“盘带”). A system-prompt regression asserts the mapping.
