# 219 — Preserve explicit English fine-position requests

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Objective

Keep an explicit English position such as “left-back” as a search constraint even when the structured model brief omits it. The request must not silently become an all-position search.

## Public seams

- `resolveCandidateSearchIntent()` verifies deterministic interpretation of user wording.
- `createRecruitmentConversation()` verifies a model brief with `positions: []` still leads to a position-scoped LangGraph search.

## Acceptance

- [x] `left-back`, `left back`, `right-back`, and `fullback` resolve to their intended position codes.
- [x] A full graph receiving a validated model brief with no position recovers the explicit user position and searches that position.
- [x] A real local-model run passes its expected-position Harness checks.
- [x] Tests, API build, and diff check pass; candidate-ranking quality is not inferred from this behavior test.

## Answer

The deterministic position vocabulary now recognizes English left/right back phrases, while `resolveCandidateSearchIntent()` reads the same explicit-position parser used to validate the model brief. The full graph therefore preserves the user's source wording as the position boundary even when model output leaves `positions` empty.

Validation: the focused brief and candidate-intent suites pass 31/31; the full test suite passes 660/660; `pnpm build` passes. A real Qwen 3.5 9B run for “为巴萨寻找一名 left-back，重点考察出球能力” passes all registered Harness checks and sends `position: LB` to candidate search. It reads 20 candidates, evaluates 20 and returns three leads in 90.8 seconds. One expansion-planning request reaches the existing 60-second timeout and uses its bounded fallback; this run verifies position/control-flow behavior, not football ranking quality.

## Comments

- 2026-10-18: The pre-fix held-out understanding run got the task/reference right for “Please find a left-back who can carry the ball forward” but omitted the explicit position; a separate mixed Chinese/English case timed out at its 90-second limit. The post-fix full graph verifies the position filter. The mixed-language timeout remains an independent latency issue for follow-up.
- 2026-10-18: The left-back full-graph trace shows one requested measurable area (“后场出球”), so the current expansion-sufficiency rule (which requires at least two measurable areas) intentionally calls the Planner. Its 6,108-character context request times out after 60 seconds without token usage. The fallback then returns three leads. Whether one-area requests with three independently evidenced candidates should finish earlier is tracked separately in issue 220; no expansion policy change is included here.
