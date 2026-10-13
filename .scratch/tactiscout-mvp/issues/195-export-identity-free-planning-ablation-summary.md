# Export an identity-free dynamic-planning ablation summary

Type: task
Status: open
Labels: needs-info
Blocked by: none

## Goal

Allow the registered adaptive-vs-single-pass LangGraph comparison to write a stable, identity-free aggregate summary that can be audited and used to refresh the `/showcase` metrics from the same run.

## Requirements

- Support `--summary-output <path>` with `--compare-investigation-planning` only; keep the option rejected for other comparison modes until their outputs have separate privacy review.
- Project through an explicit allowlist. Include paired/run counts, Harness pass/check counts, Planner attempts and provider usage coverage, token totals with missing values represented as unavailable, tool counts, evaluated candidate counts, recommendation counts, clarifications, and elapsed-time p50/p95.
- Do not serialize scenario IDs or labels, team/player names or IDs, request/answer text, prompts, reports, traces, progress payloads, endpoint values, credentials, or arbitrary free text.
- Reuse the existing no-overwrite, preflight, and owner-only file mode behavior.
- Store a committed sanitized aggregate as the `/showcase` data source, or provide an equally reproducible generation path so the displayed values can be reconciled against the same export.
- Keep the small-sample and recommendation-quality limitations visible; the summary must not imply ranking accuracy.

## Proposed validation seams (awaiting confirmation)

- Pure exported function `createIdentityFreeInvestigationPlanningSummary(input, generatedAt)`: validate the fixed output allowlist, sensitive sentinel exclusion, paired aggregates, and missing/partial token-usage semantics.
- Local Harness CLI with `--compare-investigation-planning --summary-output <path>`: validate preflight/refusal behavior without contacting the model when the output path already exists, then run the registered comparison once and inspect the successful identity-free file and `/showcase` source against it.

## Context

- [Hiring signal refresh](../research/agent-engineer-hiring-signal-refresh-2026-10-13.md)
- [Current paired results](../../../docs/evaluation.md#动态调查规划消融)
- [Existing ordinary-run summary export](../../../src/evals/harness-summary-export.ts)
- [Showcase card](../../../web/src/ShowcaseInvestigationPlanningAblation.tsx)

## Comments

- 2026-10-13: Proposed after identifying manual drift between safe aggregates, project documentation, and the showcase. TDD requires agreement on public test seams before writing tests; implementation has not started.
