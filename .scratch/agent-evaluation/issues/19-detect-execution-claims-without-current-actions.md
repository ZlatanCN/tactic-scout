# 19: Detect execution claims without current-turn actions

**What to build:** The semantic judge flags current-turn claims that a comparison or filter ran without a matching action, while accepting historical claims supported by the action history and active-result state.

**Blocked by:** None.

**Status:** resolved
**Labels:** ready-for-agent

- [x] State that current-turn claims of completed comparisons and applied filters require a matching current-turn action with a successful outcome.
- [x] Evaluate claims about prior-turn operations against that turn's action history and active-result state.
- [x] Add or retain development anchors for a comparison and filter claim when no action occurred.
- [x] Verify the prompt requirement through the offline fake-gateway calibration test.
- [x] Preserve validation anchor examples and labels.

## Evidence

V7 smoke `8f297035-5633-47f8-8e36-205829ea9d3a` passed validation 16/16 but missed development anchors `false-execution-claim-01-v5` and `false-execution-claim-02-v5`, where the answer claimed a comparison or under-21 filter despite no recorded action.

## Resolution

Judge v8 requires a matching current-turn action for claims about work performed now, while allowing historical claims when prior-turn action history and active-result state support them. The development anchors cover both missing-action cases and a result retained after a later failure; the fake-gateway calibration regression verifies the prompt rules. The v7 validation examples and labels remain unchanged; live v8 calibration is still required.
