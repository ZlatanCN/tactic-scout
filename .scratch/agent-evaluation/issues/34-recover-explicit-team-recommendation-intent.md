# 34 · Recover explicit team recommendation intent

**What to build:** A model extraction of `other` must not discard an explicit, unambiguous team recommendation that names a team and a supported position code.

**Blocked by:** None.

**Status:** resolved

## Answer

Request normalization now recognizes the explicit forms “为 <team> 推荐 <position-code> 球员” and “recommend <position-code> players for <team>”. It preserves the exact team wording and position, while leaving ambiguous positions and generic requests unchanged. A deterministic extraction regression covers the Real Madrid request that the v9 baseline classified as `other`.
