# 21: Retry the development baseline after gateway recovery

**What to build:** A complete post-fix 32-case development baseline with qualified v8 semantic scoring, preserving all 96 trials and a valid judge calibration report.

**Blocked by:** External gateway hostname resolution.

**Status:** open
**Labels:** needs-info

- [ ] Confirm the configured gateway can resolve and reach `chatgpt.com` before dispatch.
- [ ] Rerun the unchanged 32-case development split with three isolated trials per case and the v8 judge.
- [ ] Preserve the first partial report and the retry as separate runs; do not overwrite or cherry-pick trials.
- [ ] Keep cumulative model use for this retry within the remaining 1,266 requests of the previously authorized 1,500-request budget.
- [ ] Record all trial, network, judge, and calibration outcomes; do not compute semantic rates if calibration is incomplete.

## Evidence

The first post-fix attempt, `fa75f1c4-fad2-4945-b409-092b782cb058`, attempted all 96 trials but ended partial after 234/1,500 requests (233 agent, 1 calibration, 0 judge), with eight network failures. The v8 calibration stopped on its first anchor with a 502 caused by DNS `ENOTFOUND chatgpt.com`; no semantic trial was adjudicated. A local DNS check still returned `ENOTFOUND` after the run. The report is preserved under `.data/evals/runs/fa75f1c4-fad2-4945-b409-092b782cb058/`.
