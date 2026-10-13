# Reject progress events without matching Agent activity

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Make the local Agent Harness prove that every tool-stage progress lifecycle corresponds to exactly one observed LangGraph tool call, so the workbench cannot pass evaluation with invented or duplicated activity.

## Acceptance criteria

- Every observed tool trace has one matching `started` event and one matching terminal event for the correct progress stage, in order.
- A tool-stage progress lifecycle with no corresponding tool trace fails the scenario.
- A missing lifecycle, wrong stage, invalid outcome status, or start/terminal pair split across turns fails the scenario.
- The final `needs_input` or `completed` progress event still matches the conversation response state.
- Deterministic evaluator tests run without an LLM or external service.

## Answer

`progressMatchesObservedToolsAndTurnState` now partitions actual traces by first/continued turn and requires exactly two matching events per tool: the correct stage's `started` event followed by its valid outcome (`completed` on success; `notice` or `failed` on error). Extra, missing, mis-staged, incorrectly completed, or cross-turn pairs fail the scenario. The existing pause/completion checks remain in place.

Verification: the regression failed against the old evaluator, then the focused Harness file passed 30/30 after the fix. The full suite and live Ollama run were not performed in this slice.

## Comments

- 2026-10-06：静态检查发现 evaluator 只要求每个 trace 能找到一对后续进度；它会忽略额外的候选评估/检索阶段，因此可能接受工作台未执行的虚假活动。采用 `evaluateLocalAgentScenario` 现有确定性入口验证一一对应关系。新增回归先按旧实现复现误报，再通过 30 项定向 Harness 用例。
