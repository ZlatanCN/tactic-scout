# Showcase the evidence-review ablation

Type: task
Status: resolved
Labels: ready-for-human
Blocked by: 132

## Goal

Turn the completed, matched evidence-review ablation into a concise portfolio artifact that explains one real Harness mechanism and its measurable effect.

## Scope

- Add a conclusion-first ablation section to the model-free `/showcase` page.
- Show the three paired run outcomes, the single failed check in the bypass arm, the repaired evidence reference, and the fact that Planner/tool traces and candidate sets matched.
- Keep the report identity-free and distinguish evidence-reference grounding from recommendation quality.
- Explain the small sample and historical Wyscout snapshot in the page itself.
- Match the existing `/showcase` visual language and preserve narrow-screen readability.

## Resolution criteria

- The ablation is visible on `/showcase` without API/model configuration.
- A reader can understand the changed mechanism, observed outcome, matched controls, and limitations without reading a trace.
- No player name, ID, prompt, or private run artifact is rendered.
- Web production build passes; browser view is checked at desktop and narrow width.

## Context

Verified run data and research references are in [issue 132](132-controlled-evidence-review-ablation.md), [evaluation docs](../../../docs/evaluation.md#证据复核门消融), and the local-only `.data/evaluations/reviewer-ablation.json`.

## Answer

Added a conclusion-first, identity-free ablation section to `/showcase`. It compares three paired runs: the full review gate passed 29/29 in all three; bypass passed 28/29 in all three and failed `requestedCapabilitiesAreGrounded`. Planner/tool traces and candidate sets matched, while the full review repaired one evidence reference per run. The page says this is a single historical-data scenario with three repeats and does not establish ranking accuracy or general LangGraph superiority. The surrounding run label is also generic; no club/player name or prompt is rendered.

The selected B latency narrative remains conclusion-first, followed by run samples and separate Planner/tool evidence. The 390px responsive layout was checked in the browser; the page and ablation card have no horizontal overflow, and paired rows fit within their container. `pnpm build:web` passes. No test suite was run.

## Comments

- 2026-10-10: Mounted `ShowcaseReviewerAblation` after the latency summary. Desktop and 390px viewports verified; the displayed page contains no player or club names. Build passed after removing the specific scenario label from the recorded-run hero, latency summary, and ablation copy.
