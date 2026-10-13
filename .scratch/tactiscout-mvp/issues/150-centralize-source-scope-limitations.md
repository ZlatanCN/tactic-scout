# Centralize static source limitations

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Keep each provider's fixed data-scope caveats in one canonical definition so the workbench and completed report cannot drift apart. Runtime facts such as request failures, incomplete candidate evaluation, and missing metrics remain report-specific.

## Confirmed public test seam

Use the existing full deterministic `createRecruitmentConversation()` report path. Do not test private report-building helpers or LangGraph nodes.

## Acceptance criteria

- [x] `describeDatasetScope(mode).limitations` is the single source of fixed provider caveats.
- [x] A completed report carries those caveats in `report.limitations` alongside case-specific evidence and failure limitations.
- [x] Runtime-only limitations remain conditional on observed state.
- [x] The report UI does not make users open two sections to read the same caveat list; the empty state still exposes data-scope limitations.
- [x] Full deterministic report-path regression and API/Web builds pass.

## Answer

Provider-specific fixed caveats now live in `describeDatasetScope()` and are copied into the final report's `limitations`. Case-specific failures, partial reads, samples, and evaluation gaps remain conditional in the LangGraph report assembly. The report shows the shared caveat list once; the empty state still shows data-scope limits in its data card.

Verification: the full LangGraph report-path test asserts that every canonical scope caveat appears in the report; `pnpm test` passes 383/383; `pnpm build`, `pnpm build:web`, and `git diff --check` pass.
