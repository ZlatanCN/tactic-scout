# 21: Complete the corrected development baseline

**What to build:** A complete post-fix 32-case development baseline using the corrected case contracts, with qualified v8 semantic scoring and all 96 trials preserved.

**Blocked by:** 22: Correct development case contracts exposed by the baseline.

**Status:** resolved
**Labels:** ready-for-agent

- [x] Confirm the configured gateway is reachable; the v8 smoke completed after the earlier DNS failure.
- [x] Rerun the corrected 32-case development split with three isolated trials per case and the v8 judge.
- [x] Preserve the partial attempt and prior completed run as separate reports; do not overwrite or cherry-pick trials.
- [x] Keep cumulative model use within the remaining 871 requests of the previously authorized 1,500-request total.
- [x] Record all trial, network, judge, and calibration outcomes; do not compute semantic rates if calibration is incomplete.

## Evidence

The first post-fix attempt, `fa75f1c4-fad2-4945-b409-092b782cb058`, attempted all 96 trials but ended partial after 234/1,500 requests (233 agent, 1 calibration, 0 judge), with eight transport failures. The evaluator logged `ENOTFOUND chatgpt.com` while making an upstream request; that identifies a failed request path, not a failure of the gateway service itself. No semantic trial was adjudicated. Run `fe4f12b0-747c-46e9-90de-26c1ab83c6c0` completed 96 trials and passed v8 validation 16/16, but its case-contract mismatches were corrected in issue 22. Corrected run `dc3c8927-7426-490a-b99b-abd19231554c` then completed all 96 trials using 399/871 requests (271 agent, 32 calibration, 96 judge), with zero denied requests and seven transport failures recorded by the local evaluation proxy. V8 calibration passed 16/16. Of 96 trials, 82 passed, 13 failed, and one had an invalid judge output; 93 received semantic pass/fail judgments, two were inconclusive, and one was invalid. Among the 93 adjudicated trials, there was one factual contradiction, zero unsupported factual additions, and zero false execution claims. Twenty-four cases passed all three repetitions. Across the two earlier runs and corrected run, 1,028/1,500 authorized requests were used; 472 remained.

The report is local at `.data/evals/runs/dc3c8927-7426-490a-b99b-abd19231554c/report.md`. It records seven upstream transport attempts with no HTTP response; this does not identify the gateway service as the source of those failures. The held-out split remains untouched.
