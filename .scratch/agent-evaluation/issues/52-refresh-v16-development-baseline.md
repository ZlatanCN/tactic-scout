# 52 · Refresh the v16 development baseline

**What to build:** Run the complete 32-case development split with three trials per case using the calibrated v16 judge and final fixes.

**Blocked by:** None.

**Status:** open
**Label:** ready-for-human

## Evidence

V16 smoke `b95369ba-89a3-4399-8720-b8045bb8492e` passed all five failure-focused cases and all 16 reserved validation anchors. The current full development baseline is v14 and predates issues 44–50.

## Acceptance

- Preview and confirm the exact request estimate.
- Use a new explicit whole-run physical-request allowance.
- Preserve the v14 report and all targeted smoke reports.
- Keep the 16 held-out cases untouched.
- Record completion, semantic findings, code-check outcomes, request usage, token totals, and latency by role.
