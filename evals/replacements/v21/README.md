# V21 replacement held-out pack

This 16-case pack replaces the exposed v20 held-out set. It has four cases for each workflow, with one ordinary, one boundary, and two multi-turn cases per workflow. Twelve cases use new local FM and Understat source records; four use a new synthetic API-Football roster fixture.

The v21 case IDs, scenario families, player mentions, provider source IDs, evidence bundle IDs, and synthetic team IDs do not overlap the development, v1-v19 held-out, or exposed v20 packs. `tests/replacement-v21-pack.test.ts` checks those boundaries and the saved-result identity contract.

Real-source evidence is prepared locally from the FM, Understat, and Reep snapshots. The generated bundle stays under ignored `.data/evals/v21-evidence/`. The synthetic team bundle is versioned at `evals/evidence/replacement-v21-team-synthetic.json`.

Prepare real evidence and preview all 16 cases before a live run:

```sh
node --import tsx evals/prepare-local-evidence.ts \
  --case-directory evals/replacements/v21/cases \
  --case v21-lookup-burkardt-profile \
  --case v21-lookup-malen-appearances \
  --case v21-lookup-scherhant-saved-season \
  --case v21-lookup-wirtz-saved-xa \
  --case v21-compare-burkardt-nkunku-common \
  --case v21-compare-burkardt-julian-no-common \
  --case v21-compare-add-julian-inherited-scope \
  --case v21-compare-add-yuito-inherited-scope \
  --case v21-recommend-burkardt-similar-stc \
  --case v21-recommend-burkardt-high-pa \
  --case v21-recommend-burkardt-refine-pa-limit \
  --case v21-recommend-burkardt-refine-age-limit \
  --output .data/evals/v21-evidence

cp evals/evidence/replacement-v21-team-synthetic.json \
  .data/evals/v21-evidence/replacement-v21-team-synthetic.json

node --import tsx evals/cli.ts preview \
  --mode held_out \
  --judge \
  --case-directory evals/replacements/v21/cases \
  --evidence-directory .data/evals/v21-evidence
```

Use the preview's exact `freezeFingerprint` as `--freeze-id`. The preview reserves up to three attempts for each of 32 calibration anchors and each of 48 trial judgments. The conservative estimate is 834 requests.

```sh
node --import tsx evals/cli.ts run \
  --mode held_out \
  --judge \
  --freeze-id <freezeFingerprint> \
  --case-directory evals/replacements/v21/cases \
  --evidence-directory .data/evals/v21-evidence \
  --max-model-requests 900
```

Do not use this pack for tuning after the formal run. Once its output informs code changes, it is exposed and the next formal gate requires a new replacement set.
