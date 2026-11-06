# V36 held-out replacement pack

Status: exposed; do not use for acceptance.

The pack contains 16 cases: 12 real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. Case IDs, scenario families, player mentions, canonical Reep identities, provider source IDs, and synthetic roster data are new compared with V1–V35. The age calculation date is fixed at `2026-11-04`.

V35 was exposed after a partial run. Its two failed trials involved “Janik Haberer's”: the possessive form reached identity matching as though it were a different name. Request extraction now strips a terminal `'s` or `’s` from the extracted player mention and lookup-name override before identity resolution. Offline regression tests cover both forms, and V36 includes a real-source query for “Konrad Laimer's” to check the fix in the full graph.

The remaining real cases cover saved-result follow-ups, same-scope and cross-scope comparisons, adding a comparison participant, age/CA-filtered recommendations, and adding a recommendation reference while retaining its position and limit. Four new synthetic team cases cover roster mapping, clarification, filter refinement, and safe stopping.

V36 run `b39c7477-6e47-432a-8953-c93e805c4039` completed 48 trials in 222 requests (142 Agent, 32 calibration, 48 judge). Calibration passed 32/32, including validation 16/16. The quality gate failed: 45/48 trials passed. One saved-result trial did not count correct facts stated in its earlier response; one team answer misstated the API-Football roster date as 2026-11-20 although the source timestamp was 2025-11-20; one team refinement omitted previously displayed CA/PA facts from semantic coverage. There was one transient network failure and no budget denial. V36 is exposed and cannot be rerun for acceptance.

The evaluator now verifies that a required value was delivered for the matching provider/source before crediting it from an answer. It links candidates in returned tool results to their source IDs and checks both tables and labeled prose across all turns. Team-answer correction now replaces a mismatched roster retrieval date with the exact date from `roster.retrievedAt`. A new independent V37 pack is required.

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
