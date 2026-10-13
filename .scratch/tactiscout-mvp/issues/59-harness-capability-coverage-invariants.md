# Validate requested capability coverage in the Agent Harness

Type: task
Status: resolved
Labels: ready-for-agent

## Goal

Make the Agent Harness verify that a delivered report's requested-capability coverage is present and internally consistent with its evaluated sample counts and metric mappings.

## Why now

The Barcelona scenario already checks whether recommendation evidence supports requested abilities and whether unsupported abilities are disclosed. It does not check whether the report's `requestedCapabilityCoverage` entries agree with the number of evaluated candidates, their requested metric keys, and their `missing` / `partial` / `observed` status. A malformed report could therefore pass the scenario's existing evidence checks.

## Acceptance criteria

- [x] A final report's coverage entries use only observed metric keys that are among the requested metric keys.
- [x] Each entry's evaluated-candidate count matches the report's evaluated sample count; its evidence count is within that range.
- [x] The reported status is recomputed from those counts, including the zero-sample case.
- [x] Every requested capability in a Harness scenario has a corresponding coverage entry with the scenario's expected metric mapping.
- [x] Deterministic Harness fixtures demonstrate that coherent coverage passes and missing, contradictory, or out-of-range coverage fails.
- [x] The local issue map and this issue state exactly what the Harness verifies and what it cannot independently prove.

## Answer

The local-model Harness now checks that each delivered coverage entry has unique names and metric keys, that observed keys are a subset of requested keys, that evaluated counts match the report sample count, and that candidate counts/status agree (including zero-sample cases). The Barcelona shortlist scenario independently lists the expected capability names and metric mapping, so missing dimensions or changed mappings fail the scenario.

The check validates the report contract; it does not independently recalculate each candidate's evidence coverage. “Evaluated sample” means unique evaluated candidate identity groups; source-record counts remain separate, and a group's coverage is true when any independently evaluated source record has a requested metric. The deterministic `summarizeRequestedCapabilityCoverage` tests and graph integration test remain responsible for that computation and Planner/report state sharing. Coverage never combines source metric values or ratings.

Verification: `node --import tsx --test tests/local-agent-evaluation.test.ts` passed 27/27; `pnpm build` and `git diff --check` passed. No local Qwen run was repeated because this change only changes evaluation of the report output, not graph behavior.

- 2026-10-11: A real LangGraph Harness run with exact identity grouping exposed that the report counted 29 evaluated candidates while coverage counted 30 evaluated source records. Coverage now uses the same evaluated identity-group denominator as `evidenceCoverage.evaluatedCandidateCount`; source evidence remains independent. Full graph identity regression verifies 3 groups from 4 source records yield 3/3 goal coverage. Three fresh Bayern pairs subsequently passed 29/29 checks in both arms.

## Comments

- 2026-10-05：在 `requestedCapabilitiesGrounded` 检查之外补一层报告契约验证。该检查确认覆盖摘要内部一致及场景能力映射齐全；它不独立重算每名候选人的指标覆盖，因此不替代图集成测试和来源证据校验。
