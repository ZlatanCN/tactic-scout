# Show the ask-policy ablation in the portfolio showcase

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: none

## Goal

Make the newly verified ask-policy experiment legible to a résumé reviewer without requiring them to read the evaluation log or run Ollama.

## Scope

- Add one focused `/showcase` component for the ask-enabled and ask-disabled paired runs.
- Lead with the observed conclusion, then show the Bayern missing-role case and Barcelona clear-request control.
- Show repeat counts, Harness checks, answer use, report/pause outcomes, and clearly distinguish the disabled static pause from a user-facing Planner question.
- Explain that the first Bayern role question is emitted by a deterministic LangGraph policy gate; the ablation therefore controls every graph ask boundary.
- State that the enabled arm receives matched answers while the disabled arm receives none, so the comparison cannot isolate wording from answer availability.
- Keep player names, raw requests, IDs, and raw traces out of the public showcase.

## Resolution criteria

- [x] Values match issue 138 and the ID-free evaluation log.
- [x] The conclusion appears before method details; the two scenarios are visually distinct and understandable without technical context.
- [x] The caveat prevents claims about recommendation quality, general clarification quality, or LangGraph superiority.
- [x] `pnpm build:web` passes.
- [x] Browser inspection at desktop and 390 CSS px finds no clipping or horizontal page overflow, including the expanded method note.

## References

- [Ask-policy protocol and results](138-ask-user-policy-ablation.md)
- [Evaluation log](../../../docs/evaluation.md#追问策略消融)
- [Existing clarification showcase](../../../web/src/ShowcaseClarificationInteraction.tsx)

## Answer

Added a standalone conclusion-first ask-policy ablation to `/showcase`, separate from the answer-availability experiment. It presents both frozen scenarios, paired run and Harness counts, answer availability, report versus safe-pause outcomes, and the fact that the first Bayern role question comes from a deterministic graph policy gate. The disabled arm is described as an internal ask decision being suppressed; no user-facing question or answer is shown. The expanded method note identifies Qwen 3.5 9B and the exact curated snapshot hash, and limits the interpretation to these two behavior-contract cases.

Validation: `pnpm build:web` passed. Browser review at desktop and 390 CSS px found no clipping or horizontal overflow; the mobile page stayed 390 px wide with both the method note collapsed and expanded. `git diff --check` passed.

## Comments

- 2026-10-10: Reuse the established conclusion-first showcase language. Keep the new component separate from issue 137's answer-availability experiment so the two causal questions are not merged.
