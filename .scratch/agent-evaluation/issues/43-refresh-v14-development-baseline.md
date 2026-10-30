# 43 · Refresh the v14 development baseline

**What to build:** Run the frozen 32-case development split with three trials per case using the v14 judge, after its calibration and targeted smoke passed.

**Blocked by:** None.

**Status:** open
**Label:** ready-for-human

## Evidence

V14 smoke `da1ad1a3-8b39-46d5-8a40-ddd2c65f4928` passed all five selected cases and all 16 reserved validation anchors. The v10 full development baseline predates issues 37–39 and the v14 judge input; its results remain useful historical comparisons but do not measure the current version.

## Acceptance

- Preview the current 32-case, three-trial run and record its exact physical request estimate.
- Use a new explicit whole-run request allowance.
- Preserve the v10 report and all v11/v13/v14 smoke reports.
- Keep all 16 held-out cases untouched.
- Record per-workflow status, semantic findings, token usage, and latency.
