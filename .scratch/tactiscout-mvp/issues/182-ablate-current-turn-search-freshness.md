# Ablate current-turn candidate search freshness

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Demonstrate the independent value of requiring a new candidate-search observation after the user changes scope. The existing candidate-action-policy ablation now shows that a separate freshness guard can recover from an unsafe first query; isolate the freshness guard itself so the project can explain and defend both control layers.

## Accepted verification seam

- `createRecruitmentConversation` full-graph paired ablation, reusing the accepted LangGraph verification seam.
- Hold candidate-action policy bypassed in both arms so only current-turn search freshness changes.
- Use one deterministic repository whose returned eligible record changes between two identical scope queries. This makes stale reuse observable without relying on real-model variance.

## Acceptance criteria

- [x] Production default still requires a current-turn matching candidate-search observation after every changed search scope.
- [x] Both arms receive the same stale `finish` proposal after the scope returns to EPL. The default freshness guard overrides it with a new exact EPL query and can recommend only the newly returned record; the bypassed arm receives no third EPL query.
- [x] Report the bypassed arm's downstream outcome accurately: shared review gates may stop the stale conclusion, so do not attribute that stop to the freshness guard alone.
- [x] The paired result reports the behavior boundary without claiming general model reliability, ranking quality, or provider freshness guarantees.
- [x] Full suite, API/Web production builds, and `git diff --check` pass.

## Context

- [Complete candidate search intent](181-enforce-complete-candidate-search-intent.md)
- [Candidate action policy ablation](171-ablate-candidate-action-policy.md)
- [Project domain constraints](../../../CONTEXT.md#候选检索意图)

## Comments

- 2026-10-13: Issue 181's candidate-action-policy ablation found that disabling the action policy still allowed an unsafe first query, but the independent current-turn freshness guard forced a complete in-scope query before conclusion. This preserves safety while masking the freshness guard's own counterfactual effect; add a paired ablation with changing source observations to isolate it.
- 2026-10-13: The first freshness ablation draft expected stale EPL records to be recommended. The full graph rejected that claim: downstream review stopped stale-evidence completion. The correct counterfactual is fresh candidate plus recommendation when enabled versus a safe no-recommendation stop when bypassed.
- 2026-10-13: Independent review caught a Planner-action confounder between arms. The paired fixture now captures and asserts the exact same stale `finish` proposal in both arms; only the freshness mode differs.
- 2026-10-13: Spec review found that the query assertion omitted position, minimum minutes, and season. Expanded the repository observation capture and assertions to cover the complete search scope for both arms.

## Answer

The paired full-graph ablation uses the same Planner, candidate-action-policy bypass, and changing deterministic repository in both arms. Both arms propose the same stale `finish` action after EPL → Bundesliga → EPL; the test captures and compares that proposal. With the production-default freshness guard enabled, LangGraph overrides it with a new EPL query scoped to `ST`, age ≤ 23, minimum minutes 0, and no season limit, then recommends only the newly returned EPL record. With freshness bypassed, the graph issues no third EPL query. Shared downstream review gates stop the stale conclusion, producing no recommendation and a repeated-proposal limitation; that safe stop is not attributed to freshness alone.

This validates the changed-scope control flow against a fixed fixture. It does not establish model reliability, recommendation quality, ranking quality, or the freshness of a real provider. `pnpm test` passed 431/431; `pnpm build`, `pnpm build:web`, and `git diff --check` passed.
