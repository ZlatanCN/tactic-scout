# 35 · Describe missing comparison data accurately

**What to build:** A completed comparison that returns `no_comparable_data` because local snapshots are missing must not be described as a failed or incomplete operation. Shared `data_unavailable` copy must not guess whether the local source is missing or unreadable.

**Blocked by:** None.

**Status:** resolved

## Answer

The fixed `data_unavailable` response now says the required local information could not be obtained, without guessing whether the snapshot is missing or unreadable and without claiming the query or calculation failed to complete. The comparison regression covers the missing-snapshot result; team and lookup regressions cover the shared response.
