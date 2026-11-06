# V37 held-out replacement pack

Status: exposed; do not use for acceptance.

V37 has 16 cases: 12 real-source and 4 synthetic team-roster cases, with four cases per workflow. Case IDs, scenario families, player mentions, canonical Reep identities, provider source IDs, and synthetic roster data are new compared with V1–V36. The age calculation date is pinned to `2026-11-04`.

V36 is exposed. Its 222-request run passed calibration 32/32 but only 45/48 trials. It found two judge coverage failures for facts already visible in earlier turns and one team answer with an incorrect roster date. The evaluator now checks visible facts against exact delivered values and source IDs; team answer correction uses the provider timestamp.

V37 includes a possessive-form player query, an earlier-turn saved-result follow-up, a team filter refinement with an excluded candidate's values in the prior answer, and a roster timestamp case. Recommendation candidate IDs and order were computed independently from the fixed FM feature map and Reep-linked ID set, not from the production recommendation function.

V37 run `4e55b236-4cfc-4477-9d01-51d0961da245` completed 48 trials in 215 requests (135 Agent, 32 calibration, 48 judge). Calibration passed 32/32 and 47/48 trials passed. One semantic judgment caught a real false reference-count claim: the answer said the squad reference profile used five players, while the tool result listed two. There were no network failures or budget denials. A deterministic correction for this count was added while the run was active, so V37 does not represent one frozen revision and cannot be used for acceptance. V37 is exposed.

The team answer now corrects a squad reference count that differs from the returned reference list. V38 and V39 are exposed; V40 is the next independent pack.

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --case-directory evals/replacements/v40/cases \
  --evidence-directory .data/evals/v40-evidence \
  --freeze-id <preview-fingerprint> \
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

A partial or failed V40 report exposes the pack; it cannot be rerun for acceptance after tuning.
