# Centralize the hard-constraint policy for Planner actions

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make one small in-process interface responsible for converting a Planner proposal into an action that respects the user's candidate constraints and evidence state. This keeps natural-language intent enforcement out of graph-node glue and makes it harder for one caller to forget a required policy step.

## Scope

- Add `applyRecruitmentCandidatePolicy(proposedAction, state)` as the single action-normalization seam.
- Preserve the current behavior for target-team retention, position/age/minutes/competition/season intent, report-grounded candidate-name search, and eligibility filtering for evaluation and final recommendations/observations.
- Keep candidate pagination, investigation budgets, user-question routing, source access, and report wording in their existing modules.
- Replace the graph's ordered helper composition with the named policy interface; do not introduce an adapter or new framework.
- Verify the policy through its pure in-process interface and a full `createRecruitmentConversation` data-to-report path with adversarial Planner proposals.

## Acceptance criteria

- [x] The policy's interface accepts only the action and the state needed to enforce user/evidence constraints.
- [x] A single call retains target team, clamps candidate searches to user intent, grounds named candidates in retrieved report evidence, and filters evaluation/final outputs to eligible candidates.
- [x] Existing Planner action ordering, tool budget, pagination, clarification, and report behavior remain unchanged.
- [x] An adversarial full-graph fixture proves an out-of-scope Planner proposal cannot query, evaluate, or recommend an out-of-scope candidate.
- [x] `pnpm test`, API/Web production builds, and `git diff --check` pass.

## Context

- [Candidate search intent policy](85-centralize-explicit-candidate-search-intent.md)
- [Current LangGraph graph](../../../src/agent/conversation.ts)
- [Deep module design guidance](../../../.agents/skills/codebase-design/SKILL.md)

## Comments

- 2026-10-12: Selected after inspecting the current `conversation.ts` orchestration. The graph currently composes three private transformations inline before applying policy gates; the same constraint logic is also spread across search/evaluation/report helpers. The first slice centralizes the ordered action-normalization invariant without extracting the graph state or changing its routing.

## Answer

Added `applyRecruitmentCandidatePolicy(proposedAction, state)` and moved candidate-intent matching into a shared domain helper. The Planner node now invokes the policy seam once before the existing graph gates; pagination, budgets, clarification, and report routing remain in the graph.

The full-graph adversarial test caught an edge the old helper composition also allowed: a duplicate evaluation proposal mixing an already-discovered player with an invented ID could make the evaluator request both IDs from the repository before its later eligibility filter. The policy now strips unknown IDs and routes a wholly unsupported evaluation back to a user-constrained search. The complete graph fixture verifies the query uses the user's position, age, minutes, competition, and season; the repository only reads the discovered candidate; and the report only recommends that candidate.

Validation: targeted policy/full-graph tests 4/4; complete suite 419/419; TypeScript API build, Web production build, and `git diff --check` passed. This verifies control flow and evidence boundaries, not recommendation quality.
