# V37 held-out replacement pack

Status: prepared; no V37 model requests have started.

V37 has 16 cases: 12 real-source and 4 synthetic team-roster cases, with four cases per workflow. Case IDs, scenario families, player mentions, canonical Reep identities, provider source IDs, and synthetic roster data are new compared with V1–V36. The age calculation date is pinned to `2026-11-04`.

V36 is exposed. Its 222-request run passed calibration 32/32 but only 45/48 trials. It found one team answer with an incorrect roster date and two judge coverage failures for facts already visible in earlier turns. The evaluator now checks those facts against delivered provider/source values and their correct player identities. Team answer correction now uses the exact `retrievedAt` date from the roster result.

V37 includes a possessive-form player query, an earlier-turn saved-result follow-up, a team filter refinement with an excluded candidate's values in the prior answer, and a roster timestamp case. Recommendation candidate IDs and order were computed independently from the fixed FM feature map and Reep-linked ID set, not from the production recommendation function.

Local fixed evidence is in `.data/evals/v37-evidence/`. Preview reports 16/16 bundles ready and estimates 798 physical model requests for 48 trials, three repetitions per case, and judge calibration. The existing 900-request limit is authorized. Commit the final source and case set before previewing the freeze fingerprint.

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --case-directory evals/replacements/v37/cases \
  --evidence-directory .data/evals/v37-evidence \
  --freeze-id <preview-fingerprint> \
  --judge

node --import tsx evals/cli.ts run \
  --mode held_out \
  --case-directory evals/replacements/v37/cases \
  --evidence-directory .data/evals/v37-evidence \
  --freeze-id <preview-fingerprint> \
  --judge \
  --max-model-requests 900 \
  --output .data/evals/v37-heldout-runs
```

A partial or failed V37 report exposes the pack; it cannot be rerun for acceptance after tuning.
