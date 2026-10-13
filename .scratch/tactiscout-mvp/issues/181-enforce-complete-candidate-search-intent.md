# Enforce every explicit candidate search constraint

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Ensure the latest multi-turn candidate search intent constrains not only repository queries, but also discovered-player evaluation eligibility, automatic evaluation, and final recommendations. Position, age, minimum minutes, competition, and season all remain hard filters until the user changes or explicitly removes them; any changed search scope must have its own matching repository observation before the Agent can conclude.

## Accepted verification seams

- `applyRecruitmentCandidatePolicy` for pure policy behavior, reusing the accepted interface from [issue 170](170-centralize-candidate-action-policy.md).
- `createRecruitmentConversation` for the complete data-to-report path, reusing the approved full-graph seam from issue 170.
- Adversarial repository results include candidates that violate minimum minutes, competition, or season; they must not be evaluated or recommended.

## Acceptance criteria

- [x] The shared candidate-intent predicate enforces position, max age, minimum minutes, competition, and season using the repository's established text matching semantics.
- [x] Explicitly out-of-scope discovered/evaluated records are excluded from evaluation and final reports, including records returned by an over-inclusive provider.
- [x] Multi-turn updates continue to apply the complete latest intent without treating team/reference-player names as constraints.
- [x] Explicitly removing age, minimum-minutes, competition, or season limits clears the corresponding prior constraint.
- [x] A changed search scope triggers a fresh matching query even when the position is broad and `confirmedPosition` is unset, including when the same scope was searched in an earlier turn.
- [x] The full suite, API/Web production builds, and `git diff --check` pass.

## Context

- [Candidate search intent policy](85-centralize-explicit-candidate-search-intent.md)
- [Candidate action policy](170-centralize-candidate-action-policy.md)
- [Project domain constraints](../../../CONTEXT.md#候选检索意图)

## Comments

- 2026-10-13: Standards review found that `candidateMatchesSearchIntent` enforced only position and max age even though the domain contract also names minimum minutes, competition, and season. This leaks previously discovered records across later clarified constraints.
- 2026-10-13: Follow-up adversarial review found that prior age/minutes/competition/season limits cannot be explicitly cleared, and the fresh-query guard only covers confirmed sub-positions. Reopened to preserve the stated “until the user changes or removes them” contract for broad positions too.
- 2026-10-13: Further adversarial review found two negation edge cases: “不愿取消年龄限制” must keep the age limit, and “只看英超，不要德甲” must keep the positive EPL choice. Added pure-parser coverage and full-graph query regressions.
- 2026-10-13: The candidate-action-policy ablation now also records the independent freshness guard: bypassing the action policy allows an unsafe first query, but the graph forces a fresh query matching the complete user intent before conclusion, so the fixed fixture's final shortlist stays in scope.

## Answer

`candidateMatchesSearchIntent` enforces position, maximum age, minimum minutes, competition, and season across discovery, evaluator eligibility, report filtering, and final recommendations. Explicit removals clear the relevant limit; negated removal language such as “不愿取消年龄限制” does not. After any scope change, the graph requires a fresh repository observation for the complete new intent in the current user turn, even if an identical scope was searched earlier. League parsing selects the last positive league mention, so “只看英超，不要德甲” retains EPL.

Verification: pure parser tests cover negated age removal and league choice; complete `createRecruitmentConversation` tests prove age retention, the EPL → Bundesliga → EPL fresh-query sequence, and complete query filters after clarifications. The candidate-action-policy ablation now shows defense in depth: bypass allows the first out-of-scope query, while the independent fresh-observation guard forces an in-scope query before conclusion and the final shortlist remains in scope. `pnpm test` passed 430/430, `pnpm build`, `pnpm build:web`, and `git diff --check` passed.
