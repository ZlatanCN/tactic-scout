# 221 — Align agent policy, evidence retrieval, and verification

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Turn the latest adversarial audit into bounded code changes that improve recruitment intent consistency, Planner/runtime policy alignment, and resilient evidence retrieval. Preserve the LangGraph workflow and use the already confirmed public test seams.

## Confirmed validation seams

1. Pure recruitment requirement parsing/validation plus `createRecruitmentConversation` end-to-end behavior.
2. Capture the structured request passed to `RecruitmentPlanner.decide()` plus the full-graph action trace.
3. `createWebSearchKnowledgeRepository().search()` for local hits, web failures, deduplication, and result limits.
4. The full graph and existing `pnpm eval:local-agent` paired comparisons for expansion sufficiency and Reviewer behavior.

## Acceptance

- [x] Capability coverage and conclusion policy use the structured requirement as their source of truth instead of independently re-parsing raw turns.
- [x] Planner instructions and action constraints match the graph phase and actions actually available at runtime.
- [x] Local report evidence remains available when Tavily fails; local and web results can both appear within the requested result limit.
- [x] Existing paired ablations are run or their fixed-scenario evidence is revalidated; conclusions are bounded to observed behavior.
- [x] Relevant tests/builds and `git diff --check` pass; pre-existing local diagnostic scripts remain untouched.

## Answer

Implemented one shared capability-evidence contract: after brief validation, explicit capabilities omitted by the model are recovered from exact user wording and stored once in the brief; search intent, coverage, review, and report projection then read that structured brief. Legacy callers with no brief still use the original-message fallback. Explicit age filters are likewise grounded in the matching user quote instead of being accepted as unsupported model output.

Planner investigation requests now carry the action set available for the current graph phase, data-source capabilities, and remaining tool budgets. The structured-output schema is restricted to that set, and the prompt no longer mandates a fixed methodology-first sequence. Expansion, recovery, reorientation, and conclusion keep their existing phase-specific action policies.

Optional Tavily failure now preserves local player-report results, while successful local and web results are URL-deduplicated and interleaved within the requested quota. Caller cancellation still propagates.

Validation: 670/670 tests pass; `pnpm build`, `pnpm build:web`, and `git diff --check` pass. The web build retains the existing large-bundle advisory.

The three-pair Understat left-back expansion-sufficiency experiment passed in both arms (3/3 Harness runs each). The enabled policy made zero expansion Planner requests; median end-to-end time was 28.587s versus 86.744s with the policy bypassed. Recommendation and evidence ordering matched in all three pairs. This supports skipping that one already-sufficient expansion call; it does not measure shortlist quality or justify skipping other searches.

Current three-pair Reviewer comparisons on Barcelona cases were inconclusive for Reviewer efficacy: enabled and bypass arms had the same Harness failures and no observed outcome difference. An earlier controlled fixed-case result in [issue 132](132-controlled-evidence-review-ablation.md) showed the enabled gate repairing a missing evidence reference in 3/3 pairs; that prior result supports the narrow evidence-repair behavior, not ranking quality. A Bayern/Kane attempt was excluded because its first live clarification did not match the registered answer script. Raw experiment files remain in Git-ignored `.data/evaluations/`.

The four pre-existing planner-context diagnostic scripts remain untracked and were not modified or added to the application changes.

## Comments

- 2026-10-19: User confirmed the four public validation seams before implementation.
- 2026-10-19: Full tests exposed two stale assumptions: a capability alias (`给队友喂饼`) was not normalized, and a prompt unit test expected static tool names after runtime action constraints became phase-specific. Added the alias and moved the tool-availability assertion to the runtime contract; the affected 41-test slice and final full suite passed.
- 2026-10-19: Expansion ablation supports the narrow deterministic sufficiency decision. Current Reviewer ablations did not distinguish enabled and bypassed arms; retained the limitation instead of claiming an effect.
