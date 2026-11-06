# V43 held-out replacement pack

Status: prepared; not yet run against the live model.

V43 contains 16 held-out cases: 12 fixed real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. Player mentions, canonical identities, provider source IDs, and synthetic roster identities are new compared with V1–V42. The fixed age-as-of date is `2026-11-04`.

The pack includes a deterministic result-limit case asking for “up to three players”, with its requested filter and independently calculated ranked candidates recorded as golden behavior. It also covers an unaccented spelling (`Benat Turrientes` for `Beñat Turrientes`), a pronoun-free saved-result follow-up, a three-player La Liga comparison, cross-competition comparison, age/CA filtering, and team-roster refinement. Recommendation result IDs and order were independently calculated from the fixed FM feature lists and Reep-linked exclusions, not from the production recommendation function.

V42 was exposed after the request extractor omitted an explicit result limit and relied on a default. The deterministic parser now recognizes explicit English and Chinese limits and has Vitest coverage. V43 uses new identities, provider IDs, and synthetic teams after that exposure. Local fixed evidence is in `.data/evals/v43-evidence`; real provider data and reports stay local.

The current preview reports 16/16 evidence bundles ready, 48 trials, and 753 estimated model requests. The 900-request limit is authorized. After committing all source and case files, copy the preview's `freezeFingerprint` into `--freeze-id` for both preview and run:

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --case-directory evals/replacements/v43/cases \
  --evidence-directory .data/evals/v43-evidence \
  --judge

node --import tsx evals/cli.ts run \
  --mode held_out \
  --case-directory evals/replacements/v43/cases \
  --evidence-directory .data/evals/v43-evidence \
  --freeze-id <preview-fingerprint> \
  --judge \
  --max-model-requests 900 \
  --output .data/evals/v43-heldout-runs
```

A partial or failed V43 run exposes the pack; it cannot be reused for acceptance after tuning.
