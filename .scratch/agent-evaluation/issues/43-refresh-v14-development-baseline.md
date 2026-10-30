# 43 · Refresh the v14 development baseline

**What to build:** Run the frozen 32-case development split with three trials per case using the v14 judge, after its calibration and targeted smoke passed.

**Blocked by:** None.

**Status:** resolved

## Result

V14 development run `0b187e75-be68-490f-bd0b-a6f2835c70c4` completed all 96 trials using 402/1,500 requests: Agent 274, Calibration 32, and Judge 96. Calibration passed 32/32, including 16/16 reserved validation anchors. There were zero budget denials and zero network failures. Trial status was 90 passed and six failed; semantic status was 90 passed, five failed, and one invalid. The v14 run report is `.data/evals/runs/0b187e75-be68-490f-bd0b-a6f2835c70c4/report.md`; the 16 held-out cases remain untouched. Issues 44–48 record the follow-up fixes.
