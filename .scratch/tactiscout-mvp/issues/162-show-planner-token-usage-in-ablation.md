# Show measured Planner token use in the investigation ablation

Type: task
Status: resolved
Labels: ready-for-agent
Blocked by: none

## Goal

Bring the later instrumented Ollama measurements into the conclusion-first `/showcase` investigation-planning ablation. Its methods note currently says token usage was not measured, which is stale after issue 148.

## Requirements

- Show mean input/output/total Planner tokens per full-graph run for both scenarios and both arms, derived from the three paired repetitions in issue 148.
- Label the aggregation clearly and state that every invocation reported complete usage.
- Update the limitation text: tokens are measured Planner usage, not money or a token-matched comparison; the Harness starts at `conversation.turn()` and does not claim to account for the full browser/application flow.
- Keep all existing counts, recommendations descriptive, candidate IDs/traces private, and the explanation inside the collapsed methods section.
- Preserve the existing story-first layout and responsive table containment.

## Source values

Three-run totals (input/output/total tokens):

- Barcelona adaptive: 26,118 / 1,515 / 27,633 across 3 runs.
- Barcelona single-pass: 2,139 / 1,206 / 3,345 across 3 runs.
- Bayern adaptive: 34,812 / 1,977 / 36,789 across 3 runs.
- Bayern single-pass: 18,450 / 1,578 / 20,028 across 3 runs.

## Acceptance criteria

- [x] Both scenario tables show the accurately labeled three-run mean input/output/total Planner tokens per full-graph run for each arm.
- [x] Collapsed method text reports complete provider usage across all 36 actual Planner requests and distinguishes this from earlier uninstrumented results.
- [x] Token limitations accurately describe measurement scope and do not claim cost, token matching, ranking quality, or framework superiority.
- [x] Production `/showcase` accessibility tree and desktop rendering show the updated values legibly and preserve the default-collapsed methods section.
- [x] Web production build passes.

## Answer

Updated the conclusion-first investigation-planning card with mean input/output/total Planner tokens per full-graph run for each of the two frozen scenarios and both arms. The card is dated 2026-10-11, matching the instrumented rerun. The collapsed method note distinguishes the complete usage measurement (36/36 actual Planner requests) from the earlier uninstrumented run, states that the Harness starts at `conversation.turn()`, and explains that tokens are neither money nor a token-matched comparison. Recommendation counts remain descriptive. Increased table and expanded-method text sizes for presentation reading; the existing fixed-layout table remains inside its horizontal-overflow wrapper.

Verification: production Web build passes. At `/showcase`, the default accessibility tree keeps the methods disclosure collapsed; expanding the planning ablation exposes all four token triples and the complete-usage/scope caveats. Desktop rendering shows both scenario tables. `git diff --check` passes. The previously requested exact 390px manual review remains open under issue 144.

## Evidence

- [issue 148](148-capture-model-token-usage.md)
- [dynamic investigation-planning ablation](../../docs/evaluation.md#动态调查规划消融)

## Comments

- 2026-10-12: Opened after finding that the showcase methods text still says no per-call token usage was collected, despite issue 148's later instrumented rerun with complete Qwen/Ollama usage coverage.
- 2026-10-12: Added measured per-run means (input/output/total): Barcelona adaptive 8,706/505/9,211 vs fixed 713/402/1,115; Bayern adaptive 11,604/659/12,263 vs fixed 6,150/526/6,676. Updated method scope and limitations, enlarged table/method typography, and updated the showcase tab summary and README. Production build and desktop accessibility/rendering checks pass; issue 144's exact 390px human review is still pending.
- 2026-10-12: Adversarial re-read found the new token values came from 2026-10-11 runs while the card eyebrow still said 2026-10-10, and the Harness entry boundary needed to be explicit. Reopening for that accuracy correction.
- 2026-10-12: Corrected the displayed experiment date and explicitly named `conversation.turn()` as the Harness starting boundary. Rebuilt Web and rechecked the production accessibility tree for the corrected date, all four input/output/total means, and the expanded scope caveat.
