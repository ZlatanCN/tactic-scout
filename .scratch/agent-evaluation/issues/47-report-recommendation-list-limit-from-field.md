# 47 · Read recommendation list limits from the result field

**What to build:** Recommendation answers must state the configured result limit from the tool output, not infer it from the number of surviving candidates.

**Blocked by:** None.

**Status:** resolved

## Evidence

V14 `recommend-ambiguous-profile-synthetic-v1` returned `filters.resultLimit: 5` and two candidates after identity exclusion. The answer incorrectly claimed the result limit was two.

## Answer

The recommendation prompt now says to read `filters.resultLimit` (or the corresponding nested team field), never infer the cap from list length or stage counts, and omit a numeric cap when the field is null. A regression checks the prompt rule.
