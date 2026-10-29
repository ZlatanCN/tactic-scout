# 24: Distinguish overlapping and all-player comparison scopes

**What to build:** Make comparison output say exactly which participants have each Understat competition/season scope, so the answer cannot mistake a subset overlap for one scope shared by everyone.

**Blocked by:** None.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Add a graph-level regression for a three-player comparison where two have EPL records and the third has a La Liga record.
- [x] Include deterministic per-scope coverage counts and an explicit all-participants flag in the comparison tool result.
- [x] Clarify the comparison answer rule: partial scopes may support only subset comparisons; never rank all participants unless a scope covers all of them.
- [x] Keep per-player source records and the comparison outcome intact.
- [x] Run the full offline suite.
- [x] Run a calibrated, one-case live semantic smoke under an explicit request cap.
- [x] Review the code and ticket against project standards and this spec.

## Evidence

Corrected baseline `dc3c8927-7426-490a-b99b-abd19231554c` found one factual contradiction. In `compare-add-third-synthetic-v1`, Elias Demo and Synthetic Midfielder had EPL 2024/25 records, while Synthetic Winger had a La Liga 2024/25 record. The tool output called EPL a `sharedUnderstatScopes` entry and represented Synthetic Winger with `record: null`; one answer incorrectly described it as one three-player common scope.

## Resolution

The comparison result now calls partial scope overlaps `understatScopeGroups`, gives each group covered/total participant counts and a `coversAllParticipants` flag, and reports the count of fully common scopes separately. The answer prompt must use those fields before describing a scope as shared by everyone. Individual Understat records remain attached to their own players and competitions. Targeted graph tests pass, and the full offline suite passes all 135 tests.

Live smoke `09af647c-d887-4216-911f-0fd87696ca91` used 37/60 requests (agent 4, calibration 32, judge 1). Calibration v8 passed 16/16; the comparison trial passed deterministic and semantic review, covered all required facts, and had no unsupported or contradicted claims. The answer said EPL covered only Elias Demo and Synthetic Midfielder and explicitly said no single Understat scope covered all three. The report is local under `.data/evals/runs/`.
