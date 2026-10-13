# Explain Harness latency by executed operation

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Use repeated real-model Harness runs to identify which Planner decisions or data tools account for end-to-end investigation latency, so later performance work can target observed waits rather than guess.

## Scope

- Preserve the existing end-to-end p50/p95 and report per-operation sample count, p50, and p95.
- Aggregate only model-backed Planner decisions and executed tools; do not include deterministic policy decisions as model latency.
- Keep the result query/scenario-scoped and deterministic; do not add hosted telemetry or send traces outside the machine.
- Treat small-sample percentiles as observed-run summaries, not stable performance guarantees or causal proof.

## Public seam

Extend the already-approved Harness seam: pure function summarizeEvaluationRuns and the local pnpm eval:local-agent CLI. Tests exercise the pure summary input/output contract; the real-model CLI demonstrates the aggregate without making deterministic tests contact Ollama.

## Acceptance criteria

- [x] Each scenario summary keeps run count, pass rate, failed-check counts, and end-to-end p50/p95.
- [x] The summary includes deterministic, stable-sorted Planner-action and tool latency entries with operation name, sample count, p50, and p95.
- [x] Policy-only decisions are excluded from Planner latency; a Planner call with no resolved action remains visible in a distinct unresolved bucket. A model-backed proposal overridden by policy is attributed to its proposed Planner action.
- [x] Invalid operation names or negative/non-finite durations are rejected by the pure summary seam.
- [x] Deterministic tests cover aggregation, nearest-rank behavior, sorting, unresolved actions, and policy/model separation.
- [x] Evaluation docs explain what each latency measures and warn that three-run p95 is only the largest observed sample.
- [x] The local three-run curated Harness result is recorded without claiming general model performance or recommendation quality.

## Context

The latest curated Qwen 3.5 9B run completed the same two-clarification scenario three times, each with 29/29 behavior checks. End-to-end latency varied from 56.653 to 164.455 seconds; Planner action elapsed times varied much more than local tool timings. The raw privacy-safe trace already records per-event elapsedMs, but its scenario summary reports only whole-run latency.

## Answer

Extended `summarizeEvaluationRuns` with deterministic per-operation p50/p95 and event sample counts while preserving end-to-end run summaries. The local CLI derives samples from privacy-safe traces, attributing model-backed proposals to their proposed action, excluding deterministic policy-only decisions, recording failed/unresolved Planner calls in the `unresolved` bucket, and grouping executed tools separately. Operation names are allowlisted by event kind; negative and non-finite durations are rejected.

The existing three-run curated/Qwen trace was re-aggregated: all runs passed 29/29 behavior checks, with end-to-end p50/p95 of 64,953/164,455 ms. Planner `finish`, `search_candidates`, and `search_methodology` p95 values were 68,813, 27,755, and 28,814 ms. Tool p95 values ranged from 8 to 1,405 ms. A fresh one-run CLI integration check passed 29/29 and emitted the grouped summary in its JSON output (200,443 ms end-to-end; `finish` Planner action 87,116 ms). These local observations do not establish stable performance or shortlist quality. Definitions and the full operation table are in [evaluation docs](../../../docs/evaluation.md#harness-延迟拆分).

## Comments

- 2026-10-10: Implemented the `summarizeEvaluationRuns` aggregation and CLI trace mapping. Red/green verification covered supported operation names, invalid durations, stable ordering, nearest-rank percentiles, and exclusion of policy-only samples. `pnpm build` and the two focused Harness test files passed (48 tests); `git diff --check` passed.
- 2026-10-10: Re-aggregated the existing three-run curated/Qwen trace: all runs passed 29/29 checks; end-to-end p50/p95 64,953/164,455 ms. Planner `finish` p50/p95 25,059/68,813 ms, `search_candidates` 10,531/27,755 ms, `search_methodology` 7,530/28,814 ms. Tool p95 ranged from 8 ms (`search_player_reports`) to 1,405 ms (`search_methodology`), correcting the earlier shorthand that all tools were only 1–32 ms. A fresh one-run CLI integration check passed 29/29 and emitted the operation summary (200,443 ms overall; Planner `finish` 87,116 ms). These are descriptive local samples only.
