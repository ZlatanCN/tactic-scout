# V30 replacement held-out pack

Status: exposed; do not use as the acceptance pack.

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

The partial run `757ba2b1-6bf4-4308-bf0b-c82941eeb42f` stopped after 37 of 48 trials and 126 model requests. No judge calibration or semantic scoring ran. It exposed two case-contract problems: “Josh King” resolved to multiple identities and correctly requested clarification, while the case expected automatic resolution; the high-potential case's wording produced `resultLimit: 2` while its contract expected `1`. Those findings were used to prepare the independent V31 pack, so V30 cannot be reused as a held-out gate.
