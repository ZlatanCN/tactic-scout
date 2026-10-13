# Showcase the clarification and safe-resume behavior

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: 136

## Goal

Turn the real clarification interaction experiment into a clear portfolio explanation of when the agent proceeds, when it asks, and how LangGraph holds a case at an interrupt until the user answers.

## Scope

- Add a `/showcase` section using the conclusion-first narrative chosen by the user: lead with the observed behavior, then show the paired cases and supporting run evidence.
- Present the explicit Barcelona request as a no-question control and the Bayern role-ambiguous request as an ask/resume case.
- Distinguish scripted-answer continuation from the withheld-answer safe pause; show repeat counts and Harness checks per arm.
- Keep copy generic and avoid player identities, raw queries, candidate IDs, or detailed traces.
- State that this is a small frozen-scenario interaction check, not ranking-quality evidence, a general ask-timing claim, or a framework comparison.
- Verify the production web build and inspect desktop/mobile layout in the browser.

## Resolution criteria

- A reader can understand the conclusion before reading detailed evidence.
- Both scenarios, both answer conditions, and their observed outcomes are represented without implying withheld-answer runs completed.
- The page makes the two scenario cases and three repeated pairs per case clear; no ranking-accuracy or general reliability claims are made.
- Browser inspection confirms no horizontal overflow at desktop and 390 CSS px.

## References

- [Interaction protocol and results](136-clarification-interaction-ablation.md)
- [Evaluation log](../../../docs/evaluation.md#澄清互动消融)

## Answer

Added a conclusion-first interaction ablation section to `/showcase`. It presents the clear-request control and role-ambiguity case side by side, with the observed answer-available and answer-withheld outcomes, per-run repeat/check counts, and small LangGraph paths showing resume versus safe interrupt. A disclosure records the fixed model/data controls, snapshot hash, and limits. The copy does not expose player identities or raw prompts and explicitly avoids ranking-quality, general ask-timing, and framework-comparison claims.

`pnpm build:web` passed. Browser inspection at desktop and 390 × 844 CSS px confirmed the two-column desktop / single-column mobile layout; no visible clipping or horizontal overflow. The local `/showcase` preview is left open at the new section. No automated tests were run.
