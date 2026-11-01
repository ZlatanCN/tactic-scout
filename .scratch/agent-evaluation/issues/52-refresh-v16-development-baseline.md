# 52 · Refresh the v16 development baseline

**What to build:** Run the complete 32-case development split with three trials per case using the calibrated v16 judge and final fixes.

**Blocked by:** None.

**Status:** resolved

## Evidence

V16 smoke `b95369ba-89a3-4399-8720-b8045bb8492e` passed all five failure-focused cases and all 16 reserved validation anchors. The current full development baseline is v14 and predates issues 44–50.

## Acceptance

- Ran the full 32-case development split three times per case and preserved earlier reports.
- Kept the 16 held-out Agent cases untouched.
- Recorded outcomes, semantic findings, code checks, request usage, token totals, and latency by role in the baseline analysis.

## Result

The completed v16 baseline is `4d1e807b-d119-40bf-953f-68608b6347d3`. It used 416 requests (Agent 288, calibration 32, judge 96) under the 1,099-request continuation cap. Judge calibration passed 32/32, including validation 16/16. There were no budget denials and two upstream network failures. All 96 trials completed; 90 passed, five failed, and one had an invalid judge response. The 16 held-out Agent cases were not run.

The first attempt, `6a8a89c4-be29-4773-a50a-47dba058f12a`, is preserved as partial: 401 requests, nine judge 429s, and nine trials left unscored. A retry preflight, `9fa64ce0-0404-4ab6-b00d-e6c156d7e45b`, failed before any model request because the sandbox blocked the local proxy listener. The successful continuation stayed within the originally approved 1,500-request total.
