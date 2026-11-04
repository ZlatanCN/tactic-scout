# Local diagnostic cases

These synthetic cases exercise narrow regressions through the real graph. They are separate from `evals/cases`; they do not change the official benchmark split or count as held-out evidence.

The Understat cases ask for appearances while the fixed record has only a single related value or goals and minutes. `games` is intentionally absent. The comparison case uses “their respective” after naming two players and verifies that the pronoun does not become an extra identity lookup.

Preview the exact diagnostic set:

```sh
node --import tsx evals/cli.ts preview \
  --mode development \
  --judge \
  --case-directory evals/diagnostics/cases \
  --evidence-directory evals/diagnostics/evidence \
  --case diag-their-respective-comparison \
  --case diag-understat-appearance-count \
  --case diag-understat-appearance-goals-only \
  --case diag-understat-appearance-minutes-only
```

Run the same cases with three trials per case and a 250-request cap:

```sh
node --import tsx evals/cli.ts run \
  --mode development \
  --judge \
  --case-directory evals/diagnostics/cases \
  --evidence-directory evals/diagnostics/evidence \
  --case diag-their-respective-comparison \
  --case diag-understat-appearance-count \
  --case diag-understat-appearance-goals-only \
  --case diag-understat-appearance-minutes-only \
  --max-model-requests 250
```

Reports and temporary databases are written under ignored `.data/evals/` paths. A diagnostic run is not a formal benchmark or quality-gate result.
