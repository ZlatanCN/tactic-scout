# 51 · Calibrate v16 after required-fact label fix

**What to build:** Re-run the bounded failure-focused smoke under the v16 judge after adding user-facing labels for required facts.

**Blocked by:** None.

**Status:** resolved

## Result

V16 smoke `b95369ba-89a3-4399-8720-b8045bb8492e` completed all five cases using 53/130 requests: Agent 16, Calibration 32, and Judge 5. All 32 calibration anchors passed, including validation 16/16. All five cases passed deterministic and semantic review; there were zero budget denials and network failures. Held-out cases were untouched.
