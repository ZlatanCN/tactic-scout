# Present the evidence-evaluator ablation in the story-first showcase

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Make the completed full-graph evidence-evaluator experiment legible to a hiring manager on `/showcase`, while keeping the recorded investigation first and separating mechanism evidence from recommendation quality.

## Requirements

- Add an independent showcase module for the completed `barcelona-attacking-one-on-one-forward` ablation; do not overload the Reviewer or RAG modules.
- State the frozen-case conclusion first, then compare evaluator-enabled and explicitly withheld arms.
- Show the enabled arm's three Harness passes, candidate/evidence counts, and supported recommendations.
- Show the withheld arm's three no-evidence-contract passes separately from its 29/31 ordinary Harness result; explain the two expected capability-coverage check failures.
- Preserve the finding that all three downstream Planner/tool traces matched, without implying ranking accuracy.
- Keep player names, IDs, raw traces, and hidden reasoning out of the showcase. Put model, dataset snapshot, protocol, and limitations in a collapsed methods disclosure.
- Keep the existing story-first order and make the new section usable at narrow viewport widths.

## Verification

- [x] Web production build succeeds.
- [x] The showcase summary matches the sanitized aggregate in `docs/evaluation.md` and states the ranking-quality limitation.
- [x] The new section has an independent accessible heading and its methods disclosure works with keyboard navigation.
- [x] The story-first run remains ahead of experiment details; no user-owned preview or browser tab is changed.

## Answer

Added `ShowcaseEvidenceEvaluatorAblation` as a standalone study in the existing story-first experiment disclosure. It presents the conclusion first, then the paired enabled/withheld results. The control shows both measurements separately: the explicit no-evidence contract passes 3/3, while the ordinary Harness scores 29/31 because the two requested-capability coverage checks depend on evidence that this arm deliberately withholds. It also reports that downstream Planner/tool traces matched across the three pairs.

The methods disclosure names the local model and frozen snapshot, explains the controlled change, and states that the report's recommendations are not human scout judgments. The module uses a narrow responsive layout, a native keyboard-operable `<details>` disclosure, and no candidate names, IDs, raw traces, or hidden reasoning. The story-first investigation remains ahead of the experiment details.

Validation: `pnpm build:web` succeeds. No browser tab or user-owned preview was opened or changed; the existing issue 144 manual 390px review remains untouched.

## Comments

- 2026-10-11: Opened after issue 153 produced the first real three-pair evaluator result. This changes only the portfolio presentation; it does not claim that the recommended candidates are correct.
- 2026-10-11: Revalidated the showcase against the ignored raw experiment artifact and the sanitized evaluation summary; the displayed arm counts and limitations match. `pnpm build:web` succeeds, and the focused graph/CLI regressions pass 22/22. No browser tab was opened or changed.
