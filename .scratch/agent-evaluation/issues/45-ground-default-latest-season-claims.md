# 45 · Ground default latest-season claims

**What to build:** The agent and semantic judge should accurately describe the Understat default-season behavior without making the judge treat an implemented default as unsupported.

**Blocked by:** None.

**Status:** resolved

## Evidence

Two V14 `lookup-followup-smoke-v1` trials correctly queried Understat with no explicit season and returned a 2024/25 record, but the judge rejected the answer's “snapshot latest” statement because the tool result did not state the reader's default-selection rule.

## Answer

The judge now includes the verified Understat rule: an omitted season selects the maximum snapshot `season_start_year`, and an explicit 2024 start year corresponds to 2024/25. The agent is instructed to report the returned season and avoid unsupported latest wording unless the query result provides that metadata.
