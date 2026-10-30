# 41 · Calibrate v12 after adding exact judge action inputs

**What to build:** Validate the v12 judge prompt and exact action-input evidence against the previous Mbappé false finding, while smoke-testing the corrected player recommendation routes.

**Blocked by:** None.

**Status:** open
**Label:** ready-for-human

## Evidence

V11 smoke `57d3f600-a776-49eb-8ec9-d84372ef6f81` passed 4/5 cases. The remaining Mbappé finding said the answer's “not filtered by La Liga” claim was unsupported because the judge input lacked the search tool's actual parameters. The graph and offline source-mapping tests now provide action inputs; judge prompt v12 directs the judge to inspect them.

## Acceptance

- Preview a bounded subset containing the Mbappé lookup, player-based recommendation, explicit team recommendation, and multi-turn comparison.
- Use a new explicit physical-request allowance.
- Require all 16 reserved v12 validation anchors to pass before interpreting semantic scores.
- Preserve v10 and v11 reports, and keep held-out cases untouched.
