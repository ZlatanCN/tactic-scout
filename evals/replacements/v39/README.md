# V39 held-out replacement pack

Status: prepared; not yet run against the live model.

V39 contains 16 held-out cases: 12 fixed real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. Player mentions, canonical identities, provider source IDs, and synthetic roster identities are new compared with V1–V38. The fixed age-as-of date is `2026-11-04`.

The pack covers an accent-insensitive spelling (`Niccolo Pisilli` for `Niccolò Pisilli`), a saved-result follow-up with no pronouns, a three-player La Liga comparison, cross-competition comparison, single-reference and multi-reference recommendations, age/CA boundary filters, and team-roster refinement. Recommendation result IDs and order were independently calculated from the documented FM feature lists and Reep-linked exclusions; the calculation did not call the production recommendation function.

V38 was exposed after an invalid saved-result follow-up used “his” while the contract expected pronoun-free reuse. V39 was authored with new player identities, provider source IDs, and synthetic team IDs after that exposure. Local fixed evidence is in `.data/evals/v39-evidence`; real provider data and reports stay local.

Preview the prepared pack:

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --case-directory evals/replacements/v39/cases \
  --evidence-directory .data/evals/v39-evidence \
  --judge
```

The current preview reports 16/16 evidence bundles ready, 48 trials, and 753 estimated model requests. The 900-request limit is authorized. After committing all source and case files, copy the preview's `freezeFingerprint` into `--freeze-id` for both preview and run:

```sh
node --import tsx evals/cli.ts run \
  --mode held_out \
  --case-directory evals/replacements/v39/cases \
  --evidence-directory .data/evals/v39-evidence \
  --freeze-id <preview-fingerprint> \
  --judge \
  --max-model-requests 900 \
  --output .data/evals/v39-heldout-runs
```

A partial or failed run exposes V39. Do not tune against its output and reuse it for acceptance; prepare an independent pack instead.
