# Controlled evidence-review gate ablation

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Measure what the deterministic evidence-review gate contributes to TactiScout's interactive LangGraph run, using matched local-model runs and the same fixed candidate data.

## Scope

- Compare the default graph with an evaluation-only variant that bypasses evidence alignment and `validateConclusion` while preserving Planner decisions, tools, budgets, data, clarification/resume, and post-review enrichment.
- Run both arms from the same explicitly selected scenario and curated dataset in one CLI process; keep each run's interactive turns on its own thread.
- Emit privacy-safe review telemetry for pass, retry, exhausted, and bypassed outcomes, with elapsed time and aggregate problem/repair counts only.
- Compare per-run Harness checks, recommendation counts, evidence-reference counts, and elapsed time. Do not infer shortlist quality, recommendation accuracy, or general LangGraph value from these outcomes.
- Keep the default application behavior unchanged. Make the ablation available only through the local evaluation CLI.

## Resolution criteria

- `pnpm eval:local-agent -- --scenario <id> --compare-reviewer --runs <n>` executes paired full and bypassed runs against `TACTISCOUT_DATA_MODE=curated` and rejects ambiguous/all-scenario comparisons.
- Every arm uses the same model configuration, repository, knowledge base, scenario inputs, and run count; the output identifies the mode and reports paired behavioral/cost summaries without player names or IDs in the comparison summary.
- The trace records which reviewer mode ran and its observed outcome; bypass telemetry does not claim a review passed.
- `docs/evaluation.md` explains the command, variables held constant, outcome measures, and sample limitations.
- API and Web TypeScript builds pass; no player-quality score is emitted.

## Context

The current `review_recommendation` node is deterministic: it aligns recommendation evidence references, validates conclusion claims, allows one retry, then suppresses unsupported recommendations. It is not a second LLM Agent. Existing issue 124 records that the project has no real human shortlist labels, so this first ablation can only assess Harness behavior and evidence handling.

## Answer

Added an evaluation-only `experimentalReviewerMode` to the graph factory, privacy-safe `review` trace events, and `--compare-reviewer` to the local Harness CLI. The comparison requires a single registered scenario and `TACTISCOUT_DATA_MODE=curated`; each pair shares one loaded repository and knowledge base, while each graph run keeps its own thread. The default application path still enables evidence review. Comparison JSON separates baseline `allPassed` from `ablationAllPassed`, so an expected failed check in the bypass arm does not become a CLI execution error.

Ran three paired Qwen 3.5 9B runs on the Wyscout 2017/18 curated snapshot. All three full runs passed 29/29 Harness checks; all three bypass runs passed 28/29, with only `requestedCapabilitiesAreGrounded` failing. Planner/tool traces and recommendation sets matched within every pair. The enabled reviewer repaired one evidence reference per run (two references in the resulting recommendation versus one in the bypass arm). This demonstrates the gate's evidence-reference repair on this case; it says nothing about ranking quality. Observed full/bypass end-to-end p50/p95 was 75.543/179.112 versus 72.790/78.317 seconds; one 179-second full run and the small sample preclude a latency claim. Raw output and trace are local-only at `.data/evaluations/reviewer-ablation.json` and `.data/evaluations/reviewer-ablation.log`.

## Comments

- 2026-10-10: Research protocol is in [agent-harness-ablation-design-2026-10](../research/agent-harness-ablation-design-2026-10.md). The first slice isolates the evidence gate because its behavior is observable and can be bypassed without changing the rest of the graph.
- 2026-10-10: Three paired real-model runs found the same candidate set and Planner/tool traces in both arms. Full review repaired one evidence reference in each run; bypass failed only the grounded-capability check. Raw output remains in ignored `.data/`. `pnpm build` and `git diff --check` pass; no deterministic test suite was run for this issue.
