# 41 · Calibrate v13 after scoping judge action evidence

**What to build:** Validate the v13 judge prompt and exact action-input evidence against the previous Mbappé finding, while smoke-testing the corrected player recommendation routes.

**Blocked by:** None.

**Status:** resolved

## Result

V13 smoke `a449eed8-4bfe-4a1a-b459-fc0596ebaaa4` used 51/120 requests across five cases: 14 Agent, 32 Calibration, and 5 Judge. Calibration passed 32/32, including validation 16/16; four cases passed and the Mbappé lookup remained semantically failed. The judge treated the pre-interrupt `needs_confirmation` identity result as unresolved and objected to the abstention wording. This led to including resume answers and post-resume resolution state in judge input, and to tightening the empty-result response instruction.
