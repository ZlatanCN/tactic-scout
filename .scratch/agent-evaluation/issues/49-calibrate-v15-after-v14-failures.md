# 49 · Calibrate v15 after the V14 baseline findings

**What to build:** Run a bounded v15 smoke over the V14 failure cases after the alias, season, attribute, result-limit, and empty-lookup fixes.

**Blocked by:** None.

**Status:** open
**Label:** ready-for-human

## Evidence

The V14 baseline completed all 96 trials but had one deterministic same-identity alias failure, five semantic failures, and one invalid judge output. Issues 44–48 now have offline regressions for these findings. V15 has not been sent to the configured gateway.

## Acceptance

- Preview and run a targeted smoke covering same-identity aliases, latest-season follow-up, comparison attribute labels, recommendation result limits, and empty Understat lookup wording.
- Use a fresh explicit whole-run physical request allowance.
- Require all 16 reserved V15 validation anchors to pass before interpreting semantic scores.
- Preserve all earlier reports and keep held-out cases untouched.
