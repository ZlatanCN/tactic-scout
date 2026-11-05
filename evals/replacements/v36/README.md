# V36 held-out replacement pack

Status: prepared; no V36 model requests have started.

The pack contains 16 cases: 12 real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. Case IDs, scenario families, player mentions, canonical Reep identities, provider source IDs, and synthetic roster data are new compared with V1–V35. The age calculation date is fixed at `2026-11-04`.

V35 was exposed after a partial run. Its two failed trials involved “Janik Haberer's”: the possessive form reached identity matching as though it were a different name. Request extraction now strips a terminal `'s` or `’s` from the extracted player mention and lookup-name override before identity resolution. Offline regression tests cover both forms, and V36 includes a real-source query for “Konrad Laimer's” to check the fix in the full graph.

The remaining real cases cover saved-result follow-ups, same-scope and cross-scope comparisons, adding a comparison participant, age/CA-filtered recommendations, and adding a recommendation reference while retaining its position and limit. Four new synthetic team cases cover roster mapping, clarification, filter refinement, and safe stopping.

Local evidence is in `.data/evals/v36-evidence/`. Preview reports 16/16 bundles ready and estimates 798 physical model requests for the 48 trials, three repetitions per case, and judge calibration. The existing 900-request limit is sufficient. Commit the final code and case set before the final preview, then use its exact fingerprint in the run command.

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --case-directory evals/replacements/v36/cases \
  --evidence-directory .data/evals/v36-evidence \
  --freeze-id <preview-fingerprint> \
  --judge

node --import tsx evals/cli.ts run \
  --mode held_out \
  --case-directory evals/replacements/v36/cases \
  --evidence-directory .data/evals/v36-evidence \
  --freeze-id <preview-fingerprint> \
  --judge \
  --max-model-requests 900 \
  --output .data/evals/v36-heldout-runs
```

A partial or failed V36 report exposes the pack; it cannot be rerun for acceptance after tuning.
