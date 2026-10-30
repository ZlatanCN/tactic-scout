# 35 · Describe missing comparison data accurately

**What to build:** A completed comparison that returns `no_comparable_data` because local snapshots are missing must not be described as a failed or incomplete operation.

**Blocked by:** None.

**Status:** resolved

## Answer

The fixed `data_unavailable` response now says the local snapshot lacks records needed for the request and that no result can be provided. It no longer claims the query or calculation failed to complete. The comparison regression covers the exact missing-snapshot result and the existing team/lookup regressions were updated for the same shared message.
