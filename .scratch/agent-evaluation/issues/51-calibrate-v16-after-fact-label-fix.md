# 51 · Calibrate v16 after required-fact label fix

**What to build:** Re-run the bounded failure-focused smoke under the v16 judge after adding user-facing labels for required facts.

**Blocked by:** None.

**Status:** open
**Label:** ready-for-human

## Evidence

V15 smoke passed all 16 reserved validation anchors and four of five semantic trials. Its remaining failure was a judge false omission for `currentAbility=139`, which the answer rendered as “当前能力 139.” V16 changes only the judge's fact-label equivalence rules; it has not been sent to the gateway.

## Acceptance

- Preview the same five-case smoke and record the exact request estimate.
- Use a fresh explicit whole-run request allowance.
- Require all 16 reserved v16 validation anchors to pass.
- Confirm that all five smoke cases pass deterministic and semantic review; preserve all older reports and leave held-out cases untouched.
