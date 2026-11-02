# 62 · Freeze v19 thresholds and run held-out evaluation

**What to build:** Apply the development-derived v19 acceptance thresholds to the 16-case held-out split using a frozen, committed agent and scoring configuration.

**Blocked by:** None.

**Status:** claimed

## Thresholds for this benchmark cycle

The canonical quality gate and its rationale are recorded in `plan.md` under “V19 held-out threshold decision.” This ticket tracks applying that gate to the held-out split. Do not tune against held-out outputs; if results inform later changes, record that exposure and reserve a new held-out set for the next cycle.

## Acceptance

- Freeze the evaluated source/scoring revision before held-out dispatch.
- Preview the exact 16-case held-out set, evidence hashes, model identities, freeze fingerprint, and request estimate.
- Obtain an explicit whole-run physical model-request allowance before dispatch.
- Preserve all 48 trial artifacts and update `baseline-analysis.md` with outcomes, rates, denominators, stability, and runtime metrics.
