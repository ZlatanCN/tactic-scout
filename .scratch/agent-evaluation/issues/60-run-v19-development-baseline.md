# 60 · Run the v19 development baseline

**What to build:** Re-run the complete 32-case development split with three isolated trials per case using the v19 judge and the final request-normalization fixes.

**Blocked by:** None.

**Status:** resolved

## Evidence

V19 five-case smoke `66c7f76e-e76e-45bc-b828-9cfd9cc845a4` used 49 requests; calibration passed 32/32, all five code and semantic checks passed, and no network failures or budget denials occurred. It covered the rounded-fact and player-reference routing failures from v18. The 16 held-out Agent cases remain untouched.

The latest full baseline is v18 run `7e6fafe0-6da7-4e80-b7a5-ff5f517a2975`; it predates the v19 fixes. Current preview estimates 1,235 requests for 96 trials with the judge enabled.

## Acceptance

- Confirm the exact preview and a new explicit whole-run request cap.
- Run all 96 development trials, calibrate the v19 judge, and preserve partial reports if the cap is reached.
- Keep the 16 held-out Agent cases untouched.
- Record outcomes, semantic findings, code checks, request use, token totals, and latency by role in `baseline-analysis.md`.

## Result

Run `24eb3bcf-ad26-43ad-a740-56e756994430` completed all 96 trials using 410/1,500 requests: Agent 282, calibration 32, and judge 96. V19 calibration passed 32/32, including validation 16/16. All trials passed code and semantic checks; all 32 cases passed three of three repetitions. The judge recorded zero factual contradictions, unsupported facts, false-execution claims, or required-fact omissions. There were zero network failures and budget denials. The 16 held-out Agent cases were untouched.

The local report is `.data/evals/runs/24eb3bcf-ad26-43ad-a740-56e756994430/report.md`; summary metrics and runtime data are in `baseline-analysis.md`.
