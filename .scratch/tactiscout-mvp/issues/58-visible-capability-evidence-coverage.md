# Show requested capability evidence coverage in the scouting report

Type: task
Status: resolved
Labels: ready-for-human

## Goal

Make the evidence coverage for capabilities explicitly requested in the conversation visible in the final report. Readers should be able to tell which requested dimensions have observed metrics, which only cover part of the evaluated sample, and which cannot be measured by the current schema.

## Acceptance criteria

- [x] The report response includes the same deterministic capability coverage summary used by the LangGraph Planner.
- [x] The report UI shows observed, partial, and missing states with counts and an understandable explanation of what each state means.
- [x] A dimension with no mapped metric is clearly described as structurally unmeasured; nearby statistics are not presented as substitutes.
- [x] Older saved reports remain readable when the new field is absent.
- [x] The graph integration test checks that Planner and delivered report receive the same coverage state.
- [x] API/web builds and focused tests pass; no unverified visual QA is claimed.

## Answer

The report contract now carries the deterministic capability coverage summary computed from the current conversation and evaluated candidate evidence. The UI displays a compact card for each requested dimension, showing whether it is observed, partial, or missing and how many evaluated candidates have a related metric. If the schema has no corresponding metric, the card says so and explicitly avoids treating a nearby statistic as a substitute.

Older version-2 browser reports parse with an empty coverage list, and legacy one-shot plan migration also supplies an empty list. The graph integration test confirms the report receives the same coverage state as the constrained Planner.

Verification: 9 saved-plan tests and 1 graph integration test passed; API response tests 3/3 and focused policy/Harness tests 40/40 passed. `pnpm build`, `pnpm build:web`, and `git diff --check` passed. Browser visual review was not performed, so rendered layout remains unverified.

## Comments

- 2026-10-05：承接 [issue 57](57-structured-capability-evidence-coverage.md)，让内部决策状态也成为用户能读懂的报告信息，不再要求用户从通用限制文本推断覆盖率。
