# V35 held-out replacement pack

Status: prepared; no V35 model requests have started.

The pack has 16 cases: 12 fixed real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. Case IDs, scenario families, mentions, canonical Reep identities, provider source IDs, and synthetic team data are new compared with V1–V34. The fixed age calculation date is `2026-11-04`.

V34 is exposed. Its 48-trial run used 225 requests; judge calibration passed 32/32 but only 44/48 trials passed. Three failures came from an unresolved pronoun in an otherwise correctly reused saved lookup. One semantic judgment missed two CA/PA values displayed in a Markdown table because serialized text blocks were passed as escaped JSON. The judge now receives decoded text; the regression test uses the observed serialization. V35 asks for the saved xA without a pronoun so that case tests saved-result reuse directly.

The real cases cover saved lookup follow-ups, same-scope and cross-scope comparisons, adding a participant, age/CA-filtered recommendations, and adding a recommendation reference with inherited position and limit. The team cases use a new synthetic roster to cover roster identity mapping, clarification, filter refinement, and safe stopping when FM profiles are unavailable.

Local evidence is in `.data/evals/v35-evidence/`. Preview verified 16/16 bundles and estimates 798 physical model requests for 48 trials, three repetitions per case, and judge calibration. The existing 900-request ceiling is sufficient. Commit the final source and case set before the final preview; copy the resulting exact fingerprint into the run command and do not modify evaluation source or case files after freezing.

```sh
node --import tsx evals/cli.ts preview \
  --mode held_out \
  --case-directory evals/replacements/v35/cases \
  --evidence-directory .data/evals/v35-evidence \
  --freeze-id <preview-fingerprint> \
  --judge

node --import tsx evals/cli.ts run \
  --mode held_out \
  --case-directory evals/replacements/v35/cases \
  --evidence-directory .data/evals/v35-evidence \
  --freeze-id <preview-fingerprint> \
  --judge \
  --max-model-requests 900 \
  --output .data/evals/v35-heldout-runs
```

A partial or failed V35 report exposes the pack; it cannot be rerun for acceptance after tuning.
