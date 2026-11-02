# 62 · Freeze v19 thresholds and run held-out evaluation

**What to build:** Apply the development-derived v19 acceptance thresholds to the 16-case held-out split using a frozen, committed agent and scoring configuration.

**Blocked by:** None.

**Status:** resolved

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
- Estimated physical model requests: 755; preview reported `heldOutFreezeReady: true`.
- Approved allowance: 900 total physical requests for this held-out cycle.

## Result

- The evaluated revision was `7ec7b40fe74fbbb9fb8a0a9de88ddbf362e3562d`, matching the frozen fingerprint above.
- Initial run `263adf91-fea6-454a-9cba-2fd7f72363ad` completed the 48 Agent trials, then stopped after a judge-anchor timeout at 29/32. It used 195 requests and did not score trials.
- Startup attempt `f3ad5e99-5b7b-4c00-ae45-4e22d5ed256b` failed before dispatch and used 0 requests.
- Completed frozen rerun `ccc52335-f8ec-4ae1-8c44-96eec0afe682`: 48/48 trials, 32/32 anchors, 251/705 requests (171 Agent, 32 calibration, 48 Judge), 3 network failures, 0 budget denials, and 0 unfinished trials. Cumulative dispatched requests across both runs: 446/900.
- Calibration passed 32/32, including validation 16/16. The benchmark gate **failed**: 38/48 trials passed both layers; 10 failed deterministic checks; semantic review produced 40 pass, 2 fail, 5 inconclusive, and 1 invalid. Twelve of sixteen cases passed all three repetitions.
- The judge found 1 factual contradiction in 42 valid judgments, 0 confirmed unsupported facts, 0 false-execution claims, and 4 required-fact omissions. One invalid judgment made unsupported-fact allegations but failed quote validation; it is not counted as a valid semantic verdict.
- Runtime: 22m 43.7s. Request latency mean/p95: Agent 9.8s/8.8s, calibration 3.9s/7.3s, Judge 5.2s/8.2s. Reported tokens: Agent 974,231; calibration 191,031; Judge 1,337,271.
- The detailed outcomes, denominators, stability, runtime metrics, and failure clusters are recorded in `baseline-analysis.md`; the full trial report remains under ignored `.data/evals/runs/ccc52335-f8ec-4ae1-8c44-96eec0afe682/`.
- This split is now exposed. Do not use it to tune the agent or judge; create a replacement held-out split before evaluating changes. Issue 62 is resolved because the frozen measurement and gate application are complete, despite the gate not passing.
- Issue 63 tracks the development-only failure triage and replacement-split preparation.
