# 57 · Refresh the v18 development baseline

**What to build:** Run the complete 32-case development split with three isolated trials per case using the calibrated v18 judge and current agent fixes.

**Blocked by:** None.

**Status:** resolved

## Evidence

V17 smoke `49801d11-82b8-4f03-b8ee-41556fbe5b96` passed four of five targeted cases; v18 run `05427dfa-9a24-4e10-a379-baefd4d1cc15` re-ran and passed the corrected team case. Calibration passed 32/32 in both runs. Combined usage was 104 requests with no network failures or budget denials. The 16 held-out Agent cases remain untouched.

The current preview estimates 1,235 requests for the full development run, with 96 trials. The prior v16 baseline used a different judge prompt and cannot substitute for a v18 baseline.

## Acceptance

- Confirm the exact preview and a new explicit whole-run request cap.
- Run all 96 development trials and v18 judge calibration.
- Preserve earlier baseline and smoke reports.
- Keep the 16 held-out Agent cases untouched.
- Record outcome counts, semantic findings, code checks, request use, token totals, and latency by role in `baseline-analysis.md`.

## Result

Run `7e6fafe0-6da7-4e80-b7a5-ff5f517a2975` completed all 96 development trials using 413/1,500 requests: Agent 285, calibration 32, and judge 96. V18 calibration passed 32/32, including validation 16/16. There were zero budget denials and zero network failures. Ninety trials passed and six failed; 90 semantic judgments passed, five failed, and one was inconclusive. Deterministic checks passed 95/96. The 16 held-out Agent cases were not run.

The report and failure analysis are in `.data/evals/runs/7e6fafe0-6da7-4e80-b7a5-ff5f517a2975/report.md` and `.scratch/agent-evaluation/baseline-analysis.md`. Follow-up findings are tracked in issues 58 and 59.
