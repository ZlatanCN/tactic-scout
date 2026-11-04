# V26 replacement held-out pack

Status: authored and not run against a live model.

This 16-case pack covers all four workflows, four cases per workflow, with new player identities, source IDs, scenario families, evidence bundle IDs, and a synthetic API-Football roster fixture. It does not reuse exposed v20-v25 cases. The local recommendation outputs were recomputed against the fixed FM snapshot and candidate pools.

Lookup source rules are explicit: Understat supplies season performance data such as appearances, minutes, goals, assists, xG, and xA; the fixed FM snapshot supplies CA, PA, natural positions, and attributes. The saved xA follow-up uses the exact phrase “What xA did Understat report?” and must reuse the saved lookup without treating Understat as a player.

The evidence preview now verifies that each required Understat ID exists in the case's declared competition and season in the prepared bundle. A scope mismatch is marked invalid before any model request.

Prepare fixed real-source evidence and copy the synthetic roster bundle:

```sh
pnpm eval:prepare-evidence \
  --case-directory evals/replacements/v26/cases \
  --case v26-lookup-karim-profile \
  --case v26-lookup-kubo-pa-pronoun-boundary \
  --case v26-lookup-hlozek-saved-season \
  --case v26-lookup-lemar-saved-xa \
  --case v26-compare-karim-kubo-common-la-liga \
  --case v26-compare-karim-hlozek-no-common-scope \
  --case v26-compare-add-hlozek-inherited-la-liga-scope \
  --case v26-compare-add-lemar-same-la-liga-scope \
  --case v26-recommend-karim-similar-stc \
  --case v26-recommend-karim-under-16-pa-boundary \
  --case v26-recommend-aspas-refine-age-ca \
  --case v26-recommend-add-lemar-reference \
  --output .data/evals/v26-evidence

cp evals/evidence/replacement-v26-team-synthetic.json \
  .data/evals/v26-evidence/replacement-v26-team-synthetic.json
```

If local snapshot hashes differ, update the case bundle hashes. Preview the full set; every case must report `ready` before dispatch:

```sh
pnpm eval:preview \
  --mode held_out \
  --judge \
  --case-directory evals/replacements/v26/cases \
  --evidence-directory .data/evals/v26-evidence
```

Run with the exact preview `freezeFingerprint` and a 900-request limit:

```sh
pnpm eval:run \
  --mode held_out \
  --judge \
  --freeze-id <freezeFingerprint> \
  --case-directory evals/replacements/v26/cases \
  --evidence-directory .data/evals/v26-evidence \
  --max-model-requests 900 \
  --output .data/evals/v26-heldout-runs
```
