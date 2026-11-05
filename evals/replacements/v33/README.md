# V33 replacement held-out pack

Status: prepared; no V33 model requests have started.

The pack contains 16 independent cases across all four workflows: 12 fixed-source cases and 4 synthetic team-roster cases. It uses new case IDs, scenario families, player mentions, canonical Reep identities, provider IDs, and synthetic team data compared with V1–V32. Each case pins `ageAsOfDate` to `2026-11-04`.

V32 is exposed and must not be reused. Its only failing case omitted the reference player's CA and PA from an answer despite the tool result containing them. The player recommendation answer path now restores every missing reference line deterministically when candidate lists are non-empty. V33 re-tests this behavior with different players and source records. The age/CA refinement question is a single turn; multi-turn continuation remains covered in compare, add-reference recommendation, and team-filter cases.

V33 cases also use exact Understat values extracted from the fixed local snapshots. Preflight compares every required metric with its matching provider row and rejects a mismatch before any model request.

Offline validation:

```sh
pnpm exec vitest run tests/replacement-v33-pack.test.ts
pnpm typecheck
pnpm exec ultracite check evals/benchmark.ts src/nodes/assistant.ts src/recommendation-answer.ts tests/agent.test.ts tests/team-recommendation.test.ts tests/evaluation-pack-invariants.ts tests/replacement-v33-pack.test.ts evals/evidence/replacement-v33-team-synthetic.json evals/replacements/v33/cases
node --import tsx evals/cli.ts preview --mode held_out --judge --case-directory evals/replacements/v33/cases --evidence-directory .data/evals/v33-evidence
```

The current preview reports 16/16 evidence bundles ready, 48 trials, and an estimate of 816 physical model requests. Run from the committed clean tree with the exact fingerprint from the final preview. The previously approved hard ceiling is 900 requests; the runner saves a partial report and stops if the cap is reached. Judge calibration and semantic scoring are required.

```sh
node --import tsx evals/cli.ts run \
  --mode held_out \
  --judge \
  --freeze-id <freezeFingerprint> \
  --case-directory evals/replacements/v33/cases \
  --evidence-directory .data/evals/v33-evidence \
  --max-model-requests 900 \
  --output .data/evals/v33-heldout-runs
```
