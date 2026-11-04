# V22 replacement held-out pack

This 16-case pack replaces the exposed v21 attempt. It contains four cases for each workflow, with one ordinary, one boundary, and two multi-turn cases per workflow. Twelve cases use new local FM and Understat source records; four use a new synthetic API-Football roster fixture.

The v22 player mentions, provider source IDs, evidence groups, scenario families, and team IDs do not overlap the development, v1-v21 held-out, or exposed v21 packs. `tests/replacement-v22-pack.test.ts` checks those boundaries and saved-result identity reuse.

Prepare the real-source evidence locally, copy the versioned team fixture to the same evidence directory, and preview before dispatch:

```sh
node --import tsx evals/prepare-local-evidence.ts \
  --case-directory evals/replacements/v22/cases \
  --case v22-lookup-beier-profile \
  --case v22-lookup-asllani-pa-boundary \
  --case v22-lookup-tigges-saved-season \
  --case v22-lookup-lemperle-saved-xa \
  --case v22-compare-beier-asllani-common \
  --case v22-compare-beier-delap-no-common \
  --case v22-compare-add-delap-inherited-scope \
  --case v22-compare-add-tigges-same-scope \
  --case v22-recommend-beier-similar-stc \
  --case v22-recommend-beier-high-pa \
  --case v22-recommend-beier-refine-pa-limit \
  --case v22-recommend-add-reference-beier-asllani \
  --output .data/evals/v22-evidence

cp evals/evidence/replacement-v22-team-synthetic.json \
  .data/evals/v22-evidence/replacement-v22-team-synthetic.json

node --import tsx evals/cli.ts preview \
  --mode held_out \
  --judge \
  --case-directory evals/replacements/v22/cases \
  --evidence-directory .data/evals/v22-evidence
```

Use the preview's exact `freezeFingerprint` as `--freeze-id`. The preview reserves up to three attempts for each of 32 calibration anchors and each of 48 trial judgments. The conservative estimate is 834 model requests.

```sh
node --import tsx evals/cli.ts run \
  --mode held_out \
  --judge \
  --freeze-id <freezeFingerprint> \
  --case-directory evals/replacements/v22/cases \
  --evidence-directory .data/evals/v22-evidence \
  --max-model-requests 900
```

The pack remains blind until the full frozen run begins. After its results are used for tuning, mark it exposed and prepare a new replacement set for the next formal gate.
