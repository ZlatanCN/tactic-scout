# V28 replacement held-out pack

Status: prepared, not run against a live model.

This pack has 16 cases across the four workflows: 12 real-data cases and 4 synthetic team-roster cases. Its player identities, provider IDs, teams, source bundle, and scenario families are independent of the previously exposed V20–V27 packs.

Source boundaries:

- The fixed FM snapshot provides CA, PA, natural positions, and attributes. It does not support current/seasonal performance, current registration, injuries, availability, or transfer status.
- Understat provides only the returned performance fields for its exact competition and season. It does not establish current registration or live status.
- Age is recalculated from birth date as of the case's fixed `ageAsOfDate` (`2026-11-04`). Ability and attributes continue to use the FM snapshot date (`2025-11-23`).

Prepare the 12 real cases and copy the synthetic team fixture:

```sh
pnpm eval:prepare-evidence \
  --case-directory evals/replacements/v28/cases \
  --case v28-lookup-vagnoman-profile \
  --case v28-lookup-joao-appearance-pa \
  --case v28-lookup-baku-saved-season \
  --case v28-lookup-gouiri-saved-xa \
  --case v28-compare-grimaldo-isco-common-la-liga \
  --case v28-compare-vagnoman-joao-no-common-scope \
  --case v28-compare-add-mbeumo-inherited-epl \
  --case v28-compare-add-luismi-same-la-liga \
  --case v28-recommend-conte-similar-amc \
  --case v28-recommend-cherki-under-21-pa \
  --case v28-recommend-joao-refine-age-ca \
  --case v28-recommend-add-morgan-reference \
  --output .data/evals/v28-evidence

cp evals/evidence/replacement-v28-team-synthetic.json \
  .data/evals/v28-evidence/replacement-v28-team-synthetic.json
```

Preview the complete held-out pack and require all evidence to be ready before dispatch. The current estimate is 834 model requests for 48 trials plus judge calibration; the previously approved ceiling is 900. Use the exact preview fingerprint and preserve the full report. If V28 findings cause another change, V28 becomes exposed and cannot be reused as a blind gate.

```sh
pnpm eval:run \
  --mode held_out \
  --judge \
  --freeze-id <freezeFingerprint> \
  --case-directory evals/replacements/v28/cases \
  --evidence-directory .data/evals/v28-evidence \
  --max-model-requests 900 \
  --output .data/evals/v28-heldout-runs
```
