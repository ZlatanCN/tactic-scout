# 62 · Freeze v19 thresholds and run held-out evaluation

**What to build:** Apply the development-derived v19 acceptance thresholds to the 16-case held-out split using a frozen, committed agent and scoring configuration.

**Blocked by:** None.

**Status:** open
**Label:** ready-for-human

## Thresholds for this benchmark cycle

The canonical quality gate and its rationale are recorded in `plan.md` under “V19 held-out threshold decision.” This ticket tracks applying that gate to the held-out split. Do not tune against held-out outputs; if results inform later changes, record that exposure and reserve a new held-out set for the next cycle.

## Acceptance

- Freeze the evaluated source/scoring revision before held-out dispatch.
- Preview the exact 16-case held-out set, evidence hashes, model identities, freeze fingerprint, and request estimate.
- Obtain an explicit whole-run physical model-request allowance before dispatch.
- Preserve all 48 trial artifacts and update `baseline-analysis.md` with outcomes, rates, denominators, stability, and runtime metrics.

## Frozen preview

- Frozen commit: `1fdb3b224e4eb2e0ba2bbd8c6ab56b68edc7c78f`.
- Split: 16 held-out cases, 48 trials, 4 workflows, 3 repetitions each.
- Judge calibration: 32 anchors, 16 reserved validation anchors.
- Freeze fingerprint: `scouting-eval-v1-d0bc33ef653e991ef16306cbd8438ca766c1d969691e0137cb618ea3e59ee10c`.
- Estimated physical model requests: 755; a separate explicit whole-run cap is still required.
- Preview with the fingerprint reports `heldOutFreezeReady: true`. No held-out request has been dispatched.
