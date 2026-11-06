# V41 held-out replacement pack

Status: prepared; not yet run against the live model.

V41 contains 16 held-out cases: 12 fixed real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. Player mentions, canonical identities, provider source IDs, and synthetic roster identities are new compared with V1–V40. The fixed age-as-of date is `2026-11-04`.

The pack covers an accentless `Pierre-Emile Hojbjerg` lookup against source spelling `Pierre-Emile Højbjerg`, saved-result reuse with a pronoun-free follow-up, a three-player La Liga comparison, cross-competition comparison, single-reference and multi-reference recommendations, age/CA filters, and team-roster refinement. Comparison cases with an explicit competition were checked so their expected constraint and tool argument match the user text. Recommendation result IDs and order were independently calculated from the documented FM feature lists and Reep-linked exclusions; the calculation did not call the production recommendation function.

V40 was exposed after the live graph failed to resolve `Jorgen` to `Jørgen`. The runtime normalizer now handles common one-to-one Latin variants such as `ø`/`o`, and a SQLite regression confirms two separate Reep IDs remain separate after name matching. V41 uses new identities, provider IDs, and synthetic teams after that exposure. Local fixed evidence is in `.data/evals/v41-evidence`; real provider data and reports stay local.

The current preview reports 16/16 evidence bundles ready, 48 trials, and 753 estimated model requests. The 900-request limit is authorized. After committing all source and case files, copy the preview's `freezeFingerprint` into `--freeze-id` for both preview and run:

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --case-directory evals/replacements/v41/cases \
  --evidence-directory .data/evals/v41-evidence \
  --judge

node --import tsx evals/cli.ts run \
  --mode held_out \
  --case-directory evals/replacements/v41/cases \
  --evidence-directory .data/evals/v41-evidence \
  --freeze-id <preview-fingerprint> \
  --judge \
  --max-model-requests 900 \
  --output .data/evals/v41-heldout-runs
```

A partial or failed V41 run exposes the pack; it cannot be rerun for acceptance after tuning.
