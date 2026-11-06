# V40 held-out replacement pack

Status: prepared; not yet run against the live model.

V40 contains 16 held-out cases: 12 fixed real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. Player mentions, canonical identities, provider source IDs, and synthetic roster identities are new compared with V1–V39. The fixed age-as-of date is `2026-11-04`.

The pack covers an accent-insensitive spelling (`Jorgen Strand Larsen` for `Jørgen Strand Larsen`), saved-result reuse with a pronoun-free follow-up, a three-player La Liga comparison, cross-competition comparison, single-reference and multi-reference recommendations, age/CA boundary filters, and team-roster refinement. Recommendation result IDs and order were independently calculated from the documented FM feature lists and Reep-linked exclusions; the calculation did not call the production recommendation function. Each explicit league in a comparison message was checked against that turn's expected competition and tool input.

V39 is exposed because its EPL case kept a stale Bundesliga expected condition from the source template. V40 uses new identities, source IDs, and synthetic team IDs after that exposure. Local fixed evidence is in `.data/evals/v40-evidence`; real provider data and reports stay local.

The current preview reports 16/16 evidence bundles ready, 48 trials, and 753 estimated model requests. The 900-request limit is authorized. After committing all source and case files, copy the preview's `freezeFingerprint` into `--freeze-id` for both preview and run:

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --case-directory evals/replacements/v40/cases \
  --evidence-directory .data/evals/v40-evidence \
  --judge

node --import tsx evals/cli.ts run \
  --mode held_out \
  --case-directory evals/replacements/v40/cases \
  --evidence-directory .data/evals/v40-evidence \
  --freeze-id <preview-fingerprint> \
  --judge \
  --max-model-requests 900 \
  --output .data/evals/v40-heldout-runs
```

A partial or failed V40 run exposes the pack; it cannot be rerun for acceptance after tuning.
