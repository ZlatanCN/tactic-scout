# V25 replacement held-out pack

Status: authored and not run against a live model.

This 16-case pack covers four workflows, with four cases per workflow. It uses new player identities and provider records plus a new synthetic API-Football roster fixture, all independent of the development and exposed v20-v24 sets. The saved xA follow-up asks “What xA did Understat report?” to verify that a source name does not become a player identity and the graph reuses the saved result.

Prepare fixed local evidence and the synthetic roster bundle:

```sh
pnpm eval:prepare-evidence \
  --case-directory evals/replacements/v25/cases \
  --case v25-lookup-guedes-profile \
  --case v25-lookup-becker-pa-pronoun-boundary \
  --case v25-lookup-petkov-saved-season \
  --case v25-lookup-giuliano-saved-xa \
  --case v25-compare-guedes-barrenetxea-common-la-liga \
  --case v25-compare-guedes-becker-no-common-scope \
  --case v25-compare-add-becker-inherited-la-liga-scope \
  --case v25-compare-add-giuliano-same-la-liga-scope \
  --case v25-recommend-guedes-similar-stc \
  --case v25-recommend-guedes-under-16-pa-boundary \
  --case v25-recommend-barrenetxea-refine-age-ca \
  --case v25-recommend-add-riquelme-reference \
  --output .data/evals/v25-evidence

cp evals/evidence/replacement-v25-team-synthetic.json \
  .data/evals/v25-evidence/replacement-v25-team-synthetic.json
```

If the source snapshot produces a different bundle hash, update `evidenceBundleSha256` in the corresponding versioned cases. Preview the full set and confirm all 16 cases are ready before freezing:

```sh
pnpm eval:preview \
  --mode held_out \
  --judge \
  --case-directory evals/replacements/v25/cases \
  --evidence-directory .data/evals/v25-evidence
```

Run with the preview's exact `freezeFingerprint` and the 900-request ceiling:

```sh
pnpm eval:run \
  --mode held_out \
  --judge \
  --freeze-id <freezeFingerprint> \
  --case-directory evals/replacements/v25/cases \
  --evidence-directory .data/evals/v25-evidence \
  --max-model-requests 900 \
  --output .data/evals/v25-heldout-runs
```
