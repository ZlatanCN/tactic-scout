# V34 held-out replacement pack

Status: exposed; do not use for acceptance.

The pack contains 16 independent cases: 12 real-source cases and 4 synthetic team-roster cases, with four cases for each workflow. It uses new case IDs, scenario families, player mentions, canonical Reep identities, source IDs, and synthetic roster data compared with V1–V33. All cases pin the age calculation date to `2026-11-04`.

V33 is exposed. Its partial run used 218 model requests, with 35 passed trials, 3 failures caused by a wrong expected candidate list in the add-reference case, and 10 trials not assessed. That case contract was corrected only after the run.

The 12 real cases cover identity-resolved lookup and saved-result follow-ups, same-scope and cross-scope comparisons, filter-based recommendations, and adding a recommendation reference while retaining the original position and limit. The 4 synthetic team cases cover squad mapping, clarification, roster-filter refinement, and safe stopping when no FM profile is available.

V34 run `7d7c2273-7fd3-43bf-aac9-6e86076d8df4` completed all 48 trials in 225 requests (145 Agent, 32 calibration, 48 judge). Calibration passed 32/32, including 16/16 validation anchors. The gate failed: 44/48 trials passed. Three failed identity-continuity checks because the saved xA follow-up said “his,” which the observer recorded as unresolved despite reusing the right saved lookup. One semantic judgment missed Eric Martel's CA 140 and PA 150 even though both values were present in the comparison table. Two transient network failures were recovered; no requests were denied. V34 is exposed and cannot be rerun for acceptance.

The V34 findings exposed a judge-input serialization bug: the evaluator passed text content blocks as escaped JSON, so table text was not reliably visible to the judge or deterministic table check. The judge input now extracts text blocks before semantic review. The next pack also phrases the saved-result follow-up without a pronoun so it evaluates saved-result reuse without conflating that with identity resolution. A new independent V35 pack is required.

Do not run V34 again. These commands document the run shape only; the next acceptance run must use the independent V35 pack and its own final fingerprint:

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

The V35 run must complete calibration and all 48 trials within the request cap. A partial or failed report exposes V35; it cannot be rerun for acceptance after tuning.
