# V27 replacement held-out pack

Status: prepared, not yet run against a live model.

This pack contains 16 cases, balanced across the four workflows. It uses new player identities and source records for the real-data cases and a new synthetic API-Football roster fixture for team recommendations. Its cases were not used for earlier model tuning.

The source boundary is explicit: the fixed FM snapshot supports CA, PA, natural positions, and attributes. Understat supports only the performance fields returned for its specific competition and season. Current registration, injuries, availability, transfer status, and other time-sensitive facts require a source that actually covers the requested period; FM cannot substantiate them.

Prepare the 12 real-data cases and copy the synthetic team fixture into the ignored local evidence directory:

```sh
pnpm eval:prepare-evidence \
  --case-directory evals/replacements/v27/cases \
  --case v27-lookup-canales-profile \
  --case v27-lookup-berenguer-pa-pronoun-boundary \
  --case v27-lookup-mikautadze-saved-season \
  --case v27-lookup-buonanotte-saved-xa \
  --case v27-compare-canales-berenguer-common-la-liga \
  --case v27-compare-canales-scally-no-common-scope \
  --case v27-compare-add-scally-inherited-la-liga-scope \
  --case v27-compare-add-mikautadze-same-la-liga-scope \
  --case v27-recommend-berenguer-similar-amr \
  --case v27-recommend-berenguer-under-16-pa-boundary \
  --case v27-recommend-berenguer-refine-age-ca \
  --case v27-recommend-add-berenguer-reference \
  --output .data/evals/v27-evidence

cp evals/evidence/replacement-v27-team-synthetic.json \
  .data/evals/v27-evidence/replacement-v27-team-synthetic.json
```

The current local evidence and case hashes preview as ready and estimate 834 model requests for the 48-trial held-out run, including judge calibration. Run only after the source and scoring revision is frozen. Preserve the report and do not reuse this split for tuning if any held-out finding changes the implementation.
