# V32 replacement held-out pack

Status: exposed; do not use as the acceptance pack.

The pack contains 16 independent cases across all four workflows: 12 fixed-source cases and 4 new synthetic team-roster cases. It uses new case IDs, scenario families, player identities, source IDs, and a new synthetic team fixture compared with V1–V31. Every age calculation uses the case date `2026-11-04`.

V31 is exposed and is not an acceptance pack. Its failures led to these V32 changes:

- The team answer now reads the top-level `rankingBasis` field and reports its exact calculation method. A deterministic correction handles model claims that the method was omitted.
- The Mert Kömür lookup asks only for appearances and whether PA guarantees future CA. Its required answer facts are limited to appearances and PA; the unrelated current CA is not required.
- The CA-filter recommendation is a single-turn question because V31's multi-turn case led the judge to confuse a candidate shown before refinement with the later filtered list. Multi-turn recommendation coverage remains in the independent add-reference case, while the team workflow retains two filter-refinement cases.

V32 run `d98eeaa0-bab4-4fbd-9a92-5b7e28d03094` completed 48 Agent trials, passed 32 judge calibration anchors, and used 232 requests. It passed 47/48 trials. In the remaining case, the model omitted the reference player's CA and PA from its recommendation answer. The player recommendation answer path now restores each missing reference line deterministically when candidate lists are non-empty. V32 is exposed and will not be reused as the acceptance pack.

Offline validation:

```sh
pnpm exec vitest run tests/replacement-v32-pack.test.ts
pnpm typecheck
pnpm exec ultracite check src/nodes/assistant.ts src/recommendation-answer.ts tests/agent.test.ts tests/team-recommendation.test.ts tests/replacement-v32-pack.test.ts evals/evidence/replacement-v32-team-synthetic.json evals/replacements/v32/cases
node --import tsx evals/cli.ts preview --mode held_out --judge --case-directory evals/replacements/v32/cases --evidence-directory .data/evals/v32-evidence
```

V32's preview and run commands are retained only as historical references. The current acceptance attempt uses V33.

```sh
```
