# Deepen the recruitment evidence evaluator

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Keep LangGraph responsible for investigation policy and state transitions while placing candidate-record loading, cohort comparison, capability evidence construction, and evidence wording behind one small evaluator interface.

## Why now

`src/agent/conversation.ts` is 2,372 lines. Its graph calls the typed tool executor, but it also owns the evaluator implementation: resolving requested candidate IDs, loading comparison players, deduplicating source records, filtering the same-position/competition/season cohort, projecting source metrics, calculating percentiles, and formatting their sample limitations. This implementation can change without changing the graph's decisions or tool protocol, so it is a real seam.

The repository already has multiple production `PlayerRepository` adapters and test repositories. A separate evaluator module can own these evidence invariants once; the graph remains a caller and its current injected-Planner conversation interface remains the behavior-level verification seam. This is an extraction, not a change to scoring weights or recommendation policy.

## Interface

- `createRecruitmentEvidenceEvaluator(repository)` returns one evaluator with `evaluate(eligiblePlayers, requestedIds)` and `describe(evidence)` operations.
- `evaluate` only returns requested IDs already present in the currently eligible discovery result. It loads those records by source ID, uses only direct, available metrics, compares within the same position/competition/season, applies existing sample gates, and returns both the evaluated candidates and the deduplicated observed peer pool.
- Provider errors continue to propagate to the existing tool failure policy. Missing values stay missing; they are never converted to zero.
- `describe` renders the evaluator's actual metric definition, source, sample and comparison limitation for Planner/report context without changing the evidence itself.
- The evaluator owns the source-record identity helper used for de-duplication; LangGraph may reuse that same helper when it records observed records.

## Scope

- Extract evaluator types, evidence construction, and evidence description from `conversation.ts` into `src/agent/recruitment-evidence-evaluator.ts`.
- Share source-record identity in one focused helper used by both the evaluator and graph bookkeeping.
- Inject the evaluator into `executeRecruitmentToolAction`; do not add a second wrapper around repository I/O.
- Keep the typed executor responsible for action dispatch and the LangGraph responsible for policy, tool budgets, progress, trace, state updates, and failure recovery.
- Preserve all current report evidence, metric order, provider provenance, sample gates, tool trace fields, and user-visible wording.
- Do not introduce new score weights, data sources, or ranking claims.

## Verification

- [x] Full conversation-level fixtures continue to observe the same evaluated evidence, peer pool, missing-data behavior, and source failures through `createRecruitmentConversation`.
- [x] No evaluation helper is exported solely to make private implementation tests possible.
- [x] API and Web production builds pass; `git diff --check` passes.

## Research

- [Codebase Design skill](../../../../.agents/skills/codebase-design/SKILL.md): deepen the real evaluator seam, inject the existing repository, keep internal helpers private, and test at the conversation interface.

## Comments

- 2026-10-10: Started after inspecting `conversation.ts`, `recruitment-tool-executor.ts`, the existing repository adapters, and conversation tests. The evaluator's output is already exercised through the public full-graph interface; this change should relocate behavior without changing that contract.
- 2026-10-10: Extracted candidate loading, peer cohort construction, evidence projection/percentiles, evidence wording, coverage, and shared source-record identity into the focused evaluator module; injected it into the existing typed tool executor. `pnpm build`, `pnpm build:web`, `git diff --check`, and static TypeScript compilation of the two touched test files pass. Full conversation-level behavior fixtures remain unchecked because tests were not run in this turn; issue remains claimed until that verification is completed.
- 2026-10-10: Follow-up verification added distractor records differing by position, competition, and season to the existing public HTTP → LangGraph report fixture; the recommendation still reports a two-player comparison cohort and withholds percentiles below the five-player rule. Focused conversation, tool-executor, and conclusion-policy suites pass (66/66). Static TypeScript checking passes for the tool-executor and conclusion-policy test files; the repository's production build intentionally includes only `src/`, and a one-off typecheck of the large conversation test file reports existing fixture/type errors. The established test runner successfully transpiles and runs the full conversation suite. `git diff --check` also passes.
- 2026-10-10: Final verification closed the remaining full-conversation fixture gap: `node --import tsx --test tests/recruitment-conversation.test.ts` passed 41/41, and API/Web production builds plus `git diff --check` passed. This verifies the established evaluator behavior seam for the covered fixtures; it does not assess real-world recommendation quality.

## Answer

Extracted candidate-record loading, same-position/competition/season cohort construction, direct metric projection, peer percentiles, sample/coverage descriptions, and source-record identity into a focused evaluator. The typed tool executor injects that evaluator; LangGraph remains responsible for decisions, budgets, progress, trace, workflow state, interruptions, and recovery. No score weights, data sources, or ranking claims changed.

Verification passed: API and Web production builds; the full repository test suite (371/371); the focused conversation, executor, and conclusion-policy suites (66/66); static TypeScript checks for the two directly changed test modules; and `git diff --check`. The existing conversation-level report fixture now includes distractors from other positions, competitions, and seasons and confirms they do not enter the peer cohort. This validates behavior preservation for the covered fixtures, not real-world recommendation quality.
