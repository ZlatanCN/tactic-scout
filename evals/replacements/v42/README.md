# V42 held-out replacement pack

Status: prepared; not yet run against the live model.

V42 contains 16 held-out cases: 12 fixed real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. Player mentions, canonical identities, provider source IDs, and synthetic roster identities are new compared with V1–V41. The fixed age-as-of date is `2026-11-04`.

The pack fixes V41's Gauthier Hein case to ask for the expected assist field. It includes an accentless `Enzo Le Fee` lookup for source spelling `Enzo Le Fée`, a neutral saved-result follow-up, and explicit league conditions checked against the comparison messages. Recommendation result IDs and order were independently calculated from the documented FM feature lists and Reep-linked exclusions.

V41 is exposed: three Gauthier Hein trials used a stale expected-fact contract, and one semantic judgment rejected a fixed-date FM snapshot statement because the judge lacked that application rule. V9 adds the rule and a reserved anchor pair; the separate 16-anchor validation half must pass before trial semantics can count. V42 uses new identities, provider IDs, and synthetic teams. Local fixed evidence is in `.data/evals/v42-evidence`; real provider data and reports stay local.

The current preview reports 16/16 evidence bundles ready, 48 trials, and 753 estimated model requests. The 900-request limit is authorized. After committing all source, anchor, and case files, copy the preview's `freezeFingerprint` into `--freeze-id` for both preview and run:

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --case-directory evals/replacements/v42/cases \
  --evidence-directory .data/evals/v42-evidence \
  --judge

node --import tsx evals/cli.ts run \
  --mode held_out \
  --case-directory evals/replacements/v42/cases \
  --evidence-directory .data/evals/v42-evidence \
  --freeze-id <preview-fingerprint> \
  --judge \
  --max-model-requests 900 \
  --output .data/evals/v42-heldout-runs
```

A partial or failed V42 run exposes the pack; it cannot be reused for acceptance after tuning.
