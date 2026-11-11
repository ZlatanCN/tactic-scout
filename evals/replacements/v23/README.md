# V23 replacement held-out pack

Status: exposed; do not reuse this pack as an acceptance gate.

This 16-case replacement pack has four cases per workflow: one ordinary case, one boundary case, and two multi-turn cases. Twelve cases use local FM and Understat snapshots; four use a separate synthetic API-Football roster fixture. It uses new player identities, provider IDs, team IDs, scenario families, and evidence bundle IDs relative to the existing development and v1-v22 cases.

The pack includes same-turn singular-pronoun handling, saved lookup reuse, common and non-common competition scopes, comparison scope inheritance, PA/CA distinctions, recommendation filter refinement, added recommendation references, team roster mapping, and unmapped-roster stopping behavior. `tests/evaluation/packs/replacement-v23-pack.test.ts` checks case balance, data independence, saved-result reuse, and team-fixture naming.

Prepare fixed local evidence and the synthetic roster bundle:

```sh
pnpm eval:prepare-evidence \
  --case-directory evals/replacements/v23/cases \
  --case v23-lookup-camello-profile \
  --case v23-lookup-boye-pa-pronoun-boundary \
  --case v23-lookup-boye-saved-season \
  --case v23-lookup-aubameyang-saved-xa \
  --case v23-compare-camello-boye-common-la-liga \
  --case v23-compare-camello-pavlovic-no-common-scope \
  --case v23-compare-add-pavlovic-inherited-la-liga-scope \
  --case v23-compare-add-aubameyang-same-la-liga-scope \
  --case v23-recommend-camello-similar-stc \
  --case v23-recommend-nino-under-18-pa-boundary \
  --case v23-recommend-aubameyang-refine-age-pa \
  --case v23-recommend-add-aubameyang-reference \
  --output .data/evals/v23-evidence

cp evals/evidence/replacement-v23-team-synthetic.json \
  .data/evals/v23-evidence/replacement-v23-team-synthetic.json
```

The generated bundle hash must match `evidenceBundleSha256` in the real cases. Update the case hashes if the local snapshots produce a different hash. Preview all 16 selected cases to validate their schema, evidence, split, model configuration, and request estimate:

```sh
pnpm eval:preview \
  --mode held_out \
  --judge \
  --case-directory evals/replacements/v23/cases \
  --evidence-directory .data/evals/v23-evidence
```

Freeze the preview's `freezeFingerprint`, then run the formal gate with the approved 900-request ceiling. Do not tune against these cases after the run starts; if the pack is exposed, replace it before another final gate.

```sh
pnpm eval:run \
  --mode held_out \
  --judge \
  --freeze-id <freezeFingerprint> \
  --case-directory evals/replacements/v23/cases \
  --evidence-directory .data/evals/v23-evidence \
  --max-model-requests 900 \
  --output .data/evals/v23-heldout-runs
```


Run `37a11cd1-a26a-4737-9be4-1252f29c8236` was stopped after 34/48 trials and 119 requests because it had already exposed the pack. It revealed contract mistakes in the three La Liga comparison cases and two saved-result follow-ups, plus a real bug where recommendation references were sorted by canonical ID instead of preserving the conversation's reference order. The two contract issues and the node behavior are covered by v24; use the v23 report for diagnosis only.
