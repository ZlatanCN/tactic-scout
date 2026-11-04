# V24 replacement held-out pack

Status: authored and not run against a live model.

The 16 cases cover all four workflows, with four cases each and the usual ordinary, boundary, and multi-turn mix. Twelve cases use distinct real FM/Understat source records; four use a new synthetic API-Football roster fixture. The case names, evidence bundle IDs, source IDs, scenario families, and team/player IDs are independent from the development set and exposed v20-v23 packs. `tests/replacement-v24-pack.test.ts` enforces those boundaries and verifies the saved-result statuses.

V24 corrects the two case-contract mistakes found in v23: the comparison input records the user-facing competition text (`La Liga`) while evidence metadata retains Understat's internal `La_liga` key, and saved-result follow-ups expect `saved_result_reuse` after a first-turn identity resolution. It also covers stable ordering when a new recommendation reference is added.

Prepare the frozen real-source bundle and copy the synthetic team fixture:

```sh
pnpm eval:prepare-evidence \
  --case-directory evals/replacements/v24/cases \
  --case v24-lookup-baena-profile \
  --case v24-lookup-pepe-pa-pronoun-boundary \
  --case v24-lookup-gueye-saved-season \
  --case v24-lookup-oyarzabal-saved-xa \
  --case v24-compare-baena-pepe-common-la-liga \
  --case v24-compare-baena-caci-no-common-scope \
  --case v24-compare-add-caci-inherited-la-liga-scope \
  --case v24-compare-add-gueye-same-la-liga-scope \
  --case v24-recommend-baena-similar-amc \
  --case v24-recommend-baena-under-18-pa-boundary \
  --case v24-recommend-pepe-refine-age-ca \
  --case v24-recommend-add-oyarzabal-reference \
  --output .data/evals/v24-evidence

cp evals/evidence/replacement-v24-team-synthetic.json \
  .data/evals/v24-evidence/replacement-v24-team-synthetic.json
```

Preview all 16 cases, confirm every evidence status is `ready`, then freeze the printed fingerprint:

```sh
pnpm eval:preview \
  --mode held_out \
  --judge \
  --case-directory evals/replacements/v24/cases \
  --evidence-directory .data/evals/v24-evidence
```

Run the final gate using the preview's exact `freezeFingerprint` and the 900-request ceiling:

```sh
pnpm eval:run \
  --mode held_out \
  --judge \
  --freeze-id <freezeFingerprint> \
  --case-directory evals/replacements/v24/cases \
  --evidence-directory .data/evals/v24-evidence \
  --max-model-requests 900 \
  --output .data/evals/v24-heldout-runs
```

Once the run starts, treat v24 as exposed. Do not tune against it and then reuse it as another blind acceptance set.
