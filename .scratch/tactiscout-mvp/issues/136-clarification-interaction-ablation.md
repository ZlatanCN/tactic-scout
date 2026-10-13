# Measure the contribution of user answers in a clarification workflow

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Use paired real-model Harness runs to check whether a purposeful clarification and same-case resume change the investigation outcome, while confirming that clear requests do not acquire unnecessary questions.

## Scope

- Add `--compare-interaction` to the existing `pnpm eval:local-agent` seam for one registered scenario on the fixed `curated` snapshot.
- Compare the normal scripted conversation with a control that runs the same initial request but withholds every registered user answer. The control stops at the first LangGraph interrupt; it must not invent or inject hidden answers.
- In the full arm, provide a registered answer only when the visible question matches that answer's predeclared intent; an unrelated or compound question must not receive a hidden scripted answer.
- Cover both `barcelona-under-23-midfielder` (clear request, expected to complete without asking) and `bayern-kane-replacement` (role and then expansion clarification, expected to resume twice in the same case).
- Keep the production graph, Planner, Reviewer, repository, knowledge base, prompts, and tool budgets unchanged between arms. Only availability of scripted user answers differs.
- Include per-arm and per-run summary fields in the CLI result; keep the full result (including detailed traces and player identifiers) in ignored `.data/` outputs and publish only an ID-free aggregate in `docs/evaluation.md`.

## Resolution criteria

- The CLI rejects `all`, custom scenarios, and non-curated repositories for this paired experiment.
- In the clear-request control, both arms complete without `ask_user` and consume zero answers.
- In the clarification case, the full arm asks after observing data, resumes under the same thread ID, applies each scripted answer only after its matching question intent, and satisfies the existing scenario Harness. The withheld-answer arm stops at the first valid question with `needs_input`, no report, zero consumed answers, and no post-interrupt tool calls.
- The comparison reports each case and arm independently, per-run outcomes, snapshot hash, model/data identifiers, and the limits of the experiment. It does not call this a `-ask_user` policy ablation, a framework comparison, recommendation-quality evidence, or a reliability estimate.
- Run three paired repetitions per case when the local model is available; document interruptions or failed attempts without silently dropping them.
- Add the privacy-safe aggregate to the evaluation log and update the map.

## Design note

This is an answer-availability / interaction ablation, not a Planner-policy ablation: the no-answer arm still lets the graph decide to ask and then exercises the real interrupt boundary. It isolates the value of receiving the answer and resuming the case without changing the system whose behavior is being observed.

## Answer

Implemented `--compare-interaction` for the two registered curated scenarios. On 2026-10-10, Qwen 3.5 9B ran three counterbalanced pairs per scenario against the same Wyscout 2017/18 snapshot (`6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`). All 12 runs passed their registered Harness checks:

| Scenario | Scripted answers | Withheld answers |
|---|---|---|
| Bayern replacement | 3/3 completed; each asked twice, consumed the two matching answers, resumed the case, produced a report, and passed 29/29 checks. | 3/3 safely paused at the first role question with `needs_input`; each consumed zero answers, made no post-interrupt tool calls, produced no report, and passed 9/9 pause checks. |
| Clear Barcelona U23 midfielder request | 3/3 completed with zero questions or answers and passed 31/31 checks. | 3/3 completed with zero questions or answers and passed 31/31 checks. |

This supports the intended behavior in these frozen scenarios: the graph requests missing role input after gathering evidence, resumes only when its question covers the registered intent, and does not require an answer for the clear request. It does not establish a general ask-timing policy, recommendation quality, framework superiority, or long-run reliability. The experiment is specifically an answer-availability/interaction ablation, not a `-ask_user` policy ablation.

The full per-arm/per-run results are in `.data/evaluations/clarification-bayern-2026-10-10.json` and `.data/evaluations/clarification-barcelona-2026-10-10.json`; those ignored files include detailed traces and player identifiers and stay local. Only an ID-free aggregate is recorded in [evaluation.md](../../../docs/evaluation.md). TypeScript build and CLI guard/help checks passed; no test suite was run.
