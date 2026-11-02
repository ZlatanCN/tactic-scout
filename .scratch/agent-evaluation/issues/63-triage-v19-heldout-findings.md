# 63 · Triage v19 held-out findings without tuning on the exposed split

**What to build:** Reproduce and classify the v19 held-out failures using development cases, then prepare a replacement held-out split before measuring any changed agent or judge.

**Blocked by:** None.

**Status:** open
**Label:** ready-for-agent

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
