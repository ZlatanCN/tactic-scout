# 63 · Triage v19 held-out findings without tuning on the exposed split

**What to build:** Reproduce and classify the v19 held-out failures using development cases, then prepare a replacement held-out split before measuring any changed agent or judge.

**Blocked by:** None.

**Status:** resolved

## Context

The v19 held-out run `ccc52335-f8ec-4ae1-8c44-96eec0afe682` is complete but failed the agreed gate. The 16-case split is now exposed; do not edit its expectations to make the report pass or use its outputs for parameter tuning. See `.scratch/agent-evaluation/baseline-analysis.md` and the ignored local JSON report for exact evidence.

## Triage targets

- `compare-add-raphinha-heldout-v1`: all three trials omitted the expected Understat Raphinha record. Reproduce with development fixtures and determine whether the case's expected source scope conflicts with the inherited Bundesliga condition before filing an agent defect.
- `lookup-kane-followup-heldout-v1`: all three trials failed the scripted clarification contract; one answer mislabeled 447 minutes as appearances. Reproduce the continuation and source-field labeling behavior on development data.
- `recommend-refine-young-isak-heldout-v1`: all three trials dropped the expected PA ceiling and result limit from effective final-turn constraints. Reproduce the request patch and constraint inheritance behavior on the development split.
- `compare-season-add-van-dijk-heldout-v1`: one repetition omitted a required fact. Determine whether this is a response-quality defect or case-contract issue using the development split.
- One judge result was invalid because its quote did not match the answer and it included unsupported-fact allegations. Reproduce judge output validation on development examples; do not count those allegations as valid findings.

## Acceptance

- Every failure cluster is classified as an agent defect, evaluator/case-contract mismatch, judge defect, or unreproduced stochastic result, with evidence from development data.
- Any confirmed agent or judge changes receive regression coverage and are evaluated on development cases only.
- The current held-out case set, evidence, and outcomes remain unchanged as historical exposed evidence.
- Before measuring changed behavior, select and document a replacement held-out split with no overlap by scenario family/evidence group, freeze implementation and scoring, and obtain a new explicit request allowance.
- Do not claim the v19 held-out quality gate passed; only a later replacement-split evaluation can establish a new held-out result.

## Classification

- **Raphinha comparison — case-contract mismatch.** The first turn explicitly asks for 2026/27 Bundesliga data. The recorded second-turn tool input preserves `competition=Bundesliga` and `seasonStartYear=2026`; Raphinha has no Understat row in that scope, so the comparator correctly returns none for him. The case's expected action incorrectly requires his La Liga Understat source record. Development case `compare-season-resume-add-synthetic-v1` passed 3/3 in the v19 development run, and `tests/comparison-conditions.test.ts` covers comparison-scope filtering. The exposed case remains unchanged.
- **Kane follow-up — case-script mismatch plus one unreproduced answer error.** In all three trials, the first lookup succeeded and the next turn reused the saved result. The final turn names an unavailable player; the graph correctly interrupted for identity clarification, but the case supplied no resume answer. The analogous development workflow `lookup-identity-clarification-v1` passed 3/3. One of the three held-out answers also mislabeled 447 minutes as appearances. In the v19 development report, the comparable `lookup-smoke-v1`, `lookup-followup-smoke-v1`, and `lookup-identity-clarification-v1` answers labeled the values as playing time (for example, “出场 840 分钟”); each case passed 3/3 semantic trials. The v19 development baseline also had zero confirmed factual contradictions, so this isolated generation error was not reproduced and did not justify a prompt change.
- **Isak recommendation filters — case-contract mismatch.** All three held-out `recommend_player_candidates` inputs contain `minimumPotentialAbility=154` and `resultLimit=20` on the final turn. The failed check compared them with generic `request.constraints`, although recommendation filters live in `request.recommendation` / `effectiveConditions` and are already checked at the executed tool-input seam. The development cases `recommend-add-refine-synthetic-v1` and `recommend-kane-real-v1` both passed 3/3 and cover refinement, PA, and result-limit behavior. No agent filter loss was found; the exposed case's expected check remains unchanged.
- **Van Dijk comparison — unreproduced semantic omission.** One repetition was flagged for a missing required fact; the other two passed. The similar development comparison case `compare-season-resume-add-synthetic-v1` passed 3/3. No prompt or agent change was made from one exposed trial.
- **Invalid judge output — expected invalidation.** The judge emitted a quote absent from its answer and the evaluator marked the result invalid. `tests/evaluation-runner.test.ts` already verifies this behavior. The unsupported-fact allegations in that invalid output are not accepted findings.

No agent or judge behavior change was justified by the development evidence, so this triage made no source-code changes and dispatched no live model requests. The held-out report remains failed and unchanged. Before any future live measurement of changed behavior, create a replacement held-out split and obtain a new request allowance.
