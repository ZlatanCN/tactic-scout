# V38 held-out replacement pack

Status: prepared; not yet run against the live model.

V38 contains 16 held-out cases: 12 fixed real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. Player mentions, canonical identities, provider source IDs, and synthetic roster identities are new compared with V1–V37. The fixed age-as-of date is `2026-11-04`.

The pack covers an accent-insensitive spelling (`Fares Chaibi` for `Farès Chaïbi`), saved-result follow-up, a three-player La Liga comparison, cross-competition comparison, single-reference and multi-reference recommendations, and team roster refinement. Recommendation result IDs and order were independently calculated from the documented FM feature lists and Reep-linked exclusions; the calculation did not call the production recommendation function.

V37 is exposed because its team reference-count correction was edited while its run was active. V38 includes that correction in its frozen source revision. Local fixed evidence is in `.data/evals/v38-evidence`; real provider data and reports stay local.

Preview the prepared pack:

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --case-directory evals/replacements/v38/cases \
  --evidence-directory .data/evals/v38-evidence \
  --judge
```

The current preview reports 16/16 evidence bundles ready, 48 trials, and 753 estimated model requests. The 900-request limit is authorized. After committing all source and case files, copy the preview's `freezeFingerprint` into `--freeze-id` for both preview and run:

```sh
node --import tsx evals/cli.ts run \
  --mode held_out \
  --case-directory evals/replacements/v38/cases \
  --evidence-directory .data/evals/v38-evidence \
  --freeze-id <preview-fingerprint> \
  --judge \
  --max-model-requests 900 \
  --output .data/evals/v38-heldout-runs
```

A partial or failed run exposes V38. Do not tune against its output and reuse it for acceptance; prepare an independent pack instead.
