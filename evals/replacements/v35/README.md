# V35 held-out replacement pack

Status: exposed; do not use for acceptance.

The pack has 16 cases: 12 fixed real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. Case IDs, scenario families, mentions, canonical Reep identities, provider source IDs, and synthetic team data are new compared with V1–V34. The fixed age calculation date is `2026-11-04`.

V34 is exposed. Its 48-trial run used 225 requests; judge calibration passed 32/32 but only 44/48 trials passed. Three failures came from an unresolved pronoun in an otherwise correctly reused saved lookup. One semantic judgment missed two CA/PA values displayed in a Markdown table because serialized text blocks were passed as escaped JSON. The judge now receives decoded text; the regression test uses the observed serialization. V35 removed that pronoun from its saved-result follow-up.

The real cases cover saved lookup follow-ups, same-scope and cross-scope comparisons, adding a participant, age/CA-filtered recommendations, and adding a recommendation reference with inherited position and limit. The team cases use a new synthetic roster to cover roster identity mapping, clarification, filter refinement, and safe stopping when FM profiles are unavailable.

V35 partial run `23c127d1-645b-4cd8-bef9-7bf1007c9746` stopped after 72 model requests with 24 trial records: 2 failed and 22 unfinished. Both failures were the Janik Haberer case: the model extracted “Janik Haberer's” as the player name, and identity resolution requested confirmation. No judge or calibration ran; there were no network failures or budget denials. V35 is exposed and cannot be used for acceptance.

The runtime request normalizer now removes a terminal English possessive suffix (`'s` or `’s`) from an extracted player mention and lookup-name override, preserving the canonical player name before identity resolution. Tests cover both apostrophe forms. A new independent V36 pack is required.

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

A partial or failed V36 report exposes the pack; it cannot be rerun for acceptance after tuning.
