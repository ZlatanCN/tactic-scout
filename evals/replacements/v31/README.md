# V31 replacement held-out pack

Status: interrupted after an overbroad answer-required evidence list; rerun pending the contract correction.

The pack has 16 cases across all four workflows: 12 real-source cases and 4 synthetic team-roster cases. It is independent from V1–V30 by case IDs, scenario families, evidence bundles, player mentions, and source records. Each case pins `ageAsOfDate` to `2026-11-04`. The real cases use fixed local FM, Understat, and Reep snapshots. Synthetic team cases use a new fixture with no live roster data.

V30 is exposed and must not be reused. Its partial run exposed an ambiguous “Josh King” identity that the case incorrectly expected to resolve, and a case whose requested list sizes were underspecified. V31 replaces those scenarios with a uniquely resolved player and explicit separate-list limits. The implementation also documents that `resultLimit` applies independently to `currentCandidates` and `potentialCandidates`.

The first V31 attempt stopped after 5/48 trials and 20 model requests, before calibration or semantic judging. Its three failed repetitions were all for one comparison: the graph selected the expected Reep identity and source IDs, but model output omitted the diacritic in “Nikola Krstović”. The deterministic evaluator compared mention strings exactly. It now ignores diacritics when comparing identity mentions while still requiring exact Reep IDs, provider IDs, and resolution statuses.

The corrected-scoring run completed all 48 deterministic trials and passed 32 semantic trials. It stopped after 220 total requests, before scoring the remaining 13 trials, because the Samatta question only asked for appearances and whether PA guarantees future CA, but its answer-required evidence list also required unrelated minutes, xG, goals, and assists. The V31 case now requires only CA, PA, and appearances. No agent prompt or workflow behavior changed based on either partial run. The corrected frozen pack must rerun all 48 trials from the start.

Offline validation:

```sh
pnpm exec vitest run tests/replacement-v31-pack.test.ts
pnpm typecheck
pnpm exec ultracite check src/nodes/assistant.ts tests/agent.test.ts tests/replacement-v31-pack.test.ts evals/evidence/replacement-v31-team-synthetic.json evals/replacements/v31/cases
node --import tsx evals/cli.ts preview --mode held_out --judge --case-directory evals/replacements/v31/cases --evidence-directory .data/evals/v31-evidence
```

The preview reports 16/16 evidence bundles ready, 48 trials, and an estimate of 834 physical model requests. Run only from the committed, clean tree and use the exact fingerprint printed by the final preview. The previously approved ceiling is 900 requests; the runner stops and retains a partial report if it reaches that cap. The acceptance run must include judge calibration and semantic scoring.

```sh
node --import tsx evals/cli.ts run \
  --mode held_out \
  --judge \
  --freeze-id <freezeFingerprint> \
  --case-directory evals/replacements/v31/cases \
  --evidence-directory .data/evals/v31-evidence \
  --max-model-requests 900 \
  --output .data/evals/v31-heldout-runs
```
