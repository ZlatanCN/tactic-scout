# V29 replacement held-out pack

Status: prepared, not yet run against a live model.

This 16-case pack covers four workflows, with 12 real-source cases and 4 synthetic team-roster cases. The real cases use new names, FM/Understat IDs, source-evidence bundle, and scenario families. `v29-lookup-dayot-profile` deliberately uses “Dayot Upamecano” from FM while the linked Understat row displays “Dayotchanculle Upamecano”; the Reep bridge links the two IDs.

The data rules are fixed in every case: Understat supplies season-scoped performance; FM supplies the dated ability snapshot; age is recalculated from birth date as of `2026-11-04`, separately from the FM snapshot date.

Prepare the 12 real cases and copy the synthetic roster fixture:

```sh
pnpm eval:prepare-evidence \
  --case-directory evals/replacements/v29/cases \
  --case v29-lookup-dayot-profile \
  --case v29-lookup-chabot-appearances \
  --case v29-lookup-tavernier-saved-season \
  --case v29-lookup-gross-saved-xa \
  --case v29-compare-carvajal-gimenez-common-la-liga \
  --case v29-compare-dayot-tavernier-no-common-scope \
  --case v29-compare-add-bruno-inherited-epl \
  --case v29-compare-add-thuram-same-serie-a \
  --case v29-recommend-chabot-similar-dc \
  --case v29-recommend-dayot-under-21-pa \
  --case v29-recommend-tavernier-refine-age-ca \
  --case v29-recommend-add-dayot-reference \
  --output .data/evals/v29-evidence

cp evals/evidence/replacement-v29-team-synthetic.json \
  .data/evals/v29-evidence/replacement-v29-team-synthetic.json
```

Preview all 16 cases before dispatch. The current estimate is 834 model requests, including judge calibration; the approved ceiling is 900. Run the held-out evaluation once with its exact freeze fingerprint. Any tuning based on V29 results exposes the pack.
