# 36 · Calibrate judge v10 and refresh the development baseline

**What to build:** Run the 32-anchor v10 calibration, then the fixed-evidence development split and review the refreshed per-turn judge results before considering any held-out run.

**Blocked by:** None.

**Status:** open
**Label:** ready-for-human

## Evidence

Judge prompt v10 adds per-turn participant scope. The proxy and runner have deterministic local coverage for the new input shape and telemetry, but the prompt has not been sent to the configured gateway. The v9 development baseline remains historical; the held-out split must stay untouched.

## Acceptance

- Preview the exact request estimate for v10 calibration and the 32-case, three-trial development split.
- Use a new explicit whole-run gateway request allowance.
- Require all 16 reserved validation anchors to pass before interpreting semantic case scores.
- Record the new report ID and summarize changed failures without overwriting the v9 report.
