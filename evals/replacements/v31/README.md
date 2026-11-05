# V31 replacement held-out pack

Status: exposed; do not use as the acceptance pack.

The pack has 16 cases across all four workflows: 12 real-source cases and 4 synthetic team-roster cases. It is independent from V1–V30 by case IDs, scenario families, evidence bundles, player mentions, and source records. Each case pins `ageAsOfDate` to `2026-11-04`. The real cases use fixed local FM, Understat, and Reep snapshots. Synthetic team cases use a new fixture with no live roster data.

V30 is exposed and must not be reused. Its partial run exposed an ambiguous “Josh King” identity that the case incorrectly expected to resolve, and a case whose requested list sizes were underspecified. V31 replaces those scenarios with a uniquely resolved player and explicit separate-list limits. The implementation also documents that `resultLimit` applies independently to `currentCandidates` and `potentialCandidates`.

The first V31 attempt stopped after 5/48 trials and 20 model requests, before calibration or semantic judging. Its three failed repetitions were all for one comparison: the graph selected the expected Reep identity and source IDs, but model output omitted the diacritic in “Nikola Krstović”. The deterministic evaluator compared mention strings exactly. It now ignores diacritics when comparing identity mentions while still requiring exact Reep IDs, provider IDs, and resolution statuses.

The corrected-scoring run `d7ee4ab1-9aa2-44c6-b630-0b5cad353d3b` completed 48 deterministic trials, passed 32 judge anchors, and used 246 model requests. It finished with 45 passing trials, 2 semantic failures, and 1 invalid judge result. The findings exposed three issues: the Samatta answer contract required current CA although the question did not ask for it; the team answer denied a ranking basis that was present at the top level of the tool result; and one multi-turn Moffi trial produced an invalid contradiction judgment by citing an unknown evidence ID while quoting a different candidate row. The team prompt and deterministic correction are now fixed. V31 is exposed and is not an acceptance gate.

Offline validation:

```sh
pnpm exec vitest run tests/replacement-v31-pack.test.ts
pnpm typecheck
pnpm exec ultracite check src/nodes/assistant.ts tests/agent.test.ts tests/replacement-v31-pack.test.ts evals/evidence/replacement-v31-team-synthetic.json evals/replacements/v31/cases
node --import tsx evals/cli.ts preview --mode held_out --judge --case-directory evals/replacements/v31/cases --evidence-directory .data/evals/v31-evidence
```

V31 is retained only as the report source for these findings. The acceptance attempt now uses the independent V32 pack.
