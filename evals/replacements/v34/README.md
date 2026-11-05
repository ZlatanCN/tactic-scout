# V34 held-out replacement pack

Status: prepared; no V34 model requests have started.

The pack contains 16 independent cases: 12 real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. It uses new case IDs, scenario families, player mentions, canonical Reep identities, source IDs, and synthetic roster data compared with V1–V33. All cases pin the age calculation date to `2026-11-04`.

V33 is exposed. Its partial run used 218 model requests, with 35 passed trials, 3 failures caused by a wrong expected candidate list in the add-reference case, and 10 trials not assessed. That case contract was corrected only after the run. V34 is a new pack built from fixed local FM, Understat, Reep, and synthetic squad evidence.

The 12 real cases cover identity-resolved lookup and saved-result follow-ups, same-scope and cross-scope comparisons, filter-based recommendations, and adding a recommendation reference while retaining the original position and limit. The 4 synthetic team cases cover squad mapping, clarification, roster-filter refinement, and safe stopping when no FM profile is available.

Local evidence is in `.data/evals/v34-evidence/`. Preview verified all 16 bundles and estimates 816 physical model requests for 48 trials, three repetitions per case, and judge calibration. The existing 900-request limit is sufficient for this run. The final fingerprint must be copied from the preview after the case pack and code revision are committed; do not edit evaluation source or case files after freezing.

Run the final preview and paste its exact fingerprint into both commands:

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --case-directory evals/replacements/v34/cases \
  --evidence-directory .data/evals/v34-evidence \
  --freeze-id <preview-fingerprint> \
  --judge

node --import tsx evals/cli.ts run \
  --mode held_out \
  --case-directory evals/replacements/v34/cases \
  --evidence-directory .data/evals/v34-evidence \
  --freeze-id <preview-fingerprint> \
  --judge \
  --max-model-requests 900 \
  --output .data/evals/v34-heldout-runs
```

The run must complete calibration and all 48 trials within the request cap. A partial or failed report exposes V34; it cannot be rerun for acceptance after tuning.
