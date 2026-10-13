# Validate pagination across clarified search rounds

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Model the two valid behaviors after a user changes scope: begin a fresh page-zero query for the newly confirmed intent, or continue a prior matching scope at its exact source cursor. Validate pages within the correct search sequence instead of merging every identical filter across the whole case.

## Previously accepted end-to-end seam

- `createRecruitmentConversation` with an injected Planner and repository, exercising the complete graph and same-case clarifications.
- Existing local Harness CLI, which verifies `positionExpansionMatchesEvidenceAndConsent` and `recommendationsMatchExpectedPosition` against the recorded model run.

## Confirmed fast regression seam

- The exported pure Harness evaluator `evaluateLocalAgentScenario(input)` with real-shaped trace and progress events, plus the complete Harness CLI comparison. The user confirmed both seams.

## Reproduction evidence

In the six pre-fix Bayern runs recorded by issue 193, the graph queried `ATT` at offset 0 in turn 1, queried confirmed `ST` at offset 0 in turn 2 and received zero matches, then queried fresh `ATT` offset 0 after explicit broadening consent in turn 3. Issue 181 requires a new matching observation after an intent change, so this is a valid fresh-sequence shape. The old Harness grouped both `ATT` queries solely by identical filters, then reported `recommendationsMatchExpectedPosition` and `positionExpansionMatchesEvidenceAndConsent` false in both arms. A different valid graph path can continue the prior ATT cursor; an existing evaluator test already accepts that exact-offset behavior. Raw identity-bearing traces remain under Git-ignored `.data/evaluations/`.

## Acceptance criteria

- [x] The regression accepts a new page-zero sequence after a changed user intent while retaining current-turn freshness checks.
- [x] A resumed sequence with a prior `nextOffset` is accepted only when it uses that exact cursor.
- [x] Repeated or skipped pages inside one pagination sequence still fail.
- [x] Full-graph search behavior remains unchanged.
- [x] A repeat of the registered Harness comparison passes the two position/consent checks in both arms, or any remaining failures are explained separately without filtering runs.
- [x] Full deterministic test suite, API/Web builds, and diff check pass.

## Context

- [Dynamic planning reproduction](193-refresh-dynamic-planning-ablation.md)
- [Current-turn intent and freshness rules](181-enforce-complete-candidate-search-intent.md)
- [Candidate expansion domain rule](../../../CONTEXT.md#候选扩展决策)

## Answer

When evaluating an approved broader search, the Harness now accepts either a valid new pagination sequence starting at offset zero within the post-answer observations, or a valid continuation from the original matching scope at its exact recorded cursor. Invalid page order remains rejected by the existing pagination checks. Only the evaluator changed; LangGraph execution is unchanged.

The new test through `evaluateLocalAgentScenario` failed before the change and passes after it. Existing evaluator tests still accept an approved exact-cursor continuation and reject expansion before consent. The full registered Bayern CLI comparison then passed all three pairs in both arms, including `recommendationsMatchExpectedPosition` and `positionExpansionMatchesEvidenceAndConsent`; API/Web builds and all 442 tests passed.

## Comments

- 2026-10-13: User confirmed `evaluateLocalAgentScenario(input)` and the complete Harness CLI as the two validation seams. The regression test was written first and reproduced the false negative. Raw comparison output remains local in ignored `.data/evaluations/`.
