# 42 · Calibrate v14 after adding clarification state to judge input

**What to build:** Validate that v14 can adjudicate an identity-confirmed empty lookup and the previously corrected recommendation routes, without treating requested model arguments as executed filters.

**Blocked by:** None.

**Status:** open
**Label:** ready-for-human

## Evidence

V13 smoke `a449eed8-4bfe-4a1a-b459-fc0596ebaaa4` passed four of five cases but still failed the Mbappé lookup semantically. The judge saw the initial `needs_confirmation` action but not the resume answer that selected the candidate, and interpreted a cautious empty-result answer as an unsupported availability claim. V14 adds clarification answers and post-resume resolution state to each turn, and narrows the lookup instruction to report no rows without extrapolating metric availability.

## Acceptance

- Preview the same bounded five-case smoke and report the exact request estimate.
- Use a new explicit physical-request allowance.
- Require all 16 reserved v14 validation anchors to pass before interpreting semantic scores.
- Confirm the player-recommendation and team-recommendation routes, the empty Mbappé lookup, per-turn participant scope, and action-input filter evidence.
- Preserve the v10 development baseline and v11/v13 smoke reports; keep held-out cases untouched.
