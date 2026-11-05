# V30 replacement held-out pack

Status: prepared, not yet run against a live model.

This pack contains 16 independent cases across the four workflows: 12 real-source cases and 4 synthetic team-roster cases. `v30-lookup-waldschmidt-profile` checks a linked source-name variant (FM “Luca Waldschmidt”, Understat “Gian-Luca Waldschmidt”). The pack test also verifies that every resolved provider ID appears in the corresponding expected tool action.

Understat supplies only performance fields for its exact competition and season. FM supplies fixed CA, PA, natural positions, and attributes. Age is calculated from birth date as of each case's fixed `ageAsOfDate` (`2026-11-04`), separately from the FM snapshot date.

Prepare the 12 real cases and copy the synthetic team fixture:

```sh
pnpm eval:prepare-evidence \
  --case-directory evals/replacements/v30/cases \
  --case v30-lookup-waldschmidt-profile \
  --case v30-lookup-king-appearances \
  --case v30-lookup-raba-saved-season \
  --case v30-lookup-dara-saved-xa \
  --case v30-compare-luca-ronnow-common-bundesliga \
  --case v30-compare-luca-vasquez-no-common-scope \
  --case v30-compare-add-yehor-inherited-epl \
  --case v30-compare-add-maldini-serie-a \
  --case v30-recommend-king-similar-mc \
  --case v30-recommend-king-under-21-pa \
  --case v30-recommend-king-refine-age-ca \
  --case v30-recommend-add-yehor-reference \
  --output .data/evals/v30-evidence

cp evals/evidence/replacement-v30-team-synthetic.json \
  .data/evals/v30-evidence/replacement-v30-team-synthetic.json
```

Preview all cases before dispatch. The estimate is 834 physical model requests for 48 trials plus judge calibration; the approved ceiling is 900. Run once with the exact preview fingerprint. Any tuning based on V30 findings exposes the pack.

```sh
pnpm eval:run \
  --mode held_out \
  --judge \
  --freeze-id <freezeFingerprint> \
  --case-directory evals/replacements/v30/cases \
  --evidence-directory .data/evals/v30-evidence \
  --max-model-requests 900 \
  --output .data/evals/v30-heldout-runs
```
