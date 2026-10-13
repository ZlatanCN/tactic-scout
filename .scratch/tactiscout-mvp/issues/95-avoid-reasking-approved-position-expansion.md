# Keep confirmed position expansion visible to the Planner

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

After a user has agreed to broaden a confirmed position, keep the same permission question from interrupting the conversation again. Pass the approval to the Planner and redirect a repeated expansion question to the exact next-page search, while preserving other material clarifications.

## Context

Three independent Qwen 3.5 9B + FPL runs completed the full Bayern replacement scenario and passed 27/27 Harness checks. In all three, the Planner proposed another position-expansion question after the user had already agreed. The graph safely blocked it and the Planner then completed the report, but each case paid for an unnecessary model retry. See [the latest issue 14 evidence](14-agent-harness-evaluation-suite.md).

## Acceptance criteria

- [x] The LangGraph case passes its confirmed position-expansion state explicitly to the Planner.
- [x] The expansion prompt tells the Planner that the user already approved broadening and must not be asked for that permission again; other materially new questions remain possible.
- [x] The Harness fails a clarification-resume scenario if the Planner proposes any policy-blocked follow-up question after an answer.
- [x] Deterministic Planner and Harness tests cover the state handoff and the blocked-question regression.
- [x] A real local-model run reaches Reviewer and report without a policy-blocked repeated expansion question.
- [x] Full tests, API/Web production builds, and `git diff --check` pass.

## Answer

Resolved. The state flag now reaches the Planner, and the expanded-position prompt allows a different material question while forbidding the already answered expansion-permission question. If a Planner still proposes that repeated question, LangGraph converts it into a search at the exact next-page cursor; it does not pause the user or spend a recovery model call. The Harness rejects policy-blocked follow-up questions after the user answers.

## Comments

- 2026-10-08: Repeated-run evidence is 3/3 full-chain runs passing 27/27 checks, with one identical policy-blocked `ask_user` proposal in every run. Total time was 190.379, 83.806, and 91.300 seconds (p50 91.300 seconds, p95 190.379 seconds). The app did not show the blocked questions to the user; the issue targets the avoidable Planner retry and makes that quality regression visible to the Harness.
- 2026-10-08: Deterministic graph regression intentionally returns the repeated expansion question after approval; LangGraph instead searches the exact next page, leaves the distinct material-question path available, and emits no policy-blocked `ask_user`. Focused graph/planner/evaluator tests passed; full suite passed 283/283, API/Web production builds and `git diff --check` passed.
- 2026-10-08: One real Qwen 3.5 9B + FPL full-chain run completed in 293.981 seconds and passed all 28 Harness checks. It used three same-case turns and two user answers, read 79 matching ATT records over four pages, evaluated 30 players, made 12 tool calls, emitted 61 progress events, and reached Reviewer/report with two evidence-backed leads. Two repeated position-expansion questions were converted to exact next-page searches; `noBlockedFollowUpQuestions` passed. One separate candidate-search action was policy-blocked once, recovered without repetition or a loop-limit fallback, and did not fail the Harness. Player-report retrieval returned zero chunks; ranking accuracy and long-term reliability remain unevaluated.
