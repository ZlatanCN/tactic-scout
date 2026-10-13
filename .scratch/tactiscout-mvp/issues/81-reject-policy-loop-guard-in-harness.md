# Reject repeated policy-blocked actions in the Agent Harness

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make a complete data-repository → LangGraph conversation → report run fail Harness acceptance when the graph has to stop the model after it repeats the same policy-blocked action.

## Why now

The 2026-10-07 browser acceptance completed safely, but LangGraph had to stop a repeated action that its investigation policy had already rejected. The final report disclosed the fallback. A safe fallback is useful product behavior, but this trace is evidence of an unresolved Agent loop and must not be counted as a clean Harness pass.

## Scope

- Use the existing public `evaluateLocalAgentScenario` seam and its observed decision trace.
- Detect consecutive decisions that repeat the same action while `policyBlocked` is true.
- Ensure the final report's repeated-action guard limitation also fails loop-limit acceptance.
- Preserve legitimate single policy-blocked decisions and all other source-aware scenario checks.

## Acceptance criteria

- One policy-blocked decision does not fail this invariant by itself.
- Two consecutive decisions with the same action and `policyBlocked: true` fail the scenario, even if the fallback report is otherwise valid.
- The actual repeated-action guard wording in a report fails the loop-limit check.
- A deterministic regression exercises the public evaluator; no model or external service is needed for this Harness contract.
- Update the issue map and report that the check validates Agent behavior, not recommendation quality.

## Answer

The public Harness evaluator now fails a run when its observed decision trace contains the same consecutive policy-blocked action, and the loop-limit check recognizes the exact limitation emitted by LangGraph's repeated-action guard. A single blocked attempt remains allowed.

Verification: `node --import tsx --test tests/local-agent-evaluation.test.ts` passed 36/36; `pnpm build` passed. A complete local Qwen 3.5 9B run against the current FPL repository took 269.8 seconds, completed three turns in the same case, made 14 tool calls, evaluated 40 candidates, ran Reviewer, and generated a report. The run correctly failed Harness acceptance (0/1): `didNotRepeatPolicyBlockedAction` and `didNotHitDecisionOrPolicyLoopLimit` both failed because the planner repeated a policy-blocked `search_player_reports` action. The trace also exposed a candidate-name-filter attempt and broadening checks for follow-up. This validates detection across the selected repository → LangGraph conversation → report seam; it does not validate recommendation ranking quality.

## Comments

- 2026-10-07: The earlier browser run exposed the guard fallback; the new full Harness run reproduced it and now returns nonzero with the policy-loop checks listed as failed, instead of counting the completed report as a pass.
