# 36 · Calibrate judge v10 and refresh the development baseline

**What to build:** Run the 32-anchor v10 calibration, then the fixed-evidence development split and review the refreshed per-turn judge results before considering any held-out run.

**Blocked by:** None.

**Status:** resolved

## Result

Run `d5ae61a1-4dc7-466b-bdab-11b045b96f9e` completed all 96 development trials using 397/1,500 requests: 269 Agent, 32 Calibration, and 96 Judge. V10 calibration passed all 32 anchors, including 16/16 reserved validation anchors. There were no budget denials or network failures. The held-out split was not run.

The report is `.data/evals/runs/d5ae61a1-4dc7-466b-bdab-11b045b96f9e/report.md`. It recorded 90 passed and six failed trials; semantic review found 92 passes, two failures, and two inconclusive judgments. Four deterministic failures came from player-based recommendations being classified as team recommendations, and two semantic failures came from over-scoping an empty lookup result to La Liga. Issues 37–39 fix these findings; another live evaluation is tracked in issue 40.
