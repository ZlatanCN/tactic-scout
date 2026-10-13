# Measure the contribution of asking when a key recruitment need is unresolved

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Use the existing local-model Harness to compare a normal clarification conversation with a safe control that cannot ask or receive hidden answers when a key need is unresolved.

## First-principles boundary

- The first role question in the registered Bayern scenario currently comes from a deterministic LangGraph policy gate, before the Planner is asked to choose its next action. A Planner-only switch would leave this question active and invalidate the comparison.
- The experimental switch therefore applies at every user-facing `ask_user` boundary in the graph, including deterministic role/position gates and Planner decisions. It must not alter default production behavior.
- The disabled arm may expose only a fixed pause notice. It must not expose generated question wording, guess a role, widen constraints, receive registered answers, or generate a completed shortlist while the required need remains unresolved.
- This is a frozen-scenario mechanism check. It is not a framework comparison, recommendation-quality evaluation, or general reliability estimate.

## Public seams

- `createRecruitmentConversation` runs the full LangGraph with the experimental ask policy enabled or disabled.
- `pnpm eval:local-agent -- --scenario <id> --compare-ask-policy --runs <1-10>` runs counterbalanced paired arms on the fixed `curated` repository.

## Acceptance criteria

- [x] Normal application and graph defaults still allow existing clarifications.
- [x] Disabled policy suppresses both deterministic and Planner `ask_user` actions and logs the decision source/outcome without logging generated question text.
- [x] Missing required needs produce `needs_input`, an explicit unresolved marker, no recommendations/report, and no post-pause work; the arm receives zero scripted answers.
- [x] The clear Barcelona control completes with no ask in either arm.
- [x] CLI rejects custom input, `all`, non-curated data, and conflicting ablation flags before model requests.
- [x] End-to-end graph tests exercise both deterministic and Planner ask paths. CLI tests cover help and experiment guards.
- [x] Three counterbalanced pairs per supported registered scenario run when the local model is available; no run was silently dropped.
- [x] Evaluation docs and map state precisely what the outcomes establish and do not establish.

## Answer

Implemented the experiment-only `experimentalAskUserMode` at `createRecruitmentConversation` and the `--compare-ask-policy` Harness option. Production defaults remain enabled. The suppression marker records only decision source and outcome; disabled runs keep the generated question out of the response, trace, and resumed Planner history, show a fixed unresolved-needs pause, and never receive the answer script.

Qwen 3.5 9B ran three counterbalanced pairs on each scenario using the same Wyscout 2017/18 curated snapshot (`6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`):

- Bayern replacement: enabled 3/3 completed both matching clarifications and the same case (29/29 Harness checks each); disabled 3/3 paused after two observed tools with one suppressed ask, zero answers, no later actions, and no report (7/7 checks each).
- Clear Barcelona U23 midfielder: both arms 3/3 completed without asking or consuming answers and passed 31/31 checks each.

This confirms the graph switch reaches both question sources, safely stops this unresolved-role case, and leaves this clear-request control unaffected. It does not isolate the effect of question wording from answer availability, evaluate recommendation quality, establish general clarification quality, or show a framework advantage. De-identified aggregates are in `docs/evaluation.md`; full JSON and traces remain in ignored `.data/evaluations/ask-policy-{bayern,barcelona}.json`.

Validation: `pnpm build`; the two full-graph cases and the Harness CLI/evaluation test files passed (53 tests total); `git diff --check` passed.

## Adversarial review questions

- Does the disabled arm really intercept every ask source, or can a deterministic safety path still ask?
- Can a generated question leak through the response, checkpoint history, or trace?
- Does the no-ask arm ever interpret a fixed pause acknowledgement as a missing role answer and continue?
- Are full-run results compared as though both arms had equal information when only the enabled arm receives user-provided clarification?

## Comments

- 2026-10-10: Initial architecture audit found the Bayern role question is policy-authored; the scope has been set to the graph's full ask boundary to avoid a false Planner-only ablation.
